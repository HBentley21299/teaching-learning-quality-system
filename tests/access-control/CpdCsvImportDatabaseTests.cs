using System.Reflection;
using System.Data;
using System.Collections;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class CpdCsvImportDatabaseTests
{
    [AccountAdministrationDatabaseFact]
    public async Task PreviewApplyLedgerConcurrencyAndLateFailureAreAtomicInAnIsolatedDatabase()
    {
        await using var fixture = await CpdDatabase.CreateAsync();
        var store = new SqlFoundationDataStore(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            { ["ConnectionStrings:TlqsDatabase"] = fixture.ConnectionString }).Build(), NullLogger<SqlFoundationDataStore>.Instance);
        var user = new CurrentUser(Guid.NewGuid(), fixture.StaffId, "CSV test admin", "admin@example.invalid",
            new HashSet<string> { PermissionKeys.CpdManage, PermissionKeys.CpdMandatoryLog }, []) { IsAdministrator = true };
        const string header = "event_reference,academic_year,cpd_type,title,event_date_time,duration_minutes,delivery_mode,theme_keys,participant_external_id";
        var csv = header + "\nevent-1,2026/27,internal,Imported session,2026-10-01T09:00,90,Online,digital,S1\nevent-1,2026/27,internal,Imported session,2026-10-01T09:00,90,Online,digital,S2";
        var preview = await Preview(csv);
        Assert.DoesNotContain(Issues(preview), issue => issue.Severity == "error");
        Assert.Single(Changes(preview));
        var fingerprint = Fingerprint(preview);
        var attempts = await Task.WhenAll(Enumerable.Range(0, 2).Select(async _ =>
        {
            try { await Apply(csv, fingerprint); return true; }
            catch (DBConcurrencyException) { return false; }
        }));
        Assert.Equal(1, attempts.Count(success => success));
        await using var connection = new SqlConnection(fixture.ConnectionString); await connection.OpenAsync();
        Assert.Equal(1, await Count("core.records")); Assert.Equal(1, await Count("ops.csv_import_items"));
        Assert.Equal(2, await Count("cpd.cpd_attendance WHERE milestone_credit=1"));
        Assert.Equal(0, await Count("cpd.elevate_status_awards"));
        var repeated = await Preview(csv);
        Assert.Empty(Changes(repeated)); Assert.All(Rows(repeated), row => Assert.Equal("skip", row.Operation));
        var changed = await Preview(csv.Replace("Imported session", "Changed session"));
        Assert.Empty(Changes(changed)); Assert.Contains(Issues(changed), issue => issue.Message.Contains("different data"));

        var second = header + "\nevent-2,2026/27,mandatory,Second session,2026-10-01T10:00,45,Online,digital,S1";
        var stale = await Preview(second);
        await Execute($"UPDATE people.staff SET primary_org_unit_id=NEWID() WHERE id='{fixture.StaffId}';");
        await Assert.ThrowsAsync<DBConcurrencyException>(() => Apply(second, Fingerprint(stale)));
        Assert.Equal(1, await Count("core.records"));
        // A simulated late database failure after the first event and its ledger item were inserted
        // must roll back the entire batch, rather than leave an awarded or partially imported event.
        await Execute("CREATE TRIGGER core.reject_test_event ON core.records AFTER INSERT AS IF EXISTS(SELECT 1 FROM inserted WHERE title=N'Reject apply') THROW 51000,'Deliberate isolated test failure',1;");
        var failing = header + "\nevent-3,2026/27,internal,First batch event,2026-10-01T11:00,30,Online,digital,S1\nevent-4,2026/27,internal,Reject apply,2026-10-01T12:00,30,Online,digital,S2";
        var failurePreview = await Preview(failing);
        Assert.Equal(2, Changes(failurePreview).Count());
        await Assert.ThrowsAsync<SqlException>(() => Apply(failing, Fingerprint(failurePreview)));
        Assert.Equal(1, await Count("core.records")); Assert.Equal(1, await Count("ops.csv_import_items"));
        Assert.Equal(2, await Count("cpd.cpd_attendance")); Assert.Equal(1, await Count("ops.domain_events"));
        Assert.Equal(2, await Count("ops.audit_logs")); // Submitted record plus its successful batch audit.
        Assert.Equal(0, await Count("cpd.elevate_status_awards"));

        async Task<object> Preview(string value)
        {
            var task = (Task)Method("PreviewAdminCsvAsync").Invoke(store, ["cpd-events", value, user, CancellationToken.None])!;
            await task; return task.GetType().GetProperty("Result")!.GetValue(task)!;
        }
        async Task<AdminCsvImportResult> Apply(string value, string expected) =>
            await (Task<AdminCsvImportResult>)Method("ApplyAdminCsvAsync").Invoke(store, ["cpd-events", value, expected, user, CancellationToken.None])!;
        string Fingerprint(object plan) => (string)Method("AdminCsvPlanFingerprint", BindingFlags.Static).Invoke(null, [plan])!;
        static IReadOnlyList<AdminCsvIssue> Issues(object plan) => (IReadOnlyList<AdminCsvIssue>)plan.GetType().GetProperty("Issues")!.GetValue(plan)!;
        static IReadOnlyList<AdminCsvPreviewRow> Rows(object plan) => (IReadOnlyList<AdminCsvPreviewRow>)plan.GetType().GetProperty("Rows")!.GetValue(plan)!;
        static IEnumerable<object> Changes(object plan) => ((IEnumerable)plan.GetType().GetProperty("Changes")!.GetValue(plan)!).Cast<object>();
        static MethodInfo Method(string name, BindingFlags kind = BindingFlags.Instance) => typeof(SqlFoundationDataStore).GetMethod(name, BindingFlags.NonPublic | kind)!;
        async Task<int> Count(string table) { await using var command = new SqlCommand($"SELECT COUNT(*) FROM {table};", connection); return Convert.ToInt32(await command.ExecuteScalarAsync()); }
        async Task Execute(string sql) { await using var command = new SqlCommand(sql, connection); await command.ExecuteNonQueryAsync(); }
    }

    [AccountAdministrationDatabaseFact]
    public async Task RealFormSubmissionSharesTheImportTransactionAndMandatoryNeverCreditsOrAwards()
    {
        await using var fixture = await CpdDatabase.CreateAsync();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            { ["ConnectionStrings:TlqsDatabase"] = fixture.ConnectionString }).Build();
        var store = new SqlFoundationDataStore(configuration, NullLogger<SqlFoundationDataStore>.Instance);
        var user = new CurrentUser(Guid.NewGuid(), fixture.StaffId, "CSV test admin", "admin@example.invalid",
            new HashSet<string> { PermissionKeys.CpdManage, PermissionKeys.CpdMandatoryLog }, []) { IsAdministrator = true };
        await using var connection = new SqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        var method = typeof(SqlFoundationDataStore).GetMethod("SubmitFormWithinTransactionAsync", BindingFlags.NonPublic | BindingFlags.Instance)!;
        async Task<SubmittedFormResult> Submit(SubmitFormRequest request, SqlTransaction transaction) =>
            await (Task<SubmittedFormResult>)method.Invoke(store, [request, user, connection, transaction, CancellationToken.None])!;

        await using (var transaction = (SqlTransaction)await connection.BeginTransactionAsync())
        {
            await Submit(fixture.Request("cpd_core"), transaction);
            await Submit(fixture.Request("cpd_mandatory"), transaction);
            Assert.Equal(2, await Count("core.records", transaction));
            Assert.Equal(2, await Count("cpd.cpd_events", transaction));
            Assert.Equal(2, await Count("cpd.cpd_attendance WHERE milestone_credit=1", transaction));
            Assert.Equal(2, await Count("cpd.cpd_attendance WHERE milestone_credit=0", transaction));
            Assert.Equal(4, await Count("cpd.cpd_attendance WHERE attendance_status=N'Attended'", transaction));
            Assert.Equal(2, await Count("ops.domain_events WHERE event_type=N'form.submitted'", transaction));
            Assert.Equal(2, await Count("ops.audit_logs WHERE action=N'record.submitted'", transaction));
            Assert.Equal(0, await Count("cpd.elevate_status_awards", transaction));
            // The final event fails after earlier events were written. The caller must retain ownership
            // of the transaction so the complete CSV batch, including audit/event rows, can be rolled back.
            await Assert.ThrowsAsync<WorkflowValidationException>(() => Submit(fixture.Request("cpd_core", Guid.NewGuid()), transaction));
            Assert.Equal(3, await Count("core.records", transaction));
            await transaction.RollbackAsync();
        }
        foreach (var table in new[] { "core.records", "forms.form_submissions", "forms.form_responses", "cpd.cpd_events", "cpd.cpd_attendance", "ops.audit_logs", "ops.domain_events", "cpd.elevate_status_awards" })
            Assert.Equal(0, await Count(table));

        // The ordinary, non-import entry point still commits its own transaction.
        await store.SubmitFormAsync(fixture.Request("cpd_core"), user, CancellationToken.None);
        Assert.Equal(1, await Count("core.records"));
        Assert.Equal(2, await Count("cpd.cpd_attendance WHERE milestone_credit=1"));
        Assert.Equal(0, await Count("cpd.elevate_status_awards"));

        async Task<int> Count(string table, SqlTransaction? transaction = null)
        {
            await using var command = new SqlCommand($"SELECT COUNT(*) FROM {table};", connection, transaction);
            return Convert.ToInt32(await command.ExecuteScalarAsync());
        }
    }

    private sealed class CpdDatabase : IAsyncDisposable
    {
        private readonly string master;
        private readonly string name = "TLQS_CpdImportTest_" + Guid.NewGuid().ToString("N");
        private readonly Dictionary<string, CpdCsvTemplate> templates = [];
        public Guid StaffId { get; } = Guid.NewGuid();
        private Guid OtherStaffId { get; } = Guid.NewGuid();
        public string ConnectionString { get; private set; } = "";
        private CpdDatabase(string master) { this.master = master; }
        public SubmitFormRequest Request(string type, Guid? invalidParticipant = null)
        {
            var entry = new CpdCsvPreparedEvent("test", "test", 2, "2026/27", type == "cpd_core" ? "internal" : "mandatory", "CSV transaction test",
                new(2026, 10, 1, 9, 0, 0), 90, "Face to face", [new("digital", "Digital learning", true)],
                [new(StaffId, "S1", "one@example.invalid", "One", null, true), new(invalidParticipant ?? OtherStaffId, "S2", "two@example.invalid", "Two", null, true)], templates[type]);
            return CpdCsvImportRules.Submission(entry);
        }

        public static async Task<CpdDatabase> CreateAsync()
        {
            var builder = new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TLQS_TEST_SQL_MASTER"));
            if (!builder.InitialCatalog.Equals("master", StringComparison.OrdinalIgnoreCase)
                || !(builder.DataSource.StartsWith("(localdb)", StringComparison.OrdinalIgnoreCase) || builder.DataSource is "." or "localhost"))
                throw new InvalidOperationException("CPD database tests require an explicitly local Database=master connection; the application database is never used.");
            var result = new CpdDatabase(builder.ConnectionString);
            await using (var master = new SqlConnection(result.master))
            {
                await master.OpenAsync();
                await using var create = new SqlCommand($"CREATE DATABASE [{result.name}];", master) { CommandTimeout = 120 };
                await create.ExecuteNonQueryAsync();
            }
            builder.InitialCatalog = result.name; result.ConnectionString = builder.ConnectionString;
            try
            {
                await using var connection = new SqlConnection(result.ConnectionString); await connection.OpenAsync();
                foreach (var schema in new[] { "core", "forms", "people", "cpd", "ops" }) await Execute($"CREATE SCHEMA {schema};");
                await Execute("""
                    CREATE TABLE core.modules(id uniqueidentifier PRIMARY KEY,module_key nvarchar(100));
                    CREATE TABLE core.records(id uniqueidentifier PRIMARY KEY,module_id uniqueidentifier,record_type nvarchar(100),title nvarchar(300),summary nvarchar(max),subject_staff_id uniqueidentifier,owner_staff_id uniqueidentifier,org_unit_id uniqueidentifier,record_date date,created_by_user_account_id uniqueidentifier,archived_at datetimeoffset NULL);
                    CREATE TABLE core.lookup_types(id uniqueidentifier PRIMARY KEY,lookup_key nvarchar(100),is_active bit DEFAULT 1,archived_at datetimeoffset NULL);
                    CREATE TABLE core.lookup_values(lookup_type_id uniqueidentifier,value_key nvarchar(100),display_name nvarchar(200),is_active bit DEFAULT 1,archived_at datetimeoffset NULL);
                    CREATE TABLE core.academic_years(academic_year_key nvarchar(7) PRIMARY KEY,start_date date,end_date date,is_active bit DEFAULT 1,archived_at datetimeoffset NULL);
                    CREATE TABLE people.staff(id uniqueidentifier PRIMARY KEY,external_id nvarchar(100),email nvarchar(300),display_name nvarchar(300),primary_org_unit_id uniqueidentifier,account_status nvarchar(30),archived_at datetimeoffset NULL);
                    CREATE TABLE forms.form_templates(id uniqueidentifier PRIMARY KEY,module_id uniqueidentifier,template_key nvarchar(100),is_active bit DEFAULT 1,archived_at datetimeoffset NULL);
                    CREATE TABLE forms.form_template_versions(id uniqueidentifier PRIMARY KEY,form_template_id uniqueidentifier,is_published bit,active_from datetimeoffset DEFAULT sysutcdatetime(),created_at datetimeoffset DEFAULT sysutcdatetime(),archived_at datetimeoffset NULL);
                    CREATE TABLE forms.form_sections(id uniqueidentifier PRIMARY KEY,form_template_version_id uniqueidentifier,section_key nvarchar(100) NOT NULL,archived_at datetimeoffset NULL);
                    CREATE TABLE forms.form_fields(id uniqueidentifier PRIMARY KEY,form_section_id uniqueidentifier,field_key nvarchar(100),field_type nvarchar(100),is_required bit,label nvarchar(300),configuration_json nvarchar(max),is_active bit DEFAULT 1,archived_at datetimeoffset NULL);
                    CREATE TABLE forms.form_submissions(id uniqueidentifier PRIMARY KEY,record_id uniqueidentifier,form_template_version_id uniqueidentifier,submitted_by_user_account_id uniqueidentifier,submitted_at datetimeoffset,status nvarchar(30),created_at datetimeoffset DEFAULT sysutcdatetime(),archived_at datetimeoffset NULL);
                    CREATE TABLE forms.form_responses(form_submission_id uniqueidentifier,form_field_id uniqueidentifier,response_text nvarchar(max),response_date date);
                    CREATE TABLE cpd.cpd_events(id uniqueidentifier PRIMARY KEY DEFAULT newid(),record_id uniqueidentifier UNIQUE,event_title nvarchar(300),event_date date,start_time time,delivery_method nvarchar(100),facilitator_staff_id uniqueidentifier,duration_minutes int,updated_at datetimeoffset,archived_at datetimeoffset NULL);
                    CREATE TABLE cpd.cpd_attendance(cpd_event_id uniqueidentifier,staff_id uniqueidentifier,org_unit_id_at_time uniqueidentifier,attendance_status nvarchar(30),milestone_credit int DEFAULT 1,UNIQUE(cpd_event_id,staff_id));
                    CREATE TABLE cpd.elevate_status_awards(id uniqueidentifier PRIMARY KEY);
                    CREATE TABLE ops.domain_events(event_type nvarchar(100),aggregate_type nvarchar(100),aggregate_id uniqueidentifier,source_record_id uniqueidentifier,payload_json nvarchar(max),published_by_user_account_id uniqueidentifier);
                    CREATE TABLE ops.audit_logs(user_account_id uniqueidentifier,record_id uniqueidentifier,entity_name nvarchar(100),entity_id uniqueidentifier,action nvarchar(100),summary nvarchar(max),before_json nvarchar(max),after_json nvarchar(max));
                    CREATE TABLE ops.csv_import_items(kind nvarchar(80),source_reference nvarchar(200),payload_sha256 char(64),entity_id uniqueidentifier,batch_id uniqueidentifier,imported_by_user_account_id uniqueidentifier,imported_at datetimeoffset DEFAULT sysutcdatetime(),PRIMARY KEY(kind,source_reference));
                    """);
                var module = Guid.NewGuid();
                await Execute($"INSERT core.modules VALUES('{module}',N'cpd'); INSERT people.staff(id,external_id,email,display_name,account_status) VALUES('{result.StaffId}',N'S1',N'one@example.invalid',N'One',N'active'),('{result.OtherStaffId}',N'S2',N'two@example.invalid',N'Two',N'active'); DECLARE @themes uniqueidentifier=NEWID(); INSERT core.lookup_types(id,lookup_key) VALUES(@themes,N'cpd_theme'); INSERT core.lookup_values(lookup_type_id,value_key,display_name) VALUES(@themes,N'digital',N'Digital learning'); INSERT core.academic_years(academic_year_key,start_date,end_date) VALUES(N'2026/27','2026-08-01','2027-07-31');");
                foreach (var type in new[] { "cpd_core", "cpd_mandatory" })
                {
                    var template = Guid.NewGuid(); var version = Guid.NewGuid(); var section = Guid.NewGuid();
                    await Execute($"INSERT forms.form_templates(id,module_id,template_key) VALUES('{template}','{module}',N'{type}'); INSERT forms.form_template_versions(id,form_template_id,is_published) VALUES('{version}','{template}',1); INSERT forms.form_sections(id,form_template_version_id,section_key) VALUES('{section}','{version}',N'context');");
                    var fields = new List<CpdCsvField>();
                    foreach (var key in new[] { "cpd_title", "date_time", "duration_hours", "duration_minutes", "delivery_mode", "cpd_themes", "staff_search" })
                    {
                        var typeName = key == "cpd_themes" ? "checkbox_group" : "short_text";
                        var field = Guid.NewGuid(); fields.Add(new(field, key, typeName, true, key));
                        await Execute($"INSERT forms.form_fields(id,form_section_id,field_key,field_type,is_required,label) VALUES('{field}','{section}',N'{key}',N'{typeName}',1,N'{key}');");
                    }
                    result.templates[type] = new(type, version, fields);
                }
                return result;
                async Task Execute(string sql) { await using var command = new SqlCommand(sql, connection); await command.ExecuteNonQueryAsync(); }
            }
            catch { await result.DisposeAsync(); throw; }
        }
        public async ValueTask DisposeAsync()
        {
            SqlConnection.ClearAllPools();
            await using var connection = new SqlConnection(master); await connection.OpenAsync();
            await using var drop = new SqlCommand($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}];", connection);
            await drop.ExecuteNonQueryAsync();
        }
    }
}
