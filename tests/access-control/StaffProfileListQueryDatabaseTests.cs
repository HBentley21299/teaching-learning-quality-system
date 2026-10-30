using System.Text;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Security;
using Xunit;

namespace TLQS.AccessControl.Tests;

[Collection("List query database checks")]
public sealed class StaffProfileListQueryDatabaseTests
{
    [AccountAdministrationDatabaseFact]
    public async Task CpdAndCoachingFilterAndSortAcrossAllPagesWithHistoricalOptionsAndTypedDates()
    {
        await using var fixture = await ProfileDatabase.CreateAsync();
        var sql = new StringBuilder();
        for (var index = 1; index <= 31; index++)
        {
            var id = Guid.NewGuid(); var record = Guid.NewGuid(); var template = Guid.NewGuid(); var version = Guid.NewGuid();
            var type = index % 3 == 0 ? "cpd_mandatory" : index % 3 == 1 ? "cpd_core" : "cpd_external_self_log";
            var title = index == 31 ? "Amélie historical 50% [tested]" : $"Ordinary event {index}";
            sql.AppendLine($"INSERT cpd.cpd_events VALUES('{id}','{record}',N'{title}','2026-10-01',{index},NULL); INSERT cpd.cpd_attendance VALUES('{id}','{fixture.StaffId}',N'Attended',NULL); INSERT forms.form_templates VALUES('{template}',N'{type}'); INSERT forms.form_template_versions VALUES('{version}','{template}'); INSERT forms.form_submissions VALUES(NEWID(),'{record}','{version}',sysutcdatetime(),NULL);");
        }
        await fixture.Execute(sql.ToString());
        var store = fixture.Store;
        var first = await store.GetStaffProfileCpdPageAsync(fixture.StaffId, "2026/27", 1, 10, CancellationToken.None, new ListQuery(SortBy: "duration"));
        Assert.Equal(31, first.TotalCount); Assert.Equal(10, first.Items.Count); Assert.Equal(1, first.Items[0].DurationMinutes);
        Assert.Equal(new DateOnly(2026, 10, 1), first.Items[0].EventDate);
        Assert.Equal(new[] { "external", "internal", "mandatory" }, first.FilterOptions!.Type);
        Assert.Equal(new[] { "Attended" }, first.FilterOptions.Status); Assert.Empty(first.FilterOptions.Person);
        var filtered = await store.GetStaffProfileCpdPageAsync(fixture.StaffId, "2026/27", int.MaxValue, 10, CancellationToken.None,
            new ListQuery(Search: "amelie historical", Type: "internal", FromDate: new(2026, 10, 1), ToDate: new(2026, 10, 1), SortBy: "title", SortDirection: "desc"));
        Assert.Equal(1, filtered.Page); Assert.Equal(1, filtered.TotalCount); Assert.Equal(1, filtered.TotalPages);
        Assert.Equal("Amélie historical 50% [tested]", Assert.Single(filtered.Items).Title);
        Assert.Equal(3, filtered.FilterOptions!.Type.Count);
        var literal = await store.GetStaffProfileCpdPageAsync(fixture.StaffId, "2026/27", 1, 10, CancellationToken.None, new ListQuery(Search: "% [tested]"));
        Assert.Single(literal.Items);
        var empty = await store.GetStaffProfileCpdPageAsync(fixture.StaffId, "2026/27", 9, 10, CancellationToken.None, new ListQuery(Search: "not present"));
        Assert.Empty(empty.Items); Assert.Equal(1, empty.Page); Assert.Equal(0, empty.TotalCount); Assert.Equal(3, empty.FilterOptions!.Type.Count);

        var cycle = Guid.NewGuid(); var focus = Guid.NewGuid();
        await fixture.Execute($"INSERT quality.coaching_cycles VALUES('{cycle}',12,NULL); INSERT core.lookup_values VALUES('{focus}',N'focus',N'Historical modelling');");
        sql.Clear();
        for (var index = 1; index <= 22; index++)
            sql.AppendLine($"INSERT quality.coaching_sessions VALUES(NEWID(),NEWID(),'{cycle}','{fixture.StaffId}','{fixture.ReviewerId}',{index},'2026-10-02',N'reflection',N'completed','{focus}',N'Independent practice',NULL);");
        await fixture.Execute(sql.ToString());
        var coaching = await store.GetStaffProfileCoachingPageAsync(fixture.StaffId, "2026/27", 2, 10, CancellationToken.None,
            new ListQuery(Search: "retired modelling", Person: "Retired Reviewer", Status: "completed", SortBy: "session", SortDirection: "desc"));
        Assert.Equal(22, coaching.TotalCount); Assert.Equal(12, coaching.Items[0].SessionNumber); Assert.Equal(12, coaching.Items[0].CycleNumber);
        Assert.Equal("Historical modelling", coaching.Items[0].PrimaryFocus); Assert.Equal(new[] { "Retired Reviewer" }, coaching.FilterOptions!.Person);
    }

