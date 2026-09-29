using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    // Shared with the aggregate so named rows use exactly the same reporting denominator.
    private const string StaffParticipationEligibilitySql = """
            WITH selected_year AS (
                SELECT start_date, end_date
                FROM core.academic_years
                WHERE academic_year_key = @academicYear
                  AND is_active = 1
                  AND archived_at IS NULL
            ),
            eligible_staff AS (
                SELECT staff.id, staff.display_name, staff.primary_org_unit_id,
                       org_unit.code area_code, org_unit.name area_name,
                       parent_org.code parent_area_code
                FROM people.staff staff
                CROSS JOIN selected_year academic_year
                LEFT JOIN org.org_units org_unit ON org_unit.id = staff.primary_org_unit_id
                LEFT JOIN org.org_units parent_org ON parent_org.id = org_unit.parent_org_unit_id AND parent_org.org_unit_type = N'faculty'
                WHERE staff.archived_at IS NULL
                  AND org.fn_dashboard_unit_visible(org_unit.id) = 1
                  AND (staff.start_date IS NULL OR staff.start_date <= academic_year.end_date)
                  AND (staff.end_date IS NULL OR staff.end_date >= academic_year.start_date)
                  AND (staff.account_status = N'active' OR staff.end_date IS NOT NULL)
                  AND (
                        @canViewAll = 1
                        OR EXISTS (
                            SELECT 1
                            FROM org.fn_visible_staff(@currentUserAccountId) visible
                            WHERE visible.staff_id = staff.id
                        )
                  )
            )
            """;

    public Task<IReadOnlyList<EliSubmissionStaffSummary>> GetEliSubmissionStaffDashboardAsync(
        string academicYear,
        CurrentUser currentUser,
        CancellationToken cancellationToken) =>
        QueryAsync(
            StaffParticipationEligibilitySql + """

            SELECT staff.id, staff.display_name, staff.primary_org_unit_id,
                   staff.area_code, staff.area_name, staff.parent_area_code,
                   CONVERT(bit, CASE WHEN submitted.id IS NULL THEN 0 ELSE 1 END) AS has_submitted,
                   submitted.submitted_at, submitted.record_id
            FROM eligible_staff staff
            OUTER APPLY (
                SELECT TOP (1) assessment.id, assessment.submitted_at, assessment.record_id
                FROM quality.elevate_practice_assessments assessment
                WHERE assessment.staff_id = staff.id
                  AND assessment.academic_year = @academicYear
                  AND assessment.status = N'submitted'
                  AND assessment.archived_at IS NULL
                ORDER BY assessment.submitted_at DESC, assessment.id DESC
            ) submitted
            WHERE org.fn_dashboard_process_unit_visible(staff.primary_org_unit_id, N'eli') = 1
            ORDER BY staff.display_name, staff.id
            OPTION (RECOMPILE);
            """,
            command =>
            {
                AddScopeParameters(command, currentUser);
                command.Parameters.AddWithValue("@academicYear", academicYear);
            },
            reader => new EliSubmissionStaffSummary(
                reader.GetGuid(0), reader.GetString(1), GetGuidOrNull(reader, 2),
                GetStringOrNull(reader, 3), GetStringOrNull(reader, 4), GetStringOrNull(reader, 5),
                reader.GetBoolean(6),
                reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7),
                GetGuidOrNull(reader, 8)),
            cancellationToken);
}
