using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;
namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static readonly string[] FacultyDashboardKeys = ["overview", "learning_walk", "als_learning_walk", "liv", "als_liv", "eli", "probation_case", "elevate_environment", "coaching_session", "work_scrutiny", "cpd_event", "elevate_status", "actions", "qa_review", "uco_tla_review"];
    public async Task<IReadOnlyList<DashboardFacultySelection>> GetDashboardFacultySelectionsAsync(CancellationToken cancellationToken)
    {
        var excluded = await QueryAsync("SELECT dashboard_key, faculty_org_unit_id FROM reporting.dashboard_faculty_exclusions;", reader => (Key: reader.GetString(0), Id: reader.GetGuid(1)), cancellationToken);
        return FacultyDashboardKeys.Select(key => new DashboardFacultySelection(key, excluded.Where(row => row.Key == key).Select(row => row.Id).ToArray())).ToArray();
    }
    private Task<IReadOnlyList<ExcludedDashboardUnit>> GetExcludedDashboardUnitsAsync(string dashboardKey, CancellationToken cancellationToken) =>
        QueryAsync("SELECT id,code FROM org.org_units WHERE org.fn_dashboard_process_unit_visible(id,@key)=0;", command => command.Parameters.AddWithValue("@key", dashboardKey), reader => new ExcludedDashboardUnit(reader.GetGuid(0), reader.GetString(1)), cancellationToken);
    private sealed record ExcludedDashboardUnit(Guid Id, string Code);
    public async Task SaveDashboardFacultySelectionsAsync(IReadOnlyList<DashboardFacultySelection> selections, CurrentUser user, CancellationToken cancellationToken)
    {
        if (selections is null || selections.Any(row => row is null || row.ExcludedFacultyIds is null))
            throw new WorkflowValidationException("Provide dashboard selections and faculty lists.");
        if (selections.GroupBy(row => row.DashboardKey).Any(group => group.Count() > 1) || selections.Any(row => !FacultyDashboardKeys.Contains(row.DashboardKey)))
            throw new WorkflowValidationException("Select a valid dashboard once.");
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            foreach (var selection in selections)
            {
                foreach (var id in selection.ExcludedFacultyIds.Distinct())
                    if (!await ScalarExistsAsync(connection, transaction, "SELECT 1 FROM org.org_units WHERE id=@id AND org_unit_type=N'faculty' AND archived_at IS NULL;", command => command.Parameters.AddWithValue("@id", id), cancellationToken))
                        throw new WorkflowValidationException("Only existing faculties can be selected for dashboard datasets.");
                await ExecuteAsync(connection, transaction, "DELETE FROM reporting.dashboard_faculty_exclusions WHERE dashboard_key=@key;", command => command.Parameters.AddWithValue("@key", selection.DashboardKey), cancellationToken);
                foreach (var id in selection.ExcludedFacultyIds.Distinct())
                    await ExecuteAsync(connection, transaction, "INSERT reporting.dashboard_faculty_exclusions(dashboard_key,faculty_org_unit_id,updated_by_user_account_id) VALUES(@key,@id,@actor);", command => { command.Parameters.AddWithValue("@key", selection.DashboardKey); command.Parameters.AddWithValue("@id", id); command.Parameters.AddWithValue("@actor", ToDbValue(user.UserAccountId)); }, cancellationToken);
            }
            await WriteAuditAsync(connection, transaction, user.UserAccountId, null, "dashboard_configuration", Guid.Empty, "dashboard.faculties_updated", "Dashboard faculty datasets updated.", null, System.Text.Json.JsonSerializer.Serialize(selections), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch { await transaction.RollbackAsync(cancellationToken); throw; }
    }
}