    [AccountAdministrationDatabaseFact]
    public async Task LivAndProbationInnerVisibilityConstrainResultsCountsAndAllFilterOptions()
    {
        await using var fixture = await ProfileDatabase.CreateAsync();
        var standard = Guid.NewGuid(); var als = Guid.NewGuid(); var oldCase = Guid.NewGuid(); var recentCase = Guid.NewGuid();
        await fixture.Execute($"""
            INSERT core.records(id,title,record_date,academic_year_key) VALUES('{standard}',N'Standard LIV','2026-10-02',N'2026/27'),('{als}',N'ALS LIV','2026-10-01',N'2026/27'),('{oldCase}',N'Historic probation','2025-10-01',N'2025/26'),('{recentCase}',N'Current probation','2026-10-01',N'2026/27');
            INSERT quality.liv_records VALUES(NEWID(),'{standard}','{fixture.StaffId}','{fixture.ReviewerId}',NULL,N'review',N'in_progress','2026-10-02T09:00:00+00:00',NULL,N'liv',NULL),
                (NEWID(),'{als}','{fixture.StaffId}','{fixture.OtherId}',NULL,N'complete',N'completed','2026-10-01T09:00:00+00:00',NULL,N'als_liv',NULL);
            INSERT quality.probation_cases VALUES(NEWID(),'{oldCase}','{fixture.StaffId}',N'2025/26',N'completed',2,NULL,'2025-10-01T09:00:00+00:00',NULL,'{fixture.OtherId}',NULL),
                (NEWID(),'{recentCase}','{fixture.StaffId}',N'2026/27',N'in_progress',1,NULL,'2026-10-01T09:00:00+00:00',NULL,'{fixture.OtherId}',NULL);
            """);
        var reader = fixture.User(PermissionKeys.LivManage);
        var liv = await fixture.Store.GetStaffProfileLivPageAsync(fixture.StaffId, "2026/27", 1, 10, reader, CancellationToken.None, new ListQuery(SortBy: "date"));
        Assert.Equal(1, liv.TotalCount); Assert.Equal("Standard LIV", Assert.Single(liv.Items).Title);
        Assert.Equal(new[] { "liv" }, liv.FilterOptions!.Type); Assert.Equal(new[] { "Retired Reviewer" }, liv.FilterOptions.Person);
        Assert.Null(liv.Items[0].UpdatedAt); Assert.Null(liv.Items[0].OrgUnitCode);
        var denied = await fixture.Store.GetStaffProfileLivPageAsync(fixture.StaffId, "2026/27", 1, 10, reader, CancellationToken.None, new ListQuery(Type: "als_liv"));
        Assert.Empty(denied.Items); Assert.Equal(0, denied.TotalCount); Assert.DoesNotContain("als_liv", denied.FilterOptions!.Type);
        var self = fixture.User() with { StaffId = fixture.StaffId };
        var own = await fixture.Store.GetStaffProfileLivPageAsync(fixture.StaffId, "2026/27", 1, 10, self, CancellationToken.None);
        Assert.Equal(2, own.TotalCount);
        var probationDenied = await fixture.Store.GetStaffProfileProbationPageAsync(fixture.StaffId, 1, 10, reader, CancellationToken.None);
        Assert.Empty(probationDenied.Items); Assert.Empty(probationDenied.FilterOptions!.Type);
        var probation = await fixture.Store.GetStaffProfileProbationPageAsync(fixture.StaffId, 99, 10, self, CancellationToken.None, new ListQuery(Type: "2025/26", SortBy: "observation", SortDirection: "desc"));
        Assert.Equal("Historic probation", Assert.Single(probation.Items).Title); Assert.Equal(1, probation.Page);
        Assert.Equal(new[] { "2025/26", "2026/27" }, probation.FilterOptions!.Type);
        Assert.Equal((byte)2, probation.Items[0].CurrentObservationNumber); Assert.Null(probation.Items[0].UpdatedAt);
    }

