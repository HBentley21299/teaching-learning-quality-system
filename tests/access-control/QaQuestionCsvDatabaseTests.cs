using System.Data;
using System.Reflection;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Security;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class QaQuestionCsvDatabaseTests
{
    [AccountAdministrationDatabaseFact]
    public async Task Qa_csv_pipeline_rolls_back_every_row_and_audit_then_supports_replay_stale_preview_and_admin_denial()
    {
        await using var database=await CsvDatabase.CreateAsync();
        var configuration=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> {
            ["ConnectionStrings:TlqsDatabase"]=database.ConnectionString
        }).Build();
        var store=new SqlFoundationDataStore(configuration,NullLogger<SqlFoundationDataStore>.Instance);
        var user=new CurrentUser(database.ActorId,null,"CSV test administrator","csv@example.invalid",
            new HashSet<string> {PermissionKeys.QaReviewsManage},[]) {IsAdministrator=true};
        const string failing="question_reference,activity_key,question_text\nfirst,lesson_visit,First criterion\nsecond,lesson_visit,REJECT_SECOND_TEST_ROW";
        var failedPlan=await Preview(store,failing,user);
        Assert.True(PreviewResult(failedPlan,2).CanImport);
        await Assert.ThrowsAsync<SqlException>(()=>Apply(store,failing,Fingerprint(failedPlan),user));
        Assert.Equal(new[] {0,0,0,0},await database.CountsAsync());
        await database.ExecuteAsync("DROP TRIGGER qa.reject_csv_test_question;");

        const string accepted="question_reference,activity_key,question_text\nfirst,lesson_visit,First criterion\nsecond,lesson_visit,Second criterion";
        var plan=await Preview(store,accepted,user);
        var result=await Apply(store,accepted,Fingerprint(plan),user);
        Assert.Equal(2,result.CreatedCount);
        Assert.Equal(new[] {2,2,2,3},await database.CountsAsync());
        Assert.Equal(2,await database.ScalarAsync("SELECT COUNT(*) FROM qa.question_versions WHERE version_number=1 AND source_status=N'draft' AND is_active=0;"));
        Assert.Equal(2,await database.ScalarAsync("SELECT COUNT(*) FROM qa.questions WHERE is_retired=1;"));
        Assert.Equal(1,await database.ScalarAsync("SELECT COUNT(*) FROM qa.review_questions WHERE question_text=N'Existing immutable snapshot';"));

        var replay=PreviewResult(await Preview(store,accepted,user),2);
        Assert.False(replay.CanImport);
        Assert.Equal(0,replay.CreateCount);
        Assert.Equal(2,replay.SkipCount);
        Assert.All(replay.Rows,row=>Assert.Equal("skip",row.Operation));
        Assert.Empty(replay.Issues);
        Assert.Equal(new[] {2,2,2,3},await database.CountsAsync());

        var changed=PreviewResult(await Preview(store,accepted.Replace("First criterion","Changed criterion"),user),2);
        Assert.False(changed.CanImport);
        Assert.Contains(changed.Issues,issue=>issue.Column=="question_reference");
        Assert.Equal(new[] {2,2,2,3},await database.CountsAsync());

        const string stale="question_reference,activity_key,question_text\nthird,lesson_visit,Third criterion";
        var stalePlan=await Preview(store,stale,user);
        await database.ExecuteAsync("UPDATE qa.activity_types SET is_active=0 WHERE activity_key=N'lesson_visit';");
        await Assert.ThrowsAsync<DBConcurrencyException>(()=>Apply(store,stale,Fingerprint(stalePlan),user));
        Assert.Equal(new[] {2,2,2,3},await database.CountsAsync());
        await database.ExecuteAsync("UPDATE qa.activity_types SET is_active=1 WHERE activity_key=N'lesson_visit';");

        var manager=user with {IsAdministrator=false};
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>Preview(store,stale,manager));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>Apply(store,stale,Fingerprint(stalePlan),manager));
        var administratorWithoutQa=user with {Permissions=new HashSet<string>()};
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>Preview(store,stale,administratorWithoutQa));
        Assert.Equal(new[] {2,2,2,3},await database.CountsAsync());

        var listUser=user with {Permissions=new HashSet<string> {PermissionKeys.ListsManage}};
        const string failingList="lookup_key,value_key,display_name\ncpd_theme,first,First choice\ncpd_theme,second,REJECT_SECOND_TEST_ROW";
        var failedListPlan=await Preview(store,failingList,listUser,"managed-list-values");
        await Assert.ThrowsAsync<SqlException>(()=>Apply(store,failingList,Fingerprint(failedListPlan),listUser,"managed-list-values"));
        Assert.Equal(0,await database.ScalarAsync("SELECT COUNT(*) FROM core.lookup_values;"));
        Assert.Equal(new[] {2,2,2,3},await database.CountsAsync());
        await database.ExecuteAsync("DROP TRIGGER core.reject_csv_test_choice;");
        const string acceptedList="lookup_key,value_key,display_name\ncpd_theme,first,First choice\ncpd_theme,second,Second choice";
        var listPlan=await Preview(store,acceptedList,listUser,"managed-list-values");
        Assert.Equal(2,(await Apply(store,acceptedList,Fingerprint(listPlan),listUser,"managed-list-values")).CreatedCount);
        Assert.Equal(2,await database.ScalarAsync("SELECT COUNT(*) FROM core.lookup_values WHERE is_active=1;"));
        var listReplay=PreviewResult(await Preview(store,acceptedList,listUser,"managed-list-values"),2);
        Assert.False(listReplay.CanImport);Assert.Equal(2,listReplay.SkipCount);Assert.Empty(listReplay.Issues);
        Assert.Equal(new[] {2,2,4,6},await database.CountsAsync());
    }

    private static async Task<object> Preview(SqlFoundationDataStore store,string csv,CurrentUser user,string kind="qa-questions")
    {
        var task=(Task)Method("PreviewAdminCsvAsync",false).Invoke(store,[kind,csv,user,CancellationToken.None])!;
        await task;
        return task.GetType().GetProperty("Result")!.GetValue(task)!;
    }
    private static Task<AdminCsvImportResult> Apply(SqlFoundationDataStore store,string csv,string fingerprint,CurrentUser user,string kind="qa-questions")=>
        (Task<AdminCsvImportResult>)Method("ApplyAdminCsvAsync",false).Invoke(store,[kind,csv,fingerprint,user,CancellationToken.None])!;
    private static string Fingerprint(object plan)=>(string)Method("AdminCsvPlanFingerprint",true).Invoke(null,[plan])!;
    private static AdminCsvImportPreview PreviewResult(object plan,int count)=>(AdminCsvImportPreview)Method("CsvPreview",true).Invoke(null,[plan,count,null])!;
    private static MethodInfo Method(string name,bool isStatic)=>typeof(SqlFoundationDataStore).GetMethod(name,
        BindingFlags.NonPublic | (isStatic ? BindingFlags.Static : BindingFlags.Instance))!;

    private sealed class CsvDatabase : IAsyncDisposable
    {
        private readonly string master;
        private readonly string name="TLQS_QaCsvTest_"+Guid.NewGuid().ToString("N");
        private bool created;
        public string ConnectionString {get;private set;}="";
        public Guid ActorId {get;}=Guid.NewGuid();
        private CsvDatabase(string connectionString)=>master=connectionString;

        public static async Task<CsvDatabase> CreateAsync()
        {
            var builder=new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TLQS_TEST_SQL_MASTER"));
            if(!string.Equals(builder.InitialCatalog,"master",StringComparison.OrdinalIgnoreCase) || !string.IsNullOrEmpty(builder.AttachDBFilename))
                throw new InvalidOperationException("CSV integration tests require an explicit, unattached Database=master connection.");
            if(!(builder.DataSource.StartsWith("(localdb)",StringComparison.OrdinalIgnoreCase) || builder.DataSource is "." or "localhost"))
                throw new InvalidOperationException("CSV integration tests run only on a local SQL Server master connection.");
            var result=new CsvDatabase(builder.ConnectionString);
            await using(var connection=new SqlConnection(result.master))
            {
                await connection.OpenAsync();
                await using var create=new SqlCommand($"CREATE DATABASE [{result.name}];",connection) {CommandTimeout=120};
                await create.ExecuteNonQueryAsync();result.created=true;
            }
            builder.InitialCatalog=result.name;result.ConnectionString=builder.ConnectionString;
            try
            {
                await result.ExecuteAsync("CREATE SCHEMA qa;");
                await result.ExecuteAsync("CREATE SCHEMA ops;");
                await result.ExecuteAsync("CREATE SCHEMA auth;");
                await result.ExecuteAsync("CREATE SCHEMA core;");
                await result.ExecuteAsync("""
                    CREATE TABLE auth.user_accounts(id uniqueidentifier PRIMARY KEY);
                    CREATE TABLE qa.activity_types(id uniqueidentifier PRIMARY KEY,activity_key nvarchar(80) UNIQUE,name nvarchar(200),is_active bit,archived_at datetimeoffset NULL);
                    CREATE TABLE qa.questions(id uniqueidentifier PRIMARY KEY,activity_type_id uniqueidentifier REFERENCES qa.activity_types(id),
                        question_key nvarchar(120) UNIQUE,default_display_order int,is_retired bit,archived_at datetimeoffset NULL);
                    CREATE TABLE qa.question_versions(id uniqueidentifier PRIMARY KEY DEFAULT NEWID(),question_id uniqueidentifier REFERENCES qa.questions(id),
                        version_number int,theme_or_week nvarchar(200),question_text nvarchar(1000),guidance nvarchar(2000),is_required bit,
                        allows_not_applicable bit,comment_required_at_expected bit,is_active bit,source_status nvarchar(20),question_tag nvarchar(80),
                        created_by_user_account_id uniqueidentifier REFERENCES auth.user_accounts(id),UNIQUE(question_id,version_number));
                    CREATE TABLE qa.review_questions(id uniqueidentifier PRIMARY KEY DEFAULT NEWID(),question_text nvarchar(1000));
                    CREATE TABLE ops.csv_import_items(kind varchar(40),source_reference nvarchar(200),payload_sha256 char(64),entity_id uniqueidentifier,
                        batch_id uniqueidentifier,imported_by_user_account_id uniqueidentifier REFERENCES auth.user_accounts(id),
                        imported_at datetime2 DEFAULT sysutcdatetime(),PRIMARY KEY(kind,source_reference));
                    CREATE TABLE ops.audit_logs(id uniqueidentifier PRIMARY KEY DEFAULT NEWID(),user_account_id uniqueidentifier REFERENCES auth.user_accounts(id),
                        record_id uniqueidentifier NULL,entity_name nvarchar(100),entity_id uniqueidentifier,action nvarchar(100),summary nvarchar(2000),
                        before_json nvarchar(max),after_json nvarchar(max));
                    CREATE TABLE core.lookup_types(id uniqueidentifier PRIMARY KEY,lookup_key nvarchar(100) UNIQUE,name nvarchar(200),is_active bit,archived_at datetimeoffset NULL);
                    CREATE TABLE core.admin_managed_lists(lookup_type_id uniqueidentifier PRIMARY KEY REFERENCES core.lookup_types(id),is_active bit);
                    CREATE TABLE core.lookup_values(id uniqueidentifier PRIMARY KEY,lookup_type_id uniqueidentifier REFERENCES core.lookup_types(id),
                        value_key nvarchar(100),display_name nvarchar(200),display_order int,is_active bit DEFAULT 1,archived_at datetimeoffset NULL,UNIQUE(lookup_type_id,value_key));
                    DECLARE @list uniqueidentifier=NEWID();
                    INSERT core.lookup_types(id,lookup_key,name,is_active) VALUES(@list,N'cpd_theme',N'CPD themes',1);
                    INSERT core.admin_managed_lists(lookup_type_id,is_active) VALUES(@list,1);
                    INSERT qa.activity_types(id,activity_key,name,is_active) VALUES(NEWID(),N'lesson_visit',N'Lesson Visit',1);
                    INSERT qa.review_questions(question_text) VALUES(N'Existing immutable snapshot');
                    """);
                await result.ExecuteAsync($"INSERT auth.user_accounts(id) VALUES('{result.ActorId}');");
                await result.ExecuteAsync("""
                    CREATE TRIGGER qa.reject_csv_test_question ON qa.question_versions AFTER INSERT AS
                    BEGIN
                        IF EXISTS(SELECT 1 FROM inserted WHERE question_text=N'REJECT_SECOND_TEST_ROW')
                            THROW 51091,'Forced second-row failure in isolated CSV test database.',1;
                    END;
                    """);
                await result.ExecuteAsync("""
                    CREATE TRIGGER core.reject_csv_test_choice ON core.lookup_values AFTER INSERT AS
                    BEGIN
                        IF EXISTS(SELECT 1 FROM inserted WHERE display_name=N'REJECT_SECOND_TEST_ROW')
                            THROW 51092,'Forced second-row failure in isolated CSV test database.',1;
                    END;
                    """);
                return result;
            }
            catch {await result.DisposeAsync();throw;}
        }
        public async Task ExecuteAsync(string sql)
        {
            await using var connection=new SqlConnection(ConnectionString);await connection.OpenAsync();
            await using var command=new SqlCommand(sql,connection);await command.ExecuteNonQueryAsync();
        }
        public async Task<int> ScalarAsync(string sql)
        {
            await using var connection=new SqlConnection(ConnectionString);await connection.OpenAsync();
            await using var command=new SqlCommand(sql,connection);return Convert.ToInt32(await command.ExecuteScalarAsync());
        }
        public async Task<int[]> CountsAsync()=>[
            await ScalarAsync("SELECT COUNT(*) FROM qa.questions;"),await ScalarAsync("SELECT COUNT(*) FROM qa.question_versions;"),
            await ScalarAsync("SELECT COUNT(*) FROM ops.csv_import_items;"),await ScalarAsync("SELECT COUNT(*) FROM ops.audit_logs;")];
        public async ValueTask DisposeAsync()
        {
            if(!created) return;
            SqlConnection.ClearAllPools();
            await using var connection=new SqlConnection(master);await connection.OpenAsync();
            await using var drop=new SqlCommand($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}];",connection);
            await drop.ExecuteNonQueryAsync();created=false;
        }
    }
}
