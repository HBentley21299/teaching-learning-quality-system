using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class QaCommentaryDatabaseTests
{
    private static readonly CancellationToken Token=CancellationToken.None;

    [AccountAdministrationDatabaseFact]
    public async Task Draft_form_settings_round_trip_and_published_settings_cannot_change()
    {
        await using var db=await CommentaryDatabase.CreateAsync();var store=db.Store();var user=db.User();
        // Migration is repeatable and leaves earlier reviews/commentary values intact.
        Assert.True(await db.ScalarAsync<bool>($"SELECT written_commentary_enabled FROM qa.review_activities WHERE id='{db.Activity}';"));
        await db.ApplyMigrationAsync();
        Assert.Equal("Earlier criterion comment",await db.ScalarAsync<string>("SELECT comment FROM qa.evidence_responses WHERE comment IS NOT NULL;"));
        var request=new SaveQaReviewRequest("Configurable commentary","2026/27","Digital review","general",db.Staff,
            null,new DateOnly(2026,12,1),[db.Team],[new(db.Type,db.Template,[db.Question],false)]);
        var id=await store.SaveQaReviewAsync(null,request,user,Token);
        var configuration=await db.ConfigurationAsync(id,false);
        Assert.False(Assert.Single(configuration.Activities).WrittenCommentaryEnabled);
        await store.SaveQaReviewAsync(id,configuration with{Activities=[configuration.Activities[0] with{WrittenCommentaryEnabled=true}]},user,Token);
        configuration=await db.ConfigurationAsync(id,false);Assert.True(configuration.Activities[0].WrittenCommentaryEnabled);
        await db.ExecuteAsync($"""
            UPDATE qa.reviews SET status=N'open' WHERE record_id='{id}';
            INSERT qa.review_questions(review_activity_id,question_text,display_order,is_required,allows_not_applicable,comment_required_at_expected)
            SELECT activity.id,N'Frozen criterion',0,1,1,0 FROM qa.review_activities activity WHERE review_id='{id}';
            """);
        var published=await db.ConfigurationAsync(id,true);
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.SaveQaReviewAsync(id,published with
            {Activities=[published.Activities[0] with{WrittenCommentaryEnabled=false}]},user,Token));
        var after=await db.ConfigurationAsync(id,true);Assert.Equal(published.RowVersion,after.RowVersion);
        Assert.True(after.Activities[0].WrittenCommentaryEnabled);
        await store.SaveQaReviewAsync(id,published with{TeamOrgUnitIds=[db.Team,db.OtherTeam]},user,Token);
        after=await db.ConfigurationAsync(id,true);Assert.Equal(2,after.TeamOrgUnitIds.Count);
        Assert.True(after.Activities[0].WrittenCommentaryEnabled);
        var outsider=user with{Permissions=new HashSet<string>{PermissionKeys.QaReviewsViewAll}};
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.SaveQaReviewAsync(null,request,outsider,Token));
    }

    [AccountAdministrationDatabaseFact]
    public async Task One_form_commentary_survives_autosaves_corrections_exports_and_disabled_form_guards()
    {
        await using var db=await CommentaryDatabase.CreateAsync();var store=db.Store();var user=db.User();
        var request=new SaveQaEvidenceRequest(db.Activity,db.Team,[db.Team],null,null,null,
            new DateTimeOffset(2026,10,31,10,0,0,TimeSpan.Zero),null,"Earlier context",[],"Earlier strengths",null,null,null,
            [new(db.FrozenQuestion,"at","Earlier criterion comment",null)],null,WrittenCommentary:"Overall form commentary");
        var draft=await store.SaveQaEvidenceAsync(db.Review,null,request,false,user,Token);
        Assert.Equal("Overall form commentary",draft.WrittenCommentary);Assert.True(draft.WrittenCommentaryEnabled);
        Assert.Equal("Earlier context",draft.ContextualNotes);Assert.Equal("Earlier strengths",draft.KeyStrengths);
        Assert.Equal("Earlier criterion comment",Assert.Single(draft.Responses).Comment);
        var originalVersion=draft.Evidence.RowVersion;
        // Older clients omit the new field; this must not silently erase it.
        var omitted=await store.SaveQaEvidenceAsync(db.Review,draft.Evidence.Id,request with
            {WrittenCommentary=null,RowVersion=draft.Evidence.RowVersion},false,user,Token);
        Assert.Equal(draft.WrittenCommentary,omitted.WrittenCommentary);
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.SaveQaEvidenceAsync(db.Review,draft.Evidence.Id,request with
            {WrittenCommentary="Stale overwrite",RowVersion=originalVersion},false,user,Token));
        var cleared=await store.SaveQaEvidenceAsync(db.Review,draft.Evidence.Id,request with
            {WrittenCommentary="",RowVersion=omitted.Evidence.RowVersion},false,user,Token);
        Assert.Null(cleared.WrittenCommentary);
        var submitted=await store.SaveQaEvidenceAsync(db.Review,draft.Evidence.Id,request with
            {WrittenCommentary="Submitted commentary",RowVersion=cleared.Evidence.RowVersion,DeliveryAreaKey="campus"},true,user,Token);
        Assert.Equal("submitted",submitted.Evidence.Status);Assert.Equal("Submitted commentary",submitted.WrittenCommentary);
        var revision=await db.ScalarAsync<string>($"SELECT snapshot_json FROM qa.evidence_revisions WHERE evidence_record_id='{draft.Evidence.Id}' AND version_number=1;");
        Assert.Equal("Submitted commentary",JsonDocument.Parse(revision).RootElement.GetProperty("request").GetProperty("WrittenCommentary").GetString());
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.SaveQaEvidenceAsync(db.Review,draft.Evidence.Id,request with
            {RowVersion=submitted.Evidence.RowVersion,WrittenCommentary="Correction without reason",DeliveryAreaKey="campus"},false,user,Token));
        var corrected=await store.SaveQaEvidenceAsync(db.Review,draft.Evidence.Id,request with
            {RowVersion=submitted.Evidence.RowVersion,WrittenCommentary="Corrected commentary",CorrectionReason="Clarify meeting evidence",DeliveryAreaKey="campus"},false,user,Token);
        Assert.Equal(2,corrected.Evidence.VersionNumber);Assert.Equal("Corrected commentary",corrected.WrittenCommentary);
        Assert.Equal(2,corrected.Revisions.Count);Assert.Equal("Earlier criterion comment",Assert.Single(corrected.Responses).Comment);
        var exportRead=await store.GetQaEvidenceAsync(draft.Evidence.Id,user,Token,includeEditingMetadata:false);
        Assert.Equal("Corrected commentary",exportRead!.WrittenCommentary);Assert.True(exportRead.WrittenCommentaryEnabled);Assert.False(exportRead.Evidence.CanEdit);
        Assert.Equal(1,await db.ScalarAsync<int>($"SELECT COUNT(*) FROM ops.audit_logs WHERE record_id='{draft.Evidence.Id}' AND JSON_VALUE(before_json,'$.WrittenCommentary')=N'Submitted commentary' AND JSON_VALUE(after_json,'$.WrittenCommentary')=N'Corrected commentary';"));
        var before=await db.ScalarAsync<int>("SELECT COUNT(*) FROM core.records;");
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.SaveQaEvidenceAsync(db.Review,null,request with
            {ReviewActivityId=db.DisabledActivity,Responses=[new(db.DisabledQuestion,"at",null,null)]},false,user,Token));
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.SaveQaEvidenceAsync(db.Review,null,request with
            {WrittenCommentary=new string('x',10001)},false,user,Token));
        var outsider=user with{Permissions=new HashSet<string>{PermissionKeys.QaReviewsViewAll}};
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>store.SaveQaEvidenceAsync(db.Review,null,request,false,outsider,Token));
        Assert.Equal(before,await db.ScalarAsync<int>("SELECT COUNT(*) FROM core.records;"));
        var disabled=await store.SaveQaEvidenceAsync(db.Review,null,request with{ReviewActivityId=db.DisabledActivity,
            Responses=[new(db.DisabledQuestion,"at",null,null)],WrittenCommentary=null,DeliveryAreaKey="campus"},true,user,Token);
        Assert.False(disabled.WrittenCommentaryEnabled);Assert.Null(disabled.WrittenCommentary);Assert.Equal("submitted",disabled.Evidence.Status);
    }

    private sealed class CommentaryDatabase:IAsyncDisposable
    {
        private readonly string master;
        private readonly string name="TLQS_QaCommentaryTest_"+Guid.NewGuid().ToString("N");
        private bool created;
        public string ConnectionString{get;private set;}="";
        public Guid Staff{get;}=Guid.NewGuid();public Guid Account{get;}=Guid.NewGuid();
        public Guid Faculty{get;}=Guid.NewGuid();public Guid Team{get;}=Guid.NewGuid();public Guid OtherTeam{get;}=Guid.NewGuid();
        public Guid Review{get;}=Guid.NewGuid();public Guid Activity{get;}=Guid.NewGuid();public Guid DisabledActivity{get;}=Guid.NewGuid();
        public Guid Type{get;}=Guid.NewGuid();public Guid Template{get;}=Guid.NewGuid();public Guid Question{get;}=Guid.NewGuid();
        public Guid FrozenQuestion{get;}=Guid.NewGuid();public Guid DisabledQuestion{get;}=Guid.NewGuid();
        private CommentaryDatabase(string connection)=>master=connection;
        public SqlFoundationDataStore Store()=>new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
            {["ConnectionStrings:TlqsDatabase"]=ConnectionString}).Build(),NullLogger<SqlFoundationDataStore>.Instance);
        public CurrentUser User()=>new(Account,Staff,"QA commentary test","qa@example.invalid",new HashSet<string>
            {PermissionKeys.QaReviewsManage,PermissionKeys.QaReviewsViewAll,PermissionKeys.QaReviewsSubmitAll,PermissionKeys.QaReviewsCorrect},[]);

        public static async Task<CommentaryDatabase> CreateAsync()
        {
            var builder=new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TLQS_TEST_SQL_MASTER"));
            if(!builder.InitialCatalog.Equals("master",StringComparison.OrdinalIgnoreCase)||!string.IsNullOrEmpty(builder.AttachDBFilename)
                ||!(builder.DataSource.StartsWith("(localdb)",StringComparison.OrdinalIgnoreCase)||builder.DataSource is "." or "localhost"))
                throw new InvalidOperationException("QA commentary tests require an explicit local, unattached Database=master connection.");
            var db=new CommentaryDatabase(builder.ConnectionString);
            await using(var connection=new SqlConnection(db.master)){await connection.OpenAsync();await using var create=new SqlCommand($"CREATE DATABASE [{db.name}];",connection){CommandTimeout=120};await create.ExecuteNonQueryAsync();db.created=true;}
            builder.InitialCatalog=db.name;db.ConnectionString=builder.ConnectionString;
            try
            {
                foreach(var schema in new[]{"qa","core","people","auth","org","ops"})await db.ExecuteAsync($"CREATE SCHEMA {schema};");
                await db.ExecuteAsync("""
                    CREATE TABLE people.staff(id uniqueidentifier PRIMARY KEY,display_name nvarchar(200));
                    CREATE TABLE auth.user_accounts(id uniqueidentifier PRIMARY KEY,staff_id uniqueidentifier);
                    CREATE TABLE auth.roles(id uniqueidentifier PRIMARY KEY,role_key nvarchar(100),is_active bit,archived_at datetimeoffset NULL);
                    CREATE TABLE auth.user_roles(user_account_id uniqueidentifier,role_id uniqueidentifier,active_from datetimeoffset,active_to datetimeoffset NULL);
                    CREATE TABLE auth.permissions(id uniqueidentifier PRIMARY KEY,permission_key nvarchar(150));
                    CREATE TABLE auth.role_permissions(role_id uniqueidentifier,permission_id uniqueidentifier);
                    CREATE TABLE org.org_units(id uniqueidentifier PRIMARY KEY,parent_org_unit_id uniqueidentifier NULL,org_unit_type nvarchar(50),code nvarchar(100),name nvarchar(200),is_active bit DEFAULT 1,archived_at datetimeoffset NULL);
                    CREATE TABLE core.modules(id uniqueidentifier PRIMARY KEY,module_key nvarchar(100));
                    CREATE TABLE core.records(id uniqueidentifier PRIMARY KEY,module_id uniqueidentifier,record_type nvarchar(100),title nvarchar(300),summary nvarchar(max),subject_staff_id uniqueidentifier NULL,owner_staff_id uniqueidentifier,org_unit_id uniqueidentifier NULL,record_date date,academic_year_key nvarchar(20),created_by_user_account_id uniqueidentifier,updated_by_user_account_id uniqueidentifier,created_at datetimeoffset DEFAULT sysutcdatetime(),updated_at datetimeoffset NULL,archived_at datetimeoffset NULL);
                    CREATE TABLE core.lookup_types(id uniqueidentifier PRIMARY KEY,lookup_key nvarchar(100),is_active bit DEFAULT 1,archived_at datetimeoffset NULL);
                    CREATE TABLE core.lookup_values(id uniqueidentifier PRIMARY KEY,lookup_type_id uniqueidentifier,value_key nvarchar(100),display_name nvarchar(300),is_active bit DEFAULT 1,archived_at datetimeoffset NULL);
                    CREATE TABLE qa.reviews(record_id uniqueidentifier PRIMARY KEY,status nvarchar(30) DEFAULT N'draft',review_theme nvarchar(300),question_tag nvarchar(80),planned_open_date date NULL,closing_date date,updated_at datetimeoffset NULL,row_version rowversion);
                    CREATE TABLE qa.review_scopes(review_id uniqueidentifier,org_unit_id uniqueidentifier,scope_type nvarchar(30),org_unit_code_snapshot nvarchar(100),org_unit_name_snapshot nvarchar(200),parent_org_unit_id uniqueidentifier,parent_code_snapshot nvarchar(100),parent_name_snapshot nvarchar(200));
                    CREATE TABLE qa.review_contributors(review_id uniqueidentifier,staff_id uniqueidentifier,assigned_org_unit_id uniqueidentifier NULL,is_active bit,active_to datetimeoffset NULL);
                    CREATE TABLE qa.activity_types(id uniqueidentifier PRIMARY KEY,activity_key nvarchar(100),name nvarchar(200));
                    CREATE TABLE qa.activity_templates(id uniqueidentifier PRIMARY KEY,activity_type_id uniqueidentifier,name nvarchar(200),is_active bit DEFAULT 1,archived_at datetimeoffset NULL,allows_not_seen bit DEFAULT 1,restrict_qa_staff bit DEFAULT 0);
                    CREATE TABLE qa.activity_template_staff(activity_template_id uniqueidentifier,staff_id uniqueidentifier);
                    CREATE TABLE qa.review_activities(id uniqueidentifier PRIMARY KEY,review_id uniqueidentifier,activity_type_id uniqueidentifier,activity_template_id uniqueidentifier,display_order int);
                    CREATE TABLE qa.questions(id uniqueidentifier PRIMARY KEY,activity_type_id uniqueidentifier,default_display_order int,is_retired bit DEFAULT 0,archived_at datetimeoffset NULL);
                    CREATE TABLE qa.question_versions(question_id uniqueidentifier,version_number int,question_text nvarchar(1000),is_active bit DEFAULT 1,source_status nvarchar(50) DEFAULT N'active');
                    CREATE TABLE qa.review_question_selections(review_activity_id uniqueidentifier,question_id uniqueidentifier,display_order int);
                    CREATE TABLE qa.review_questions(id uniqueidentifier PRIMARY KEY DEFAULT NEWID(),review_activity_id uniqueidentifier,question_text nvarchar(1000),theme_or_week nvarchar(100),guidance nvarchar(1000),display_order int,is_required bit,allows_not_applicable bit,comment_required_at_expected bit);
                    CREATE TABLE qa.evidence_submissions(record_id uniqueidentifier PRIMARY KEY,review_id uniqueidentifier,review_activity_id uniqueidentifier,faculty_org_unit_id uniqueidentifier,team_org_unit_id uniqueidentifier,faculty_code_snapshot nvarchar(100),faculty_name_snapshot nvarchar(200),team_code_snapshot nvarchar(100),team_name_snapshot nvarchar(200),course_programme nvarchar(300),course_level nvarchar(100),delivery_area_key nvarchar(100),delivery_area_name_snapshot nvarchar(300),subject_staff_id uniqueidentifier,reviewer_staff_id uniqueidentifier,activity_at datetimeoffset,sample_size int,contextual_notes nvarchar(max),evidence_links_json nvarchar(max),key_strengths nvarchar(max),areas_for_improvement nvarchar(max),recommended_actions nvarchar(max),additional_context nvarchar(max),status nvarchar(30),submitted_at datetimeoffset,submitted_by_user_account_id uniqueidentifier,version_number int,created_by_user_account_id uniqueidentifier,updated_by_user_account_id uniqueidentifier,updated_at datetimeoffset NULL,removed_at datetimeoffset NULL,row_version rowversion);
                    CREATE TABLE qa.evidence_responses(evidence_record_id uniqueidentifier,review_question_id uniqueidentifier,outcome nvarchar(30),comment nvarchar(max),not_applicable_reason nvarchar(max));
                    CREATE TABLE qa.evidence_team_scopes(evidence_record_id uniqueidentifier,team_org_unit_id uniqueidentifier,faculty_org_unit_id uniqueidentifier,faculty_code_snapshot nvarchar(100),faculty_name_snapshot nvarchar(200),team_code_snapshot nvarchar(100),team_name_snapshot nvarchar(200));
                    CREATE TABLE qa.evidence_revisions(evidence_record_id uniqueidentifier,version_number int,snapshot_json nvarchar(max),reason nvarchar(1000),created_by_user_account_id uniqueidentifier,created_at datetimeoffset DEFAULT sysutcdatetime());
                    CREATE TABLE ops.audit_logs(user_account_id uniqueidentifier,record_id uniqueidentifier,entity_name nvarchar(100),entity_id uniqueidentifier,action nvarchar(100),summary nvarchar(max),before_json nvarchar(max),after_json nvarchar(max),reason nvarchar(max));
                    """);
                await db.ExecuteAsync("CREATE FUNCTION org.fn_visible_org_units(@user uniqueidentifier) RETURNS TABLE AS RETURN SELECT id AS org_unit_id FROM org.org_units WHERE 1=0;");
                await db.ExecuteAsync($"""
                    INSERT people.staff VALUES('{db.Staff}',N'Test reviewer');INSERT auth.user_accounts VALUES('{db.Account}','{db.Staff}');
                    INSERT org.org_units(id,org_unit_type,code,name)VALUES('{db.Faculty}',N'faculty',N'F',N'Test faculty');
                    INSERT org.org_units(id,parent_org_unit_id,org_unit_type,code,name)VALUES('{db.Team}','{db.Faculty}',N'team',N'T',N'Test team'),('{db.OtherTeam}','{db.Faculty}',N'team',N'U',N'Other team');
                    INSERT core.modules VALUES(NEWID(),N'qa_reviews');
                    INSERT core.records(id,module_id,record_type,title,owner_staff_id,record_date,academic_year_key,created_by_user_account_id)
                    SELECT '{db.Review}',id,N'qa_review',N'Existing review','{db.Staff}','2026-12-01',N'2026/27','{db.Account}' FROM core.modules;
                    INSERT qa.reviews(record_id,status,review_theme,question_tag,closing_date)VALUES('{db.Review}',N'open',N'Test',N'general','2026-12-01');
                    INSERT qa.review_scopes(review_id,org_unit_id,scope_type,parent_org_unit_id)VALUES('{db.Review}','{db.Team}',N'team','{db.Faculty}');
                    INSERT qa.activity_types VALUES('{db.Type}',N'digital_learning_walk',N'Digital Learning Walk');
                    INSERT qa.activity_templates(id,activity_type_id,name)VALUES('{db.Template}','{db.Type}',N'Test template');
                    INSERT qa.review_activities VALUES('{db.Activity}','{db.Review}','{db.Type}','{db.Template}',0),('{db.DisabledActivity}','{db.Review}','{db.Type}','{db.Template}',1);
                    INSERT qa.questions(id,activity_type_id,default_display_order)VALUES('{db.Question}','{db.Type}',0);
                    INSERT qa.question_versions(question_id,version_number,question_text)VALUES('{db.Question}',1,N'New selected criterion');
                    INSERT qa.review_questions(id,review_activity_id,question_text,display_order,is_required,allows_not_applicable,comment_required_at_expected)
                    VALUES('{db.FrozenQuestion}','{db.Activity}',N'Frozen criterion',0,1,1,0),('{db.DisabledQuestion}','{db.DisabledActivity}',N'Other frozen criterion',0,1,1,0);
                    INSERT qa.evidence_responses VALUES(NEWID(),NEWID(),N'at',N'Earlier criterion comment',NULL);
                    DECLARE @lookup uniqueidentifier=NEWID();INSERT core.lookup_types(id,lookup_key)VALUES(@lookup,N'liv_delivery_area');
                    INSERT core.lookup_values(id,lookup_type_id,value_key,display_name)VALUES(NEWID(),@lookup,N'campus',N'Campus delivery');
                    """);
                await db.ApplyMigrationAsync();
                await db.ExecuteAsync($"UPDATE qa.review_activities SET written_commentary_enabled=0 WHERE id='{db.DisabledActivity}';");
                return db;
            }
            catch{await db.DisposeAsync();throw;}
        }

        public async Task ApplyMigrationAsync()
        {
            var root=new DirectoryInfo(AppContext.BaseDirectory);
            while(root is not null&&!File.Exists(Path.Combine(root.FullName,"database","migrations","097_qa_form_written_commentary.sql")))root=root.Parent;
            var sql=await File.ReadAllTextAsync(Path.Combine(root!.FullName,"database","migrations","097_qa_form_written_commentary.sql"));
            foreach(var batch in Regex.Split(sql,@"^\s*GO\s*$",RegexOptions.Multiline|RegexOptions.IgnoreCase).Where(batch=>!string.IsNullOrWhiteSpace(batch)))await ExecuteAsync(batch);
        }
        public async Task ExecuteAsync(string sql){await using var connection=new SqlConnection(ConnectionString);await connection.OpenAsync();await using var command=new SqlCommand(sql,connection){CommandTimeout=120};await command.ExecuteNonQueryAsync();}
        public async Task<T> ScalarAsync<T>(string sql){await using var connection=new SqlConnection(ConnectionString);await connection.OpenAsync();await using var command=new SqlCommand(sql,connection);return(T)(await command.ExecuteScalarAsync())!;}
        public async Task<SaveQaReviewRequest> ConfigurationAsync(Guid id,bool frozen)
        {
            await using var connection=new SqlConnection(ConnectionString);await connection.OpenAsync();await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync();
            var method=typeof(SqlFoundationDataStore).GetMethod("ReadQaReviewConfigurationAsync",BindingFlags.NonPublic|BindingFlags.Static)!;
            return await(Task<SaveQaReviewRequest>)method.Invoke(null,[connection,transaction,id,frozen,Token])!;
        }
        public async ValueTask DisposeAsync()
        {
            if(!created)return;SqlConnection.ClearAllPools();await using var connection=new SqlConnection(master);await connection.OpenAsync();
            await using var drop=new SqlCommand($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [{name}];",connection){CommandTimeout=120};await drop.ExecuteNonQueryAsync();created=false;
        }
    }
}