    [AccountAdministrationDatabaseFact]
    public async Task ActionQueryFiltersDerivedStatesAndPreservesLivAccessWithoutLeakingHiddenOwnerOrSourceChoices()
    {
        await using var fixture = await ProfileDatabase.CreateAsync();
        var cancelled = Guid.NewGuid(); var complete = Guid.NewGuid(); var overdue = Guid.NewGuid(); var hidden = Guid.NewGuid();
        var user = fixture.User();
        await fixture.Execute($"""
            INSERT core.lookup_values VALUES('{cancelled}',N'cancelled',N'Cancelled'),('{complete}',N'complete',N'Complete');
            INSERT quality.actions VALUES('{cancelled}',N'Cancelled action',NULL,'2026-10-01T09:00:00+00:00',NULL,'{fixture.StaffId}','{fixture.ReviewerId}','{cancelled}','2020-10-01',NULL,NULL),
                ('{complete}',N'Complete without date',N'Legacy completion','2026-10-02T09:00:00+00:00',NULL,'{fixture.StaffId}','{fixture.ReviewerId}','{complete}','2020-10-01',NULL,NULL),
                ('{overdue}',N'Overdue action',NULL,'2026-10-03T09:00:00+00:00',NULL,'{fixture.StaffId}','{fixture.ReviewerId}',NULL,'2020-10-01',NULL,NULL),
                ('{hidden}',N'Hidden action',NULL,'2026-10-04T09:00:00+00:00',NULL,'{fixture.StaffId}','{fixture.OtherId}',NULL,'2020-10-01',NULL,NULL);
            INSERT quality.allowed_actions VALUES('{cancelled}','{user.UserAccountId}'),('{complete}','{user.UserAccountId}'),('{overdue}','{user.UserAccountId}');
            """);
        var all = await fixture.Store.GetStaffProfileActionsPageAsync(fixture.StaffId, "2026/27", 1, 10, user, CancellationToken.None, new ListQuery(SortBy: "title"));
        Assert.Equal(3, all.TotalCount); Assert.DoesNotContain(all.Items, item => item.Title == "Hidden action");
        Assert.Equal(new[] { "Retired Reviewer" }, all.FilterOptions!.Person);
        Assert.Equal(new[] { "cancelled", "complete", "overdue" }, all.FilterOptions.Status);
        Assert.False(all.Items.Single(item => item.Id == cancelled).IsOverdue); Assert.False(all.Items.Single(item => item.Id == complete).IsOverdue);
        Assert.True(all.Items.Single(item => item.Id == overdue).IsOverdue);
        var summary = await fixture.Store.GetStaffProfileSectionSummaryAsync(fixture.StaffId, "2026/27", user, CancellationToken.None);
        Assert.Equal(1, summary.OpenActionCount); Assert.Equal(1, summary.CompletedActionCount); Assert.Equal(1, summary.OverdueActionCount);
        var filtered = await fixture.Store.GetStaffProfileActionsPageAsync(fixture.StaffId, "2026/27", int.MaxValue, 10, user, CancellationToken.None, new ListQuery(Status: "complete", Person: "Retired Reviewer", Type: "standalone", SortBy: "completed"));
        Assert.Equal(1, filtered.Page); Assert.Equal("Complete without date", Assert.Single(filtered.Items).Title);
        Assert.Null(filtered.Items[0].CompletedDate); Assert.Null(filtered.Items[0].SourceRecordId);
    }

