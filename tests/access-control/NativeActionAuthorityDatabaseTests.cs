using System.Reflection;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Security;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class NativeActionAuthorityDatabaseTests
{
    private static readonly CancellationToken Token=CancellationToken.None;

    [AccountAdministrationDatabaseFact]
    public async Task Coaching_assignment_cannot_change_prior_outcomes_but_creator_manager_can()
    {
        await using var db=await NativeDatabase.CreateAsync();
        await using var connection=new SqlConnection(db.ConnectionString);await connection.OpenAsync();
        await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync();
        var placeholder=new CoachingActionReviewRequest(db.Action,null,null,null,null);
        Task Save(CurrentUser user,CoachingActionReviewRequest review)=>Invoke("SaveCoachingActionReviewsAsync",connection,transaction,
            db.Session,db.Record,db.Cycle,2,db.Assignee,db.Assignee,new[]{review},0,"completed",user,Token);
        await Save(db.User(),placeholder);
        Assert.Equal(0,await db.Scalar<int>(connection,transaction,"SELECT COUNT(*) FROM quality.coaching_action_reviews;"));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>Save(db.User(),placeholder with{ReviewOutcome="completed",ProgressUpdate="Claimed completion"}));
        Assert.Equal("open",await db.Scalar<string>(connection,transaction,"SELECT value.value_key FROM quality.actions action JOIN core.lookup_values value ON value.id=action.status_lookup_value_id;"));
        await Save(db.User(manager:true),placeholder with{ReviewOutcome="completed",ProgressUpdate="Creator's manager reviewed the evidence"});
        Assert.Equal("complete",await db.Scalar<string>(connection,transaction,"SELECT value.value_key FROM quality.actions action JOIN core.lookup_values value ON value.id=action.status_lookup_value_id;"));
        Assert.Equal(1,await db.Scalar<int>(connection,transaction,"SELECT COUNT(*) FROM quality.coaching_action_reviews;"));
    }

    [AccountAdministrationDatabaseFact]
    public async Task Coaching_readonly_actions_survive_narrative_saves_and_reject_edits_removal_and_review_erasure()
    {
        await using var db=await NativeDatabase.CreateAsync();
        await using var connection=new SqlConnection(db.ConnectionString);await connection.OpenAsync();
        await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync();
        await db.Execute(connection,transaction,$"UPDATE quality.actions SET source_sub_record_id='{db.Session}',published_to_staff=0;");
        var action=new CoachingSessionActionRequest(db.Action,"Assessment","Review feedback","staff",new(2026,12,1),"Evidence","Impact",new(2026,12,1),"not_started");
        Task Save(CoachingSessionActionRequest[] rows)=>Invoke("SaveCoachingSessionActionsAsync",connection,transaction,db.Session,db.Record,db.Assignee,db.Assignee,rows,"draft",db.User(),Token);
        await Save([action]);
        Assert.Equal(0,await db.Scalar<int>(connection,transaction,"SELECT COUNT(*) FROM quality.actions WHERE updated_at IS NOT NULL;"));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>Save([action with{ActionText="Assignee changed the action"}]));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>Save([]));
        await db.Execute(connection,transaction,$"INSERT quality.coaching_action_reviews(session_id,action_id,review_outcome,progress_update) VALUES('{db.Session}','{db.Action}',N'continue',N'Original review');");
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>Invoke("EnsureCanRemoveCoachingReviewsAsync",connection,transaction,db.Session,new HashSet<Guid>(),db.User(),Token));
        Assert.Equal(1,await db.Scalar<int>(connection,transaction,"SELECT COUNT(*) FROM quality.coaching_action_reviews;"));
        Assert.Equal("Review feedback",await db.Scalar<string>(connection,transaction,"SELECT title FROM quality.actions;"));
    }

    [AccountAdministrationDatabaseFact]
    public async Task Qa_group_capabilities_and_bulk_closure_follow_creator_hierarchy_instead_of_assignee_or_broad_grants()
    {
        await using var db=await NativeDatabase.CreateAsync();var store=db.Store();
        await db.UseOrgOnlyManagement();
        var assignee=db.User() with{Permissions=new HashSet<string>{PermissionKeys.QaReviewsManage}};
        var groups=await ReadGroups(store,db.Group,assignee);
        Assert.False(Assert.Single(groups).CanReview);Assert.False(Assert.Single(groups).CanClose);
        var initial=Assert.Single(groups);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>store.ReviewQaActionGroupAsync(db.Group,new(initial.RowVersion),assignee,Token));
        var manager=db.User(manager:true);
        var managed=Assert.Single(await ReadGroups(store,db.Group,manager));
        Assert.True(managed.CanReview);
        managed=await store.ReviewQaActionGroupAsync(db.Group,new(managed.RowVersion),manager,Token);
        Assert.True(managed.CanClose);
        var closed=await store.CloseQaActionGroupAsync(db.Group,new(managed.RowVersion),manager,Token);
        Assert.Equal("closed",closed.Status);Assert.False(closed.CanClose);
        await using var connection=new SqlConnection(db.ConnectionString);await connection.OpenAsync();
        Assert.Equal("complete",await db.Scalar<string>(connection,null,"SELECT value.value_key FROM quality.actions action JOIN core.lookup_values value ON value.id=action.status_lookup_value_id;"));
    }

    [AccountAdministrationDatabaseFact]
    public async Task Replacing_legacy_eli_draft_cannot_archive_another_creators_action()
    {
        await using var db=await NativeDatabase.CreateAsync();
        await using var connection=new SqlConnection(db.ConnectionString);await connection.OpenAsync();
        await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync();
        await db.Execute(connection,transaction,$"INSERT quality.elevate_practice_development_plans(assessment_id,action_id) VALUES('{db.Record}','{db.Action}');");
        Task Clear(CurrentUser user)=>Invoke("ClearLegacyElevateDraftAsync",connection,transaction,db.Record,user,Token);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>Clear(db.User()));
        Assert.Equal(1,await db.Scalar<int>(connection,transaction,"SELECT COUNT(*) FROM quality.elevate_practice_development_plans;"));
        Assert.Equal(0,await db.Scalar<int>(connection,transaction,"SELECT COUNT(*) FROM quality.actions WHERE archived_at IS NOT NULL;"));
        await Clear(db.User(manager:true));
        Assert.Equal(0,await db.Scalar<int>(connection,transaction,"SELECT COUNT(*) FROM quality.elevate_practice_development_plans;"));
        Assert.Equal(1,await db.Scalar<int>(connection,transaction,"SELECT COUNT(*) FROM quality.actions WHERE archived_at IS NOT NULL;"));
    }

    private static Task Invoke(string name,params object?[] args)=>(Task)typeof(SqlFoundationDataStore).GetMethod(name,BindingFlags.NonPublic|BindingFlags.Static)!.Invoke(null,args)!;
    private static Task<IReadOnlyList<QaActionGroupSummary>> ReadGroups(SqlFoundationDataStore store,Guid id,CurrentUser user)=>
        (Task<IReadOnlyList<QaActionGroupSummary>>)typeof(SqlFoundationDataStore).GetMethod("LoadQaActionGroupsAsync",BindingFlags.NonPublic|BindingFlags.Instance)!.Invoke(store,[null,user,Token])!;

    private sealed class NativeDatabase:IAsyncDisposable
    {
        private readonly string master;private readonly string name="TLQS_NativeActionAuthority_"+Guid.NewGuid().ToString("N");private bool created;
        public string ConnectionString{get;private set;}="";
        public Guid Creator{get;}=Guid.NewGuid();public Guid CreatorAccount{get;}=Guid.NewGuid();public Guid Assignee{get;}=Guid.NewGuid();public Guid AssigneeAccount{get;}=Guid.NewGuid();
        public Guid Manager{get;}=Guid.NewGuid();public Guid ManagerAccount{get;}=Guid.NewGuid();public Guid Action{get;}=Guid.NewGuid();public Guid Record{get;}=Guid.NewGuid();
        public Guid Cycle{get;}=Guid.NewGuid();public Guid Origin{get;}=Guid.NewGuid();public Guid Session{get;}=Guid.NewGuid();public Guid Group{get;}=Guid.NewGuid();public Guid Unit{get;}=Guid.NewGuid();
        private NativeDatabase(string masterConnection)=>master=masterConnection;
        public CurrentUser User(bool manager=false)=>new(manager?ManagerAccount:AssigneeAccount,manager?Manager:Assignee,"Native action test","native@example.invalid",new HashSet<string>(),[]);
        public SqlFoundationDataStore Store()=>new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"ConnectionStrings:TlqsDatabase",ConnectionString}}).Build(),NullLogger<SqlFoundationDataStore>.Instance);
        public static async Task<NativeDatabase> CreateAsync()
        {
            var master=Environment.GetEnvironmentVariable("TLQS_TEST_SQL_MASTER")!;
            var parsed=new SqlConnectionStringBuilder(master);if(!string.Equals(parsed.InitialCatalog,"master",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Only master is accepted.");
            var db=new NativeDatabase(master);await using(var connection=new SqlConnection(master)){await connection.OpenAsync();await db.Execute(connection,null,$"CREATE DATABASE [{db.name}];");db.created=true;}
            parsed.InitialCatalog=db.name;db.ConnectionString=parsed.ConnectionString;
            try
            {
                await using var connection=new SqlConnection(db.ConnectionString);await connection.OpenAsync();
                foreach(var schema in new[]{"quality","core","people","auth","org","qa","ops"})await db.Execute(connection,null,$"CREATE SCHEMA {schema};");
                await db.Execute(connection,null,"""
                    CREATE TABLE people.staff(id uniqueidentifier PRIMARY KEY,display_name nvarchar(200),account_status nvarchar(50) DEFAULT N'active',archived_at datetimeoffset,primary_org_unit_id uniqueidentifier);
                    CREATE TABLE auth.user_accounts(id uniqueidentifier PRIMARY KEY,staff_id uniqueidentifier);
                    CREATE TABLE org.org_units(id uniqueidentifier PRIMARY KEY,name nvarchar(200),parent_org_unit_id uniqueidentifier,is_active bit DEFAULT 1,archived_at datetimeoffset);
                    CREATE TABLE org.org_unit_leaderships(org_unit_id uniqueidentifier,leader_staff_id uniqueidentifier,leadership_role nvarchar(50),archived_at datetimeoffset,active_from date,active_to date);
                    CREATE TABLE org.staff_org_memberships(staff_id uniqueidentifier,org_unit_id uniqueidentifier,active_from date,active_to date,archived_at datetimeoffset);
                    CREATE TABLE core.records(id uniqueidentifier PRIMARY KEY,title nvarchar(300));
                    CREATE TABLE core.lookup_types(id uniqueidentifier PRIMARY KEY,lookup_key nvarchar(100));
                    CREATE TABLE core.lookup_values(id uniqueidentifier PRIMARY KEY,lookup_type_id uniqueidentifier,value_key nvarchar(100));
                    CREATE TABLE quality.actions(id uniqueidentifier PRIMARY KEY,created_by_user_account_id uniqueidentifier,owner_staff_id uniqueidentifier,
                        source_sub_record_type nvarchar(100),source_sub_record_id uniqueidentifier,source_display_order int,action_theme nvarchar(300),title nvarchar(300),owner_context nvarchar(50),
                        due_date date,original_due_date date,intended_evidence nvarchar(max),intended_impact nvarchar(max),review_date date,progress_status nvarchar(50),parent_action_id uniqueidentifier,
                        published_to_staff bit,archived_at datetimeoffset,deleted_by_user_account_id uniqueidentifier,deletion_reason nvarchar(max),updated_at datetimeoffset,updated_by_user_account_id uniqueidentifier,status_lookup_value_id uniqueidentifier,
                        completed_date date,completion_note nvarchar(max),completed_by_user_account_id uniqueidentifier,cancelled_at datetimeoffset,cancelled_by_user_account_id uniqueidentifier,cancellation_comments nvarchar(max));
                    CREATE TABLE quality.coaching_sessions(id uniqueidentifier PRIMARY KEY,cycle_id uniqueidentifier,session_number int,status nvarchar(50));
                    CREATE TABLE quality.coaching_action_reviews(session_id uniqueidentifier,action_id uniqueidentifier,review_outcome nvarchar(50),progress_update nvarchar(max),impact_observed nvarchar(max),
                        revised_action_id uniqueidentifier,created_by_user_account_id uniqueidentifier,updated_by_user_account_id uniqueidentifier,updated_at datetimeoffset);
                    CREATE TABLE qa.action_groups(id uniqueidentifier PRIMARY KEY,review_id uniqueidentifier,faculty_org_unit_id uniqueidentifier,faculty_name_snapshot nvarchar(200),
                        title nvarchar(300),detail nvarchar(max),due_date date,workflow_status nvarchar(50),created_at datetimeoffset DEFAULT sysutcdatetime(),creator_staff_id uniqueidentifier,created_by_user_account_id uniqueidentifier,
                        reviewed_at datetimeoffset,closed_at datetimeoffset,forced_close_note nvarchar(max),row_version rowversion,reviewed_by_user_account_id uniqueidentifier,closed_by_user_account_id uniqueidentifier,updated_at datetimeoffset);
                    CREATE TABLE qa.action_group_teams(action_group_id uniqueidentifier,team_org_unit_id uniqueidentifier,team_name_snapshot nvarchar(200));
                    CREATE TABLE qa.action_group_assignments(action_group_id uniqueidentifier,action_id uniqueidentifier,staff_id uniqueidentifier,assignment_role nvarchar(50),source_org_unit_id uniqueidentifier);
                    CREATE TABLE qa.review_scopes(review_id uniqueidentifier,scope_type nvarchar(50),org_unit_id uniqueidentifier,parent_org_unit_id uniqueidentifier);
                    CREATE TABLE ops.audit_logs(user_account_id uniqueidentifier,record_id uniqueidentifier,entity_name nvarchar(100),entity_id uniqueidentifier,action nvarchar(100),summary nvarchar(max),before_json nvarchar(max),after_json nvarchar(max));
                    CREATE TABLE quality.elevate_practice_development_plans(assessment_id uniqueidentifier,action_id uniqueidentifier);
                    CREATE TABLE quality.elevate_practice_selections(assessment_id uniqueidentifier);
                    CREATE TABLE quality.elevate_practice_reflections(assessment_id uniqueidentifier);
                    CREATE TABLE quality.elevate_practice_ratings(assessment_id uniqueidentifier);
                    CREATE TABLE quality.elevate_practice_area_ratings(assessment_id uniqueidentifier);
                    CREATE TABLE quality.elevate_practice_liv_information(assessment_id uniqueidentifier);
                    """);
                await db.Execute(connection,null,$"CREATE FUNCTION org.fn_visible_staff(@user uniqueidentifier) RETURNS TABLE AS RETURN SELECT id AS staff_id,CONVERT(bit,CASE WHEN @user='{db.ManagerAccount}' AND id='{db.Creator}' THEN 1 ELSE 0 END) AS is_managed,CASE WHEN @user='{db.ManagerAccount}' AND id='{db.Creator}' THEN 1 ELSE 0 END AS manager_depth FROM people.staff;");
                await db.Execute(connection,null,$"""
                    INSERT people.staff(id,display_name,primary_org_unit_id) VALUES('{db.Creator}',N'Creator','{db.Unit}'),('{db.Assignee}',N'Assignee',NULL),('{db.Manager}',N'Creator manager',NULL);
                    INSERT auth.user_accounts VALUES('{db.CreatorAccount}','{db.Creator}'),('{db.AssigneeAccount}','{db.Assignee}'),('{db.ManagerAccount}','{db.Manager}');
                    INSERT core.records VALUES('{db.Record}',N'QA source');INSERT org.org_units(id,name) VALUES('{db.Unit}',N'Test unit');
                    DECLARE @type uniqueidentifier=NEWID();INSERT core.lookup_types VALUES(@type,N'action_status');
                    INSERT core.lookup_values VALUES(NEWID(),@type,N'open'),(NEWID(),@type,N'complete'),(NEWID(),@type,N'cancelled');
                    INSERT quality.coaching_sessions VALUES('{db.Origin}','{db.Cycle}',1,N'completed'),('{db.Session}','{db.Cycle}',2,N'draft');
                    INSERT quality.actions(id,created_by_user_account_id,owner_staff_id,source_sub_record_type,source_sub_record_id,source_display_order,action_theme,title,owner_context,
                        due_date,original_due_date,intended_evidence,intended_impact,review_date,progress_status,published_to_staff,status_lookup_value_id)
                    VALUES('{db.Action}','{db.CreatorAccount}','{db.Assignee}',N'coaching_session','{db.Origin}',1,N'Assessment',N'Review feedback',N'staff',
                        '2026-12-01','2026-12-01',N'Evidence',N'Impact','2026-12-01',N'not_started',1,(SELECT id FROM core.lookup_values WHERE value_key=N'open'));
                    INSERT qa.action_groups(id,review_id,title,due_date,workflow_status,creator_staff_id,created_by_user_account_id)
                    VALUES('{db.Group}','{db.Record}',N'QA action','2026-12-01',N'open','{db.Creator}','{db.CreatorAccount}');
                    INSERT qa.action_group_assignments VALUES('{db.Group}','{db.Action}','{db.Assignee}',N'pl','{db.Unit}');
                    """);
                return db;
            }
            catch{await db.DisposeAsync();throw;}
        }
        public async Task Execute(SqlConnection connection,SqlTransaction? transaction,string sql){await using var command=new SqlCommand(sql,connection,transaction);await command.ExecuteNonQueryAsync();}
        public async Task UseOrgOnlyManagement()
        {
            await using var connection=new SqlConnection(ConnectionString);await connection.OpenAsync();
            await Execute(connection,null,"ALTER FUNCTION org.fn_visible_staff(@user uniqueidentifier) RETURNS TABLE AS RETURN SELECT id AS staff_id,CONVERT(bit,0) AS is_managed,0 AS manager_depth FROM people.staff;");
            await Execute(connection,null,$"INSERT org.org_unit_leaderships(org_unit_id,leader_staff_id,leadership_role,active_from) VALUES('{Unit}','{Manager}',N'manager','2020-01-01');");
        }
        public async Task<T> Scalar<T>(SqlConnection connection,SqlTransaction? transaction,string sql){await using var command=new SqlCommand(sql,connection,transaction);return(T)(await command.ExecuteScalarAsync())!;}
        public async ValueTask DisposeAsync(){if(!created)return;SqlConnection.ClearAllPools();await using var connection=new SqlConnection(master);await connection.OpenAsync();await using var command=new SqlCommand($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}];",connection);await command.ExecuteNonQueryAsync();created=false;}
    }
}
