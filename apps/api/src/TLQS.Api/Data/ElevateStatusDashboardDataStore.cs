using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<IReadOnlyList<ElevateStatusStaffDashboardSummary>> GetElevateStatusStaffDashboardAsync(
        string academicYear, CurrentUser currentUser, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            StaffParticipationEligibilitySql + """

            SELECT staff.id, staff.display_name, staff.primary_org_unit_id,
                   staff.area_code, staff.area_name, staff.parent_area_code,
                   attendance.qualifying_attendance_count,
                   CONVERT(int, award.level_number), award.qualifying_attendance_count, award.confirmed_at
            FROM eligible_staff staff
            CROSS JOIN selected_year academic_year
            OUTER APPLY (
                -- Same event eligibility as the individual Elevate Status page; mandatory/external forms do not qualify.
                SELECT COUNT(DISTINCT event.id) qualifying_attendance_count
                FROM cpd.cpd_attendance attendance
                JOIN cpd.cpd_events event ON event.id = attendance.cpd_event_id AND event.archived_at IS NULL
                JOIN forms.form_submissions submission ON submission.record_id = event.record_id
                    AND submission.status = N'submitted' AND submission.archived_at IS NULL
                JOIN forms.form_template_versions version ON version.id = submission.form_template_version_id AND version.archived_at IS NULL
                JOIN forms.form_templates template ON template.id = version.form_template_id
                    AND template.template_key = N'cpd_core' AND template.archived_at IS NULL
                WHERE attendance.staff_id = staff.id
                  AND attendance.attendance_status = N'Attended' AND attendance.archived_at IS NULL
                  AND event.event_date BETWEEN academic_year.start_date AND academic_year.end_date
            ) attendance
            LEFT JOIN cpd.elevate_status_awards award ON award.staff_id = staff.id
                AND award.academic_year_key = @academicYear AND award.archived_at IS NULL
            WHERE org.fn_dashboard_process_unit_visible(staff.primary_org_unit_id, N'elevate_status') = 1
            ORDER BY staff.display_name, staff.id, award.level_number
            OPTION (RECOMPILE);
            """,
            command =>
            {
                AddScopeParameters(command, currentUser);
                command.Parameters.AddWithValue("@academicYear", academicYear);
            },
            reader => new ElevateStatusDashboardSourceRow(reader.GetGuid(0), reader.GetString(1), GetGuidOrNull(reader, 2),
                GetStringOrNull(reader, 3), GetStringOrNull(reader, 4), GetStringOrNull(reader, 5), reader.GetInt32(6),
                reader.IsDBNull(7) ? null : reader.GetInt32(7), reader.IsDBNull(8) ? null : reader.GetInt32(8),
                reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9)),
            cancellationToken);
        return ElevateStatusDashboardBuilder.Staff(rows);
    }
}