    private sealed class ProfileDatabase : IAsyncDisposable
    {
        private readonly string master;
        private readonly string name = "TLQS_ProfileQueryTest_" + Guid.NewGuid().ToString("N");
        public Guid StaffId { get; } = Guid.NewGuid();
        public Guid ReviewerId { get; } = Guid.NewGuid();
        public Guid OtherId { get; } = Guid.NewGuid();
        public string ConnectionString { get; private set; } = "";
        public SqlFoundationDataStore Store => new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:TlqsDatabase"] = ConnectionString }).Build(), NullLogger<SqlFoundationDataStore>.Instance);
        public CurrentUser User(params string[] permissions) => new(Guid.NewGuid(), ReviewerId, "Profile reader", "reader@example.invalid", permissions.ToHashSet(), []);
        private ProfileDatabase(string master) { this.master = master; }
        public static async Task<ProfileDatabase> CreateAsync()
        {
            var builder = new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TLQS_TEST_SQL_MASTER"));
            if (!builder.InitialCatalog.Equals("master", StringComparison.OrdinalIgnoreCase) || !(builder.DataSource.StartsWith("(localdb)", StringComparison.OrdinalIgnoreCase) || builder.DataSource is "." or "localhost"))
                throw new InvalidOperationException("Profile query tests require an explicit local master connection; the application database is never used.");
            var fixture = new ProfileDatabase(builder.ConnectionString);
            await using (var connection = new SqlConnection(fixture.master))
            {
                await connection.OpenAsync(); await using var create = new SqlCommand($"CREATE DATABASE [{fixture.name}];", connection) { CommandTimeout = 120 }; await create.ExecuteNonQueryAsync();
            }
            builder.InitialCatalog = fixture.name; fixture.ConnectionString = builder.ConnectionString;
            try
            {
                foreach (var schema in new[] { "core", "cpd", "forms", "quality", "people", "org" }) await fixture.Execute($"CREATE SCHEMA {schema};");
                await fixture.Execute("""
                    CREATE TABLE core.academic_years(academic_year_key nvarchar(7),start_date date,end_date date,is_active bit,archived_at datetimeoffset);
                    CREATE TABLE core.records(id uniqueidentifier PRIMARY KEY,title nvarchar(300),record_date date,academic_year_key nvarchar(7),record_type nvarchar(100),module_id uniqueidentifier,archived_at datetimeoffset);
                    CREATE TABLE core.modules(id uniqueidentifier PRIMARY KEY,name nvarchar(100));
                    CREATE TABLE core.lookup_values(id uniqueidentifier PRIMARY KEY,value_key nvarchar(100),display_name nvarchar(100));
                    CREATE TABLE people.staff(id uniqueidentifier PRIMARY KEY,display_name nvarchar(200));
                    CREATE TABLE org.org_units(id uniqueidentifier PRIMARY KEY,code nvarchar(100),parent_org_unit_id uniqueidentifier,org_unit_type nvarchar(30));
                    CREATE TABLE cpd.cpd_events(id uniqueidentifier PRIMARY KEY,record_id uniqueidentifier,event_title nvarchar(300),event_date date,duration_minutes int,archived_at datetimeoffset);
                    CREATE TABLE cpd.cpd_attendance(cpd_event_id uniqueidentifier,staff_id uniqueidentifier,attendance_status nvarchar(30),archived_at datetimeoffset);
                    CREATE TABLE forms.form_templates(id uniqueidentifier PRIMARY KEY,template_key nvarchar(100));
                    CREATE TABLE forms.form_template_versions(id uniqueidentifier PRIMARY KEY,form_template_id uniqueidentifier);
                    CREATE TABLE forms.form_submissions(id uniqueidentifier PRIMARY KEY,record_id uniqueidentifier,form_template_version_id uniqueidentifier,created_at datetimeoffset,archived_at datetimeoffset);
                    CREATE TABLE forms.form_fields(id uniqueidentifier PRIMARY KEY,field_key nvarchar(100));
                    CREATE TABLE forms.form_responses(form_submission_id uniqueidentifier,form_field_id uniqueidentifier,response_text nvarchar(max),archived_at datetimeoffset);
                    CREATE TABLE quality.coaching_cycles(id uniqueidentifier PRIMARY KEY,cycle_number int,archived_at datetimeoffset);
                    CREATE TABLE quality.elevate_practice_assessments(id uniqueidentifier PRIMARY KEY,academic_year nvarchar(7));
                    CREATE TABLE quality.staff_reflections(staff_id uniqueidentifier,elevate_practice_assessment_id uniqueidentifier,status nvarchar(50),archived_at datetimeoffset);
                    CREATE TABLE quality.coaching_sessions(id uniqueidentifier PRIMARY KEY,record_id uniqueidentifier,cycle_id uniqueidentifier,staff_id uniqueidentifier,coach_staff_id uniqueidentifier,session_number int,session_date date,session_type nvarchar(50),status nvarchar(50),primary_focus_lookup_value_id uniqueidentifier,specific_session_focus nvarchar(300),archived_at datetimeoffset);
                    CREATE TABLE quality.liv_records(id uniqueidentifier PRIMARY KEY,record_id uniqueidentifier,subject_staff_id uniqueidentifier,reviewer_staff_id uniqueidentifier,org_unit_id uniqueidentifier,current_stage nvarchar(50),status nvarchar(50),created_at datetimeoffset,updated_at datetimeoffset,process_key nvarchar(50),archived_at datetimeoffset);
                    CREATE TABLE quality.probation_cases(id uniqueidentifier PRIMARY KEY,record_id uniqueidentifier,subject_staff_id uniqueidentifier,academic_year nvarchar(7),status nvarchar(50),current_observation_number tinyint,org_unit_id uniqueidentifier,created_at datetimeoffset,updated_at datetimeoffset,created_by_user_account_id uniqueidentifier,archived_at datetimeoffset);
                    CREATE TABLE quality.probation_case_reviewers(probation_case_id uniqueidentifier,staff_id uniqueidentifier);
                    CREATE TABLE quality.actions(id uniqueidentifier PRIMARY KEY,title nvarchar(300),detail nvarchar(max),created_at datetimeoffset,source_record_id uniqueidentifier,subject_staff_id uniqueidentifier,owner_staff_id uniqueidentifier,status_lookup_value_id uniqueidentifier,due_date date,completed_date date,archived_at datetimeoffset);
                    CREATE TABLE quality.allowed_actions(action_id uniqueidentifier,user_account_id uniqueidentifier);
                    """);
                await fixture.Execute("CREATE FUNCTION quality.fn_liv_action_access(@action uniqueidentifier,@user uniqueidentifier) RETURNS TABLE AS RETURN SELECT 1 AS allowed FROM quality.allowed_actions WHERE action_id=@action AND user_account_id=@user;");
                await fixture.Execute("CREATE FUNCTION org.fn_visible_staff(@user uniqueidentifier) RETURNS TABLE AS RETURN SELECT id AS staff_id FROM people.staff WHERE 1=0;");
                await fixture.Execute("CREATE FUNCTION org.fn_visible_org_units(@user uniqueidentifier) RETURNS TABLE AS RETURN SELECT id AS org_unit_id FROM org.org_units WHERE 1=0;");
                await fixture.Execute($"INSERT core.academic_years VALUES(N'2026/27','2026-08-01','2027-07-31',1,NULL); INSERT people.staff VALUES('{fixture.StaffId}',N'Profile subject'),('{fixture.ReviewerId}',N'Retired Reviewer'),('{fixture.OtherId}',N'Hidden person');");
                return fixture;
            }
            catch { await fixture.DisposeAsync(); throw; }
        }
        public async Task Execute(string sql) { await using var connection = new SqlConnection(ConnectionString); await connection.OpenAsync(); await using var command = new SqlCommand(sql, connection); await command.ExecuteNonQueryAsync(); }
        public async ValueTask DisposeAsync()
        {
            SqlConnection.ClearAllPools(); await using var connection = new SqlConnection(master); await connection.OpenAsync();
            await using var command = new SqlCommand($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}];", connection); await command.ExecuteNonQueryAsync();
        }
    }
}
