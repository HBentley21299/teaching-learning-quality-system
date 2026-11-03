using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ActionOriginDatabaseTests
{
    [AccountAdministrationDatabaseFact]
    public async Task Dashboard_actions_keep_ordinary_actions_without_assignees_and_shared_responsible_names_once()
    {
        await using var db=await OriginDatabase.CreateAsync();
        await db.SeedNativeMutationActions();
        await db.Execute("""
            CREATE TABLE core.academic_years(academic_year_key nvarchar(7),start_date date,end_date date,is_active bit,archived_at datetimeoffset NULL);
            INSERT core.academic_years VALUES(N'2026/27','2026-08-01','2027-07-31',1,NULL);
            ALTER TABLE core.records ADD record_date date NULL;
            ALTER TABLE quality.process_review_action_assignees ADD display_name_snapshot nvarchar(300) NULL;
            """);
        await db.Execute("""
            UPDATE core.records SET record_date='2026-10-01';
            UPDATE quality.actions SET created_at='2026-10-01T10:00:00+00:00';
            """);
        await db.Execute("CREATE FUNCTION org.fn_dashboard_process_unit_visible(@unit uniqueidentifier,@key nvarchar(100))RETURNS bit AS BEGIN RETURN 1;END;");
        var ordinary=Guid.NewGuid();
        await db.Execute($"""
            UPDATE core.records SET record_type=N'activate_growth_review' WHERE id='{db.NativeRecord}';
            UPDATE quality.actions SET source_form_type=N'activate_growth_review' WHERE id='{db.CurrentUcoAction}';
            INSERT quality.actions(id,source_record_id,source_form_type,owner_staff_id,action_theme,title,status_lookup_value_id,
                due_date,original_due_date,visibility_setting,published_to_staff,created_by_user_account_id,created_at)
            SELECT '{ordinary}','{db.CpdRecord}',N'cpd_event','{db.Staff}',N'Assessment',N'Apply professional learning',id,
                '2026-12-01','2026-12-01',N'staff_and_management',1,'{db.Account}','2026-10-01T10:00:00+00:00'
            FROM core.lookup_values WHERE lookup_type_id=(SELECT id FROM core.lookup_types WHERE lookup_key=N'action_status') AND value_key=N'open';
            """);
        var expectedNames=Enumerable.Range(1,12).Select(n=>$"Responsible colleague {n:00}").ToArray();
        foreach(var name in expectedNames)
            await db.Execute($"INSERT quality.process_review_action_assignees(action_id,staff_id,display_name_snapshot)VALUES('{db.CurrentUcoAction}',NEWID(),N'{name}');");
        var user=db.User() with{Permissions=new HashSet<string>{PermissionKeys.ReportsViewAll}};
        var rows=await db.Store().GetDashboardActionsAsync("2026/27",user,CancellationToken.None,"actions");
        Assert.Equal(5,rows.Count);
        Assert.Equal(rows.Count,rows.Select(row=>row.Id).Distinct().Count());
        Assert.Empty(Assert.Single(rows,row=>row.Id==ordinary).ResponsibleStaffNames!);
        Assert.Equal(expectedNames,Assert.Single(rows,row=>row.Id==db.CurrentUcoAction).ResponsibleStaffNames);
        Assert.All(rows.Where(row=>row.Id!=db.CurrentUcoAction),row=>Assert.Empty(row.ResponsibleStaffNames!));
    }

    [AccountAdministrationDatabaseFact]
    public async Task New_actions_resolve_a_real_origin_and_reject_missing_forged_archived_and_native_sources()
    {
        await using var db = await OriginDatabase.CreateAsync(); var store = db.Store(); var user = db.User();
        var request = new CreateActionRequest(db.CpdRecord, null, db.Staff, "Improve practice", "Apply the learning", null, null, null, new DateOnly(2026,12,1), true);
        var id = await store.CreateActionAsync(request, user, CancellationToken.None);
        Assert.Equal("cpd_event", await db.Scalar<string>($"SELECT source_form_type FROM quality.actions WHERE id='{id}';"));
        Assert.Equal(db.CpdRecord, await db.Scalar<Guid>($"SELECT source_record_id FROM quality.actions WHERE id='{id}';"));
        Assert.Equal(1, await db.Scalar<int>($"SELECT COUNT(*) FROM ops.domain_events WHERE aggregate_id='{id}' AND source_record_id='{db.CpdRecord}';"));
        Assert.Equal(1, await db.Scalar<int>($"SELECT COUNT(*) FROM ops.audit_logs WHERE entity_id='{id}' AND JSON_VALUE(after_json,'$.sourceFormType')=N'cpd_event';"));
        await store.CreateActionAsync(request with {SourceFormType=" CPD "}, user, CancellationToken.None);
        foreach (var invalid in new[] {
            request with {SourceRecordId=null}, request with {SourceRecordId=Guid.Empty}, request with {SourceRecordId=Guid.NewGuid()},
            request with {SourceRecordId=db.ArchivedRecord}, request with {SourceFormType="standalone"},
            request with {SourceFormType="learning_walk"}, request with {SourceRecordId=db.NativeRecord,SourceFormType="cpd_event"},
            request with {SourceRecordId=db.UnknownRecord}, request with {SubjectStaffId=Guid.Empty}
        }) await Assert.ThrowsAsync<WorkflowValidationException>(() => store.CreateActionAsync(invalid, user, CancellationToken.None));
        var outsider = new CurrentUser(Guid.NewGuid(), Guid.NewGuid(), "Outside scope", "outside@example.invalid", new HashSet<string>{PermissionKeys.ActionsManage}, []);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => store.CreateActionAsync(request, outsider, CancellationToken.None));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => store.CreateActionAsync(request,user with {Permissions=new HashSet<string>()},CancellationToken.None));
        Assert.Equal(2, await db.Scalar<int>("SELECT COUNT(*) FROM quality.actions;"));
        Assert.Equal(2, await db.Scalar<int>("SELECT COUNT(*) FROM ops.domain_events;"));
    }

    [AccountAdministrationDatabaseFact]
    public async Task Linked_origins_validate_the_actual_case_visit_cycle_and_subject_before_saving()
    {
        await using var db = await OriginDatabase.CreateAsync(); var store=db.Store(); var user=db.User();
        var request = new CreateActionRequest(db.LivRecord,null,db.Staff,"Improve practice","Follow up the visit",null,null,null,new DateOnly(2026,12,1),true,
            LivVisitId:db.Visit,LivCycleId:db.Cycle,SourceFormType:"liv");
        var action = await store.CreateActionAsync(request,user,CancellationToken.None);
        Assert.Equal(db.Staff,await db.Scalar<Guid>($"SELECT subject_staff_id FROM quality.actions WHERE id='{action}';"));
        Assert.Equal(db.Visit,await db.Scalar<Guid>($"SELECT source_sub_record_id FROM quality.actions WHERE id='{action}';"));
        foreach(var invalid in new[]{request with{LivCycleId=db.OtherCycle},request with{LivVisitId=Guid.NewGuid()},request with{SubjectStaffId=Guid.NewGuid()}})
            await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.CreateActionAsync(invalid,user,CancellationToken.None));
        var probation = await store.CreateActionAsync(request with{SourceRecordId=db.ProbationRecord,SourceFormType="probation_observation",LivVisitId=null,LivCycleId=null,
            SourceSubRecordType="probation_observation",SourceSubRecordId=db.Observation},user,CancellationToken.None);
        Assert.Equal("probation_observation",await db.Scalar<string>($"SELECT source_form_type FROM quality.actions WHERE id='{probation}';"));
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.CreateActionAsync(request with{SourceRecordId=db.ProbationRecord,SourceFormType="probation_observation",LivVisitId=null,LivCycleId=null,
            SourceSubRecordType="probation_observation",SourceSubRecordId=Guid.NewGuid()},user,CancellationToken.None));
        Assert.Equal(2,await db.Scalar<int>("SELECT COUNT(*) FROM quality.actions;"));
    }

    [AccountAdministrationDatabaseFact]
    public async Task Qa_assignments_keep_their_structure_and_closed_groups_cannot_be_progressed()
    {
        await using var db=await OriginDatabase.CreateAsync();await db.SeedNativeMutationActions();var store=db.Store();var user=db.User();
        var empty=new UpdateActionRequest(null,null,null,null,null,null);
        Assert.False(Assert.Single(await store.GetActionsAsync(user,false,CancellationToken.None),action=>action.Id==db.QaAction).SourceWorkflowLocked);
        foreach(var edit in new[]{empty with{OwnerStaffId=Guid.NewGuid()},empty with{Title="Different assignment"},empty with{Detail="Different detail"},
            empty with{ActionTheme="Different theme"},empty with{DueDate=new DateOnly(2027,1,1)},empty with{VisibilitySetting="owner_only"}})
            await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.UpdateActionAsync(db.QaAction,edit,user,CancellationToken.None));
        Assert.Equal(db.Staff,await db.Scalar<Guid>($"SELECT owner_staff_id FROM quality.actions WHERE id='{db.QaAction}';"));
        Assert.Equal(db.Staff,await db.Scalar<Guid>($"SELECT staff_id FROM qa.action_group_assignments WHERE action_id='{db.QaAction}';"));
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.DeleteActionAsync(db.QaAction,"Do not detach a group assignment",user,CancellationToken.None));
        Assert.Equal(0,await db.Scalar<int>("SELECT COUNT(*) FROM ops.audit_logs;"));

        // A closed REVIEW is the normal starting point for QA action work; its group is still open.
        Assert.Equal(FormSubmissionUpdateResult.Saved,await store.UpdateActionAsync(db.QaAction,empty with{Status="complete",CompletionNote="Evidence checked"},user,CancellationToken.None));
        Assert.Equal(FormSubmissionUpdateResult.Saved,await store.UpdateActionAsync(db.QaAction,empty with{Status="open"},user,CancellationToken.None));
        Assert.Equal(FormSubmissionUpdateResult.Saved,await store.UpdateActionAsync(db.QaAction,empty with{Status="complete",CompletionNote="Evidence checked"},user,CancellationToken.None));
        await db.Execute($"UPDATE qa.action_groups SET workflow_status=N'closed' WHERE id='{db.QaGroup}';");
        Assert.True(Assert.Single(await store.GetActionsAsync(user,false,CancellationToken.None),action=>action.Id==db.QaAction).SourceWorkflowLocked);
        foreach(var edit in new[]{empty with{Status="open"},empty with{Status="cancelled",CancellationComments="Bypass group closure"},empty with{CompletionNote="Unreviewed progress"}})
        {
            var failure=await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.UpdateActionAsync(db.QaAction,edit,user,CancellationToken.None));
            Assert.Contains("QA action",failure.Message);
        }
        var extended=await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.ExtendActionAsync(db.QaAction,new(new DateOnly(2027,1,1),"Bypass group closure"),user,CancellationToken.None));
        Assert.Contains("QA action",extended.Message);
        Assert.Equal("Evidence checked",await db.Scalar<string>($"SELECT completion_note FROM quality.actions WHERE id='{db.QaAction}';"));
        await db.Execute($"UPDATE qa.action_groups SET workflow_status=N'open' WHERE id='{db.QaGroup}';UPDATE qa.reviews SET status=N'archived' WHERE record_id='{db.QaRecord}';");
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.UpdateActionAsync(db.QaAction,empty with{Status="open"},user,CancellationToken.None));
        Assert.Equal(0,await db.Scalar<int>("SELECT COUNT(*) FROM quality.action_extensions;"));
    }

    [AccountAdministrationDatabaseFact]
    public async Task Superseded_uco_actions_cannot_be_restored_and_coaching_central_progress_stays_aligned()
    {
        await using var db=await OriginDatabase.CreateAsync();await db.SeedNativeMutationActions();var store=db.Store();var user=db.User();
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.RestoreActionAsync(db.SupersededUcoAction,user,CancellationToken.None));
        Assert.Equal(1,await db.Scalar<int>($"SELECT COUNT(*) FROM quality.actions WHERE source_record_id='{db.NativeRecord}' AND archived_at IS NULL;"));
        Assert.Equal(db.CurrentUcoAction,await db.Scalar<Guid>("SELECT central_action_id FROM quality.uco_tla_action_plans;"));
        var empty=new UpdateActionRequest(null,null,null,null,null,null);
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.UpdateActionAsync(db.CurrentUcoAction,empty with{DueDate=new DateOnly(2027,1,1)},user,CancellationToken.None));
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.UpdateActionAsync(db.CoachingAction,empty with{Detail="Bypass intended evidence"},user,CancellationToken.None));
        foreach(var change in new[]{empty with{Status="complete",CompletionNote="Applied in practice"},empty with{Status="cancelled",CancellationComments="Replaced approach"},empty with{Status="open"}})
        {
            Assert.Equal(FormSubmissionUpdateResult.Saved,await store.UpdateActionAsync(db.CoachingAction,change,user,CancellationToken.None));
            var action=Assert.Single(await store.GetActionsAsync(user,false,CancellationToken.None),action=>action.Id==db.CoachingAction);
            Assert.Equal(change.Status=="complete"?"completed":change.Status=="cancelled"?"closed":"not_started",action.ProgressStatus);
            Assert.Equal(change.Status,action.StatusKey);
        }
        Assert.Equal(FormSubmissionUpdateResult.Saved,await store.ExtendActionAsync(db.CoachingAction,new(new DateOnly(2026,12,15),"Evidence needs another session"),user,CancellationToken.None));
        Assert.Equal(1,await db.Scalar<int>($"SELECT COUNT(*) FROM quality.action_extensions WHERE action_id='{db.CoachingAction}' AND reason=N'Evidence needs another session';"));
        Assert.Equal(new DateTime(2026,12,1),await db.Scalar<DateTime>($"SELECT original_due_date FROM quality.actions WHERE id='{db.CoachingAction}';"));
        Assert.Equal(FormSubmissionUpdateResult.Saved,await store.UpdateActionAsync(db.LegacyAction,empty with{Title="Managed historical action"},user,CancellationToken.None));
        Assert.Equal(FormSubmissionUpdateResult.Saved,await store.DeleteActionAsync(db.LegacyAction,"Retire old unlinked action",user,CancellationToken.None));
        Assert.Equal(FormSubmissionUpdateResult.Saved,await store.RestoreActionAsync(db.LegacyAction,user,CancellationToken.None));
    }

    [AccountAdministrationDatabaseFact]
    public async Task Action_management_follows_creator_and_effective_org_hierarchy_not_assignee_or_reporting_scope()
    {
        await using var db=await OriginDatabase.CreateAsync();await db.SeedNativeMutationActions();var store=db.Store();
        var people=Enumerable.Range(0,10).Select(_=>(Staff:Guid.NewGuid(),Account:Guid.NewGuid())).ToArray();
        foreach(var person in people)await db.Execute($"INSERT people.staff(id,display_name,account_status)VALUES('{person.Staff}',N'Authority test staff',N'active');INSERT auth.user_accounts VALUES('{person.Account}','{person.Staff}');");
        var directorate=Guid.NewGuid();var faculty=Guid.NewGuid();var team=Guid.NewGuid();var outside=Guid.NewGuid();var secondary=Guid.NewGuid();var expiredMembership=Guid.NewGuid();
        await db.Execute($"""
            INSERT org.org_units(id,parent_org_unit_id,org_unit_type)VALUES
            ('{directorate}',NULL,N'directorate'),('{faculty}','{directorate}',N'faculty'),('{team}','{faculty}',N'team'),
            ('{outside}',NULL,N'faculty'),('{secondary}',NULL,N'team'),('{expiredMembership}',NULL,N'team');
            UPDATE people.staff SET primary_org_unit_id='{team}' WHERE id='{db.Staff}';
            INSERT org.staff_org_memberships(staff_id,org_unit_id,active_from,active_to)VALUES
            ('{db.Staff}','{secondary}','2020-01-01',NULL),('{db.Staff}','{expiredMembership}','2010-01-01','2011-01-01');
            INSERT org.org_unit_leaderships(org_unit_id,leader_staff_id,leadership_role,active_from,active_to)VALUES
            ('{team}','{people[1].Staff}',N'manager','2020-01-01',NULL),
            ('{faculty}','{people[2].Staff}',N'manager','2020-01-01',NULL),
            ('{directorate}','{people[3].Staff}',N'manager','2020-01-01',NULL),
            ('{outside}','{people[4].Staff}',N'manager','2020-01-01',NULL),
            ('{team}','{people[5].Staff}',N'manager','2010-01-01','2011-01-01'),
            ('{secondary}','{people[7].Staff}',N'manager','2020-01-01',NULL),
            ('{expiredMembership}','{people[8].Staff}',N'manager','2020-01-01',NULL);
            UPDATE core.records SET owner_staff_id='{people[0].Staff}' WHERE id='{db.CpdRecord}';
            UPDATE quality.actions SET source_record_id='{db.CpdRecord}',source_form_type=N'cpd_event',
                owner_staff_id='{people[0].Staff}',subject_staff_id='{people[0].Staff}' WHERE id='{db.LegacyAction}';
            """);
        CurrentUser User(int index)=>new(people[index].Account,people[index].Staff,"Authority test","authority@example.invalid",
            new HashSet<string>{PermissionKeys.ActionsManage,PermissionKeys.ReportsViewAll},[]);
        var allowed=new[]{db.User() with{Permissions=new HashSet<string>()},User(1),User(2),User(3),User(7),
            User(9) with{IsAdministrator=true},User(6) with{IsTeachingLearning=true}};
        var empty=new UpdateActionRequest(null,null,null,null,null,null);
        var day=new DateOnly(2027,1,1);
        foreach(var user in allowed)
        {
            var action=Assert.Single(await store.GetActionsAsync(user,false,CancellationToken.None),row=>row.Id==db.LegacyAction);
            Assert.True(action.CanManageAction);
            Assert.Equal(FormSubmissionUpdateResult.Saved,await store.UpdateActionAsync(db.LegacyAction,empty with{Status="complete",CompletionNote="Distance travelled confirmed"},user,CancellationToken.None));
            Assert.Equal(FormSubmissionUpdateResult.Saved,await store.UpdateActionAsync(db.LegacyAction,empty with{Status="open"},user,CancellationToken.None));
            Assert.Equal(FormSubmissionUpdateResult.Saved,await store.ExtendActionAsync(db.LegacyAction,new(day,"A further implementation cycle"),user,CancellationToken.None));day=day.AddDays(1);
            Assert.Equal(FormSubmissionUpdateResult.Saved,await store.DeleteActionAsync(db.LegacyAction,"Retire this action",user,CancellationToken.None));
            Assert.True(Assert.Single(await store.GetActionsAsync(user,true,CancellationToken.None),row=>row.Id==db.LegacyAction).CanManageAction);
            Assert.Equal(FormSubmissionUpdateResult.Saved,await store.RestoreActionAsync(db.LegacyAction,user,CancellationToken.None));
        }
        var auditCount=await db.Scalar<int>("SELECT COUNT(*) FROM ops.audit_logs;");
        foreach(var user in new[]{User(0),User(4),User(5),User(6),User(8)})
        {
            var action=Assert.Single(await store.GetActionsAsync(user,false,CancellationToken.None),row=>row.Id==db.LegacyAction);
            Assert.False(action.CanManageAction);
            Assert.Equal(FormSubmissionUpdateResult.Forbidden,await store.UpdateActionAsync(db.LegacyAction,empty with{Status="complete"},user,CancellationToken.None));
            Assert.Equal(FormSubmissionUpdateResult.Forbidden,await store.ExtendActionAsync(db.LegacyAction,new(day,"Unauthorised extension"),user,CancellationToken.None));
            Assert.Equal(FormSubmissionUpdateResult.Forbidden,await store.DeleteActionAsync(db.LegacyAction,"Unauthorised deletion",user,CancellationToken.None));
            Assert.Equal(FormSubmissionUpdateResult.Forbidden,await store.RestoreActionAsync(db.LegacyAction,user,CancellationToken.None));
        }
        Assert.Equal(auditCount,await db.Scalar<int>("SELECT COUNT(*) FROM ops.audit_logs;"));
        // Private LIV section visibility remains a read gate for the subject/assignee, but creator management is action-only authority.
        await db.Execute($"UPDATE quality.actions SET source_record_id='{db.LivRecord}',source_form_type=N'liv',source_sub_record_type=N'liv_visit',source_sub_record_id='{db.Visit}' WHERE id='{db.LegacyAction}';");
        await db.Execute($"CREATE OR ALTER FUNCTION quality.fn_liv_action_access(@action uniqueidentifier,@user uniqueidentifier)RETURNS TABLE AS RETURN SELECT 1 AS allowed WHERE @action<>'{db.LegacyAction}';");
        Assert.DoesNotContain(await store.GetActionsAsync(User(0),false,CancellationToken.None),row=>row.Id==db.LegacyAction);
        Assert.True(Assert.Single(await store.GetActionsAsync(User(2),false,CancellationToken.None),row=>row.Id==db.LegacyAction).CanManageAction);
        Assert.Equal(FormSubmissionUpdateResult.Saved,await store.ExtendActionAsync(db.LegacyAction,new(day,"Creator's head of faculty reviewed the implementation date"),User(2),CancellationToken.None));
        await db.Execute($"UPDATE core.records SET archived_at=sysutcdatetime() WHERE id='{db.LivRecord}';");
        Assert.True(Assert.Single(await store.GetActionsAsync(User(2),false,CancellationToken.None),row=>row.Id==db.LegacyAction).SourceWorkflowLocked);
        await Assert.ThrowsAsync<WorkflowValidationException>(()=>store.ExtendActionAsync(db.LegacyAction,new(day.AddDays(1),"Archived source cannot progress"),User(2),CancellationToken.None));
        await db.Execute($"UPDATE core.records SET archived_at=NULL WHERE id='{db.LivRecord}';UPDATE quality.actions SET source_record_id='{db.CpdRecord}',source_form_type=N'cpd_event',source_sub_record_type=NULL,source_sub_record_id=NULL WHERE id='{db.LegacyAction}';");
        await db.Execute("CREATE OR ALTER FUNCTION quality.fn_liv_action_access(@action uniqueidentifier,@user uniqueidentifier)RETURNS TABLE AS RETURN SELECT 1 AS allowed;");
        await db.Execute($"UPDATE quality.actions SET created_by_user_account_id=NULL WHERE id='{db.LegacyAction}';");
        Assert.False(Assert.Single(await store.GetActionsAsync(db.User() with{Permissions=new HashSet<string>{PermissionKeys.ReportsViewAll}},false,CancellationToken.None),row=>row.Id==db.LegacyAction).CanManageAction);
        Assert.True(Assert.Single(await store.GetActionsAsync(User(9) with{IsAdministrator=true},false,CancellationToken.None),row=>row.Id==db.LegacyAction).CanManageAction);
    }

    private sealed class OriginDatabase : IAsyncDisposable
    {
        private readonly string master;
        private readonly string name="TLQS_ActionOriginTest_"+Guid.NewGuid().ToString("N");
        private bool created;
        public string ConnectionString{get;private set;}="";
        public Guid Staff{get;}=Guid.NewGuid(); public Guid Account{get;}=Guid.NewGuid();
        public Guid CpdRecord{get;}=Guid.NewGuid();public Guid ArchivedRecord{get;}=Guid.NewGuid();public Guid NativeRecord{get;}=Guid.NewGuid();public Guid UnknownRecord{get;}=Guid.NewGuid();
        public Guid LivRecord{get;}=Guid.NewGuid();public Guid Liv{get;}=Guid.NewGuid();public Guid Cycle{get;}=Guid.NewGuid();public Guid OtherCycle{get;}=Guid.NewGuid();public Guid Visit{get;}=Guid.NewGuid();
        public Guid ProbationRecord{get;}=Guid.NewGuid();public Guid Probation{get;}=Guid.NewGuid();public Guid Observation{get;}=Guid.NewGuid();
        public Guid QaRecord{get;}=Guid.NewGuid();public Guid QaGroup{get;}=Guid.NewGuid();public Guid QaAction{get;}=Guid.NewGuid();
        public Guid CoachingRecord{get;}=Guid.NewGuid();public Guid CoachingAction{get;}=Guid.NewGuid();
        public Guid SupersededUcoAction{get;}=Guid.NewGuid();public Guid CurrentUcoAction{get;}=Guid.NewGuid();public Guid LegacyAction{get;}=Guid.NewGuid();
        private OriginDatabase(string connection)=>master=connection;
        public SqlFoundationDataStore Store()=>new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"ConnectionStrings:TlqsDatabase",ConnectionString}}).Build(),NullLogger<SqlFoundationDataStore>.Instance);
        public CurrentUser User()=>new(Account,Staff,"Source reviewer","reviewer@example.invalid",new HashSet<string>{PermissionKeys.ActionsManage,PermissionKeys.FormsManage},[]);
        public static async Task<OriginDatabase> CreateAsync()
        {
            var builder=new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TLQS_TEST_SQL_MASTER"));
            if(!builder.InitialCatalog.Equals("master",StringComparison.OrdinalIgnoreCase)||!string.IsNullOrEmpty(builder.AttachDBFilename))throw new InvalidOperationException("Only an isolated master connection is accepted.");
            var db=new OriginDatabase(builder.ConnectionString);
            await using(var master=new SqlConnection(db.master)){await master.OpenAsync();await using var command=new SqlCommand($"CREATE DATABASE [{db.name}];",master);await command.ExecuteNonQueryAsync();db.created=true;}
            builder.InitialCatalog=db.name;db.ConnectionString=builder.ConnectionString;
            try
            {
                foreach(var schema in new[]{"core","quality","people","auth","org","forms","ops"})await db.Execute($"CREATE SCHEMA {schema};");
                await db.Execute("""
                    CREATE TABLE people.staff(id uniqueidentifier PRIMARY KEY,external_id nvarchar(50),display_name nvarchar(200),email nvarchar(200),job_title nvarchar(200),primary_org_unit_id uniqueidentifier,account_status nvarchar(50),line_manager_staff_id uniqueidentifier,archived_at datetimeoffset);
                    CREATE TABLE auth.user_accounts(id uniqueidentifier PRIMARY KEY,staff_id uniqueidentifier);
                    CREATE TABLE org.staff_org_memberships(staff_id uniqueidentifier,org_unit_id uniqueidentifier,active_from date DEFAULT '2020-01-01',active_to date NULL,archived_at datetimeoffset);
                    CREATE TABLE org.org_units(id uniqueidentifier PRIMARY KEY,is_active bit DEFAULT 1,archived_at datetimeoffset NULL);
                    CREATE TABLE org.org_unit_leaderships(org_unit_id uniqueidentifier,leader_staff_id uniqueidentifier,leadership_role nvarchar(50),active_from date,active_to date NULL,archived_at datetimeoffset NULL);
                    CREATE TABLE core.records(id uniqueidentifier PRIMARY KEY,record_type nvarchar(100),subject_staff_id uniqueidentifier,owner_staff_id uniqueidentifier,org_unit_id uniqueidentifier,created_by_user_account_id uniqueidentifier,archived_at datetimeoffset);
                    CREATE TABLE forms.form_submissions(record_id uniqueidentifier,status nvarchar(50),created_at datetimeoffset,archived_at datetimeoffset);
                    CREATE TABLE core.lookup_types(id uniqueidentifier PRIMARY KEY,lookup_key nvarchar(100),is_active bit DEFAULT 1,archived_at datetimeoffset);
                    CREATE TABLE core.lookup_values(id uniqueidentifier PRIMARY KEY,lookup_type_id uniqueidentifier,value_key nvarchar(100),display_name nvarchar(100),is_active bit DEFAULT 1,archived_at datetimeoffset);
                    CREATE TABLE quality.actions(id uniqueidentifier PRIMARY KEY DEFAULT NEWID(),source_record_id uniqueidentifier NOT NULL REFERENCES core.records(id),source_form_type nvarchar(100),source_sub_record_type nvarchar(100),source_sub_record_id uniqueidentifier,source_sub_record_key nvarchar(100),subject_staff_id uniqueidentifier,owner_staff_id uniqueidentifier,action_theme nvarchar(300),title nvarchar(300),detail nvarchar(max),priority_lookup_value_id uniqueidentifier,status_lookup_value_id uniqueidentifier,due_date date,original_due_date date,published_to_staff bit,visibility_setting nvarchar(50),created_by_user_account_id uniqueidentifier,liv_visit_id uniqueidentifier,liv_cycle_id uniqueidentifier);
                    CREATE TABLE quality.liv_records(id uniqueidentifier PRIMARY KEY,record_id uniqueidentifier,archived_at datetimeoffset);
                    CREATE TABLE quality.liv_cycles(id uniqueidentifier PRIMARY KEY,liv_record_id uniqueidentifier);
                    CREATE TABLE quality.liv_visits(id uniqueidentifier PRIMARY KEY,liv_record_id uniqueidentifier,cycle_id uniqueidentifier,archived_at datetimeoffset);
                    CREATE TABLE quality.probation_cases(id uniqueidentifier PRIMARY KEY,record_id uniqueidentifier,archived_at datetimeoffset);
                    CREATE TABLE quality.probation_observations(id uniqueidentifier PRIMARY KEY,probation_case_id uniqueidentifier);
                    CREATE TABLE ops.domain_events(event_type nvarchar(100),aggregate_type nvarchar(100),aggregate_id uniqueidentifier,source_record_id uniqueidentifier,payload_json nvarchar(max),published_by_user_account_id uniqueidentifier);
                    CREATE TABLE ops.audit_logs(user_account_id uniqueidentifier,record_id uniqueidentifier,entity_name nvarchar(100),entity_id uniqueidentifier,action nvarchar(100),summary nvarchar(max),before_json nvarchar(max),after_json nvarchar(max));
                    """);
                await db.Execute($"CREATE FUNCTION org.fn_visible_staff(@user uniqueidentifier)RETURNS TABLE AS RETURN SELECT id AS staff_id,CONVERT(bit,0) AS is_managed,CONVERT(int,NULL) AS manager_depth FROM people.staff WHERE @user='{db.Account}';");
                await db.Execute("CREATE FUNCTION org.fn_visible_org_units(@user uniqueidentifier)RETURNS TABLE AS RETURN SELECT id AS org_unit_id FROM org.org_units WHERE 1=0;");
                await db.Execute($"""
                    INSERT people.staff(id,external_id,display_name,email,account_status)VALUES('{db.Staff}',N'TEST',N'Test owner',N'owner@example.invalid',N'active');
                    INSERT auth.user_accounts VALUES('{db.Account}','{db.Staff}');
                    INSERT core.records(id,record_type,subject_staff_id,owner_staff_id,created_by_user_account_id)VALUES
                    ('{db.CpdRecord}',N'cpd_event',NULL,'{db.Staff}','{db.Account}'),('{db.ArchivedRecord}',N'cpd_event',NULL,'{db.Staff}','{db.Account}'),
                    ('{db.NativeRecord}',N'uco_tla_review',NULL,'{db.Staff}','{db.Account}'),('{db.UnknownRecord}',N'unknown',NULL,'{db.Staff}','{db.Account}'),
                    ('{db.LivRecord}',N'liv','{db.Staff}','{db.Staff}','{db.Account}'),('{db.ProbationRecord}',N'probation_case','{db.Staff}','{db.Staff}','{db.Account}');
                    UPDATE core.records SET archived_at=sysutcdatetime() WHERE id='{db.ArchivedRecord}';
                    INSERT quality.liv_records(id,record_id)VALUES('{db.Liv}','{db.LivRecord}');
                    INSERT quality.liv_cycles VALUES('{db.Cycle}','{db.Liv}'),('{db.OtherCycle}','{db.Liv}');
                    INSERT quality.liv_visits(id,liv_record_id,cycle_id)VALUES('{db.Visit}','{db.Liv}','{db.Cycle}');
                    INSERT quality.probation_cases(id,record_id)VALUES('{db.Probation}','{db.ProbationRecord}');
                    INSERT quality.probation_observations VALUES('{db.Observation}','{db.Probation}');
                    """);
                foreach(var key in new[]{"action_theme_cpd","action_theme_liv","action_theme_probation_observation","action_status"})await db.Execute($"DECLARE @id uniqueidentifier=NEWID();INSERT core.lookup_types(id,lookup_key)VALUES(@id,N'{key}');INSERT core.lookup_values(id,lookup_type_id,value_key,display_name)VALUES(NEWID(),@id,N'open',N'Improve practice');");
                return db;
            }
            catch{await db.DisposeAsync();throw;}
        }
        public async Task SeedNativeMutationActions()
        {
            await Execute("CREATE SCHEMA qa;");
            await Execute("""
                ALTER TABLE core.records ADD title nvarchar(300) NULL,academic_year_key nvarchar(7) NULL;
                ALTER TABLE org.org_units ADD org_unit_type nvarchar(50) NULL,parent_org_unit_id uniqueidentifier NULL,code nvarchar(50) NULL,name nvarchar(200) NULL;
                ALTER TABLE quality.actions ALTER COLUMN source_record_id uniqueidentifier NULL;
                ALTER TABLE quality.actions ADD created_at datetimeoffset NOT NULL DEFAULT sysutcdatetime(),updated_at datetimeoffset NULL,archived_at datetimeoffset NULL,
                    updated_by_user_account_id uniqueidentifier NULL,completed_date date NULL,completed_by_user_account_id uniqueidentifier NULL,completion_note nvarchar(max) NULL,
                    cancelled_at datetimeoffset NULL,cancelled_by_user_account_id uniqueidentifier NULL,cancellation_comments nvarchar(max) NULL,
                    deleted_by_user_account_id uniqueidentifier NULL,deletion_reason nvarchar(max) NULL,revised_due_date date NULL,review_date date NULL,
                    intended_evidence nvarchar(max) NULL,intended_impact nvarchar(max) NULL,progress_status nvarchar(50) NULL,parent_action_id uniqueidentifier NULL;
                CREATE TABLE quality.action_extensions(action_id uniqueidentifier,previous_due_date date,extended_due_date date,reason nvarchar(max),created_by_user_account_id uniqueidentifier,created_at datetimeoffset DEFAULT sysutcdatetime());
                CREATE TABLE quality.process_review_action_assignees(action_id uniqueidentifier,staff_id uniqueidentifier);
                CREATE TABLE quality.process_review_scopes(record_id uniqueidentifier,org_unit_id uniqueidentifier);
                CREATE TABLE qa.reviews(record_id uniqueidentifier PRIMARY KEY,status nvarchar(50));
                CREATE TABLE qa.action_groups(id uniqueidentifier PRIMARY KEY,review_id uniqueidentifier,workflow_status nvarchar(50));
                CREATE TABLE qa.action_group_assignments(action_group_id uniqueidentifier,action_id uniqueidentifier,staff_id uniqueidentifier);
                CREATE TABLE quality.uco_tla_action_plans(id uniqueidentifier PRIMARY KEY,review_record_id uniqueidentifier,central_action_id uniqueidentifier);
                """);
            await Execute("CREATE FUNCTION quality.fn_liv_action_access(@action uniqueidentifier,@user uniqueidentifier)RETURNS TABLE AS RETURN SELECT 1 AS allowed;");
            await Execute($"""
                INSERT core.records(id,record_type,owner_staff_id,created_by_user_account_id,title,academic_year_key)VALUES
                ('{QaRecord}',N'qa_review','{Staff}','{Account}',N'QA review',N'2026/27'),
                ('{CoachingRecord}',N'coaching_session','{Staff}','{Account}',N'Coaching session',N'2026/27');
                UPDATE core.records SET title=COALESCE(title,N'Source record'),academic_year_key=N'2026/27';
                INSERT qa.reviews VALUES('{QaRecord}',N'closed');
                INSERT qa.action_groups VALUES('{QaGroup}','{QaRecord}',N'open');
                DECLARE @statusType uniqueidentifier=(SELECT id FROM core.lookup_types WHERE lookup_key=N'action_status');
                INSERT core.lookup_values(id,lookup_type_id,value_key,display_name)VALUES
                (NEWID(),@statusType,N'complete',N'Completed'),(NEWID(),@statusType,N'cancelled',N'Cancelled'),(NEWID(),@statusType,N'extended',N'Extended');
                DECLARE @open uniqueidentifier=(SELECT id FROM core.lookup_values WHERE lookup_type_id=@statusType AND value_key=N'open');
                INSERT quality.actions(id,source_record_id,source_form_type,owner_staff_id,action_theme,title,status_lookup_value_id,due_date,original_due_date,visibility_setting,published_to_staff,created_by_user_account_id)VALUES
                ('{QaAction}','{QaRecord}',N'qa_review','{Staff}',N'Improve practice',N'QA shared action',@open,'2026-12-01','2026-12-01',N'staff_and_management',1,'{Account}'),
                ('{CoachingAction}','{CoachingRecord}',N'coaching_mentoring','{Staff}',N'Improve practice',N'Coaching action',@open,'2026-12-01','2026-12-01',N'staff_and_management',1,'{Account}'),
                ('{SupersededUcoAction}','{NativeRecord}',N'uco_tla_review','{Staff}',N'Improve practice',N'Old withdrawn plan',@open,'2026-12-01','2026-12-01',N'staff_and_management',1,'{Account}'),
                ('{CurrentUcoAction}','{NativeRecord}',N'uco_tla_review','{Staff}',N'Improve practice',N'Current approved plan',@open,'2026-12-01','2026-12-01',N'staff_and_management',1,'{Account}'),
                ('{LegacyAction}',NULL,N'coaching_mentoring','{Staff}',N'Improve practice',N'Unlinked historical action',@open,'2026-12-01','2026-12-01',N'staff_and_management',1,'{Account}');
                UPDATE quality.actions SET archived_at=sysutcdatetime() WHERE id='{SupersededUcoAction}';
                INSERT qa.action_group_assignments VALUES('{QaGroup}','{QaAction}','{Staff}');
                INSERT quality.uco_tla_action_plans VALUES(NEWID(),'{NativeRecord}','{CurrentUcoAction}');
                """);
        }
        public async Task Execute(string sql){await using var connection=new SqlConnection(ConnectionString);await connection.OpenAsync();await using var command=new SqlCommand(sql,connection);await command.ExecuteNonQueryAsync();}
        public async Task<T> Scalar<T>(string sql){await using var connection=new SqlConnection(ConnectionString);await connection.OpenAsync();await using var command=new SqlCommand(sql,connection);return(T)(await command.ExecuteScalarAsync())!;}
        public async ValueTask DisposeAsync(){if(!created)return;SqlConnection.ClearAllPools();await using var connection=new SqlConnection(master);await connection.OpenAsync();await using var command=new SqlCommand($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}];",connection);await command.ExecuteNonQueryAsync();created=false;}
    }
}
