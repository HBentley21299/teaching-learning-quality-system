using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static readonly ElevateStatusLevelDefinition[] ElevateStatusLevels =
    [
        new(1, "explorer", "Elevate Explorer", 3, "Evidence showing how professional development has been implemented in your own practice."),
        new(2, "storyteller", "Elevate Storyteller", 6, "A case study outlining what you have implemented, why, and the impact, suitable for the T and L newsletter or blog."),
        new(3, "innovator", "Elevate Innovator", 9, "Delivery of professional development within your faculty or sharing of best practice at a Spotlight and Showcase session."),
        new(4, "champion", "Elevate Champion", 12, "Delivery of an Elevate session to staff."),
        new(5, "changemaker", "Elevate Changemaker", 15, "Sharing practice externally (sector networks or conferences) or delivering a session at the Teaching and Learning Conference.")
    ];

    public Task<IReadOnlyList<AcademicYearSummary>> GetAcademicYearsAsync(CancellationToken cancellationToken)
    {
        var currentYear = AcademicYearPolicy.GetCurrentKey();
        return QueryAsync(
            """
            SELECT academic_year_key, start_date, end_date
            FROM core.academic_years
            WHERE is_active = 1 AND archived_at IS NULL
            ORDER BY start_date DESC;
            """,
            reader =>
            {
                var key = reader.GetString(0);
                var startDate = DateOnly.FromDateTime(reader.GetDateTime(1));
                return new AcademicYearSummary(
                    key,
                    startDate,
                    DateOnly.FromDateTime(reader.GetDateTime(2)),
                    string.Equals(key, currentYear, StringComparison.OrdinalIgnoreCase),
                    startDate > DateOnly.FromDateTime(DateTime.UtcNow));
            },
            cancellationToken);
    }

    public async Task<ElevateStatusSummary> GetElevateStatusAsync(
        Guid staffId,
        string academicYear,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var (startDate, endDate) = await GetAcademicYearBoundsAsync(academicYear, cancellationToken);
        var eligibleCpd = await GetEligibleElevateCpdAsync(staffId, startDate, endDate, null, null, cancellationToken);
        var awards = await QueryAsync(
            """
            SELECT award.level_number, award.evidence_cpd_event_id, award.implementation_impact,
                   award.qualifying_attendance_count, award.confirmed_at, confirmer.display_name
            FROM cpd.elevate_status_awards award
            JOIN auth.user_accounts confirmer_account ON confirmer_account.id = award.confirmed_by_user_account_id
            JOIN people.staff confirmer ON confirmer.id = confirmer_account.staff_id
            WHERE award.staff_id = @staffId
              AND award.academic_year_key = @academicYear
              AND award.archived_at IS NULL
            ORDER BY award.level_number;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@academicYear", academicYear);
            },
            reader => new ElevateStatusAwardRow(
                reader.GetByte(0),
                GetGuidOrNull(reader, 1),
                GetStringOrNull(reader, 2),
                reader.GetInt32(3),
                reader.GetFieldValue<DateTimeOffset>(4),
                reader.GetString(5)),
            cancellationToken);

        var canManage = ElevateStatusAccessPolicy.CanManageControlledLevels(currentUser);
        var canSubmitExplorer = ElevateStatusAccessPolicy.CanUpdateLevel(currentUser, staffId, 1);
        var awardsByLevel = awards.ToDictionary(award => award.LevelNumber);
        var previousLevelAwarded = true;
        var levelSummaries = new List<ElevateStatusLevelSummary>(ElevateStatusLevels.Length);

        foreach (var definition in ElevateStatusLevels)
        {
            awardsByLevel.TryGetValue(definition.LevelNumber, out var award);
            var isEligible = eligibleCpd.Count >= definition.RequiredSessions && previousLevelAwarded;
            var isConfirmed = award is not null;
            var isAwarded = isConfirmed;
            levelSummaries.Add(new ElevateStatusLevelSummary(
                definition.LevelNumber,
                definition.LevelKey,
                definition.Name,
                definition.RequiredSessions,
                definition.RequirementLabel,
                isEligible,
                isConfirmed,
                isAwarded,
                definition.LevelNumber == 1 ? award?.EvidenceCpdEventId : null,
                definition.LevelNumber == 1 ? award?.ImplementationImpact : null,
                canManage || definition.LevelNumber == 1 ? award?.QualifyingAttendanceCount : null,
                canManage || definition.LevelNumber == 1 ? award?.ConfirmedAt : null,
                canManage || definition.LevelNumber == 1 ? award?.ConfirmedByName : null));
            previousLevelAwarded = isAwarded;
        }

        return new ElevateStatusSummary(
            staffId,
            academicYear,
            eligibleCpd.Count,
            canSubmitExplorer,
            canManage,
            eligibleCpd,
            levelSummaries);
    }

    public async Task<ElevateStatusSummary> SaveElevateStatusLevelAsync(
        Guid staffId,
        int levelNumber,
        SaveElevateStatusLevelRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (!currentUser.UserAccountId.HasValue
            || !ElevateStatusAccessPolicy.CanUpdateLevel(currentUser, staffId, levelNumber))
        {
            throw new WorkflowValidationException("You are not authorised to update this Elevate Status level.");
        }

        var definition = ElevateStatusLevels.SingleOrDefault(level => level.LevelNumber == levelNumber)
            ?? throw new WorkflowValidationException("Select a valid Elevate Status level.");
        var (startDate, endDate) = await GetAcademicYearBoundsAsync(request.AcademicYear, cancellationToken);

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var eligibleCpd = await GetEligibleElevateCpdAsync(
                staffId,
                startDate,
                endDate,
                connection,
                (SqlTransaction)transaction,
                cancellationToken);
            var existingAwards = await GetActiveElevateStatusAwardsAsync(
                staffId,
                request.AcademicYear,
                connection,
                (SqlTransaction)transaction,
                cancellationToken);

            if (!request.Confirmed)
            {
                if (!ElevateStatusAccessPolicy.CanManageControlledLevels(currentUser))
                {
                    throw new WorkflowValidationException("Only Teaching and Learning or Admin can revoke an Elevate Status award.");
                }

                var revoked = existingAwards
                    .Where(award => award.LevelNumber >= levelNumber)
                    .Select(award => award.LevelNumber)
                    .ToArray();
                if (revoked.Length > 0)
                {
                    await using var archiveCommand = new SqlCommand(
                        """
                        UPDATE cpd.elevate_status_awards
                        SET archived_at = sysutcdatetime(),
                            archived_by_user_account_id = @userAccountId,
                            updated_at = sysutcdatetime(),
                            updated_by_user_account_id = @userAccountId
                        WHERE staff_id = @staffId
                          AND academic_year_key = @academicYear
                          AND level_number >= @levelNumber
                          AND archived_at IS NULL;
                        """,
                        connection,
                        (SqlTransaction)transaction);
                    archiveCommand.Parameters.AddWithValue("@userAccountId", currentUser.UserAccountId.Value);
                    archiveCommand.Parameters.AddWithValue("@staffId", staffId);
                    archiveCommand.Parameters.AddWithValue("@academicYear", request.AcademicYear);
                    archiveCommand.Parameters.AddWithValue("@levelNumber", levelNumber);
                    await archiveCommand.ExecuteNonQueryAsync(cancellationToken);

                    await InsertElevateStatusAuditAsync(
                        connection,
                        (SqlTransaction)transaction,
                        currentUser.UserAccountId.Value,
                        existingAwards.First(award => award.LevelNumber == revoked.Min()).Id,
                        "revoked",
                        $"Revoked Elevate Status level {levelNumber} and dependent higher levels for {request.AcademicYear}.",
                        JsonSerializer.Serialize(new { StaffId = staffId, request.AcademicYear, RevokedLevels = revoked }),
                        null,
                        cancellationToken);
                }

                await transaction.CommitAsync(cancellationToken);
                return await GetElevateStatusAsync(staffId, request.AcademicYear, currentUser, cancellationToken);
            }

            if (eligibleCpd.Count < definition.RequiredSessions)
            {
                throw new WorkflowValidationException(
                    $"{definition.Name} requires {definition.RequiredSessions} completed internal CPD sessions in {request.AcademicYear}.");
            }

            if (levelNumber > 1 && existingAwards.All(award => award.LevelNumber != levelNumber - 1))
            {
                throw new WorkflowValidationException(
                    $"Confirm Level {levelNumber - 1} before awarding {definition.Name}.");
            }

            Guid? evidenceCpdEventId = null;
            string? implementationImpact = null;
            if (levelNumber == 1)
            {
                evidenceCpdEventId = request.EvidenceCpdEventId
                    ?? throw new WorkflowValidationException("Select an internal CPD session for the Explorer evidence.");
                if (eligibleCpd.All(cpd => cpd.CpdEventId != evidenceCpdEventId.Value))
                {
                    throw new WorkflowValidationException("The selected CPD session is not eligible for this academic year.");
                }

                implementationImpact = request.ImplementationImpact?.Trim();
                if (string.IsNullOrWhiteSpace(implementationImpact))
                {
                    throw new WorkflowValidationException("Describe the implementation and impact of the selected CPD.");
                }
            }

            var existing = existingAwards.SingleOrDefault(award => award.LevelNumber == levelNumber);
            var awardId = existing?.Id ?? Guid.NewGuid();
            await using (var saveCommand = new SqlCommand(
                existing is null
                    ? """
                      INSERT INTO cpd.elevate_status_awards (
                          id, staff_id, academic_year_key, level_number, qualifying_attendance_count,
                          evidence_cpd_event_id, implementation_impact, confirmed_by_user_account_id
                      )
                      VALUES (
                          @id, @staffId, @academicYear, @levelNumber, @attendanceCount,
                          @evidenceCpdEventId, @implementationImpact, @userAccountId
                      );
                      """
                    : """
                      UPDATE cpd.elevate_status_awards
                      SET qualifying_attendance_count = @attendanceCount,
                          evidence_cpd_event_id = @evidenceCpdEventId,
                          implementation_impact = @implementationImpact,
                          updated_by_user_account_id = @userAccountId,
                          updated_at = sysutcdatetime()
                      WHERE id = @id AND archived_at IS NULL;
                      """,
                connection,
                (SqlTransaction)transaction))
            {
                saveCommand.Parameters.AddWithValue("@id", awardId);
                saveCommand.Parameters.AddWithValue("@staffId", staffId);
                saveCommand.Parameters.AddWithValue("@academicYear", request.AcademicYear);
                saveCommand.Parameters.AddWithValue("@levelNumber", levelNumber);
                saveCommand.Parameters.AddWithValue("@attendanceCount", eligibleCpd.Count);
                saveCommand.Parameters.AddWithValue("@evidenceCpdEventId", ToDbValue(evidenceCpdEventId));
                saveCommand.Parameters.AddWithValue("@implementationImpact", ToDbValue(implementationImpact));
                saveCommand.Parameters.AddWithValue("@userAccountId", currentUser.UserAccountId.Value);
                await saveCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            await InsertElevateStatusAuditAsync(
                connection,
                (SqlTransaction)transaction,
                currentUser.UserAccountId.Value,
                awardId,
                existing is null ? "awarded" : "updated",
                $"{definition.Name} confirmed for {request.AcademicYear}.",
                existing is null ? null : JsonSerializer.Serialize(existing),
                JsonSerializer.Serialize(new
                {
                    StaffId = staffId,
                    request.AcademicYear,
                    LevelNumber = levelNumber,
                    AttendanceCount = eligibleCpd.Count,
                    EvidenceCpdEventId = evidenceCpdEventId,
                    ImplementationImpact = implementationImpact
                }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }

        return await GetElevateStatusAsync(staffId, request.AcademicYear, currentUser, cancellationToken);
    }

    private async Task<(DateOnly StartDate, DateOnly EndDate)> GetAcademicYearBoundsAsync(
        string academicYear,
        CancellationToken cancellationToken)
    {
        if (!AcademicYearPolicy.TryGetBounds(academicYear, out _, out _))
        {
            throw new WorkflowValidationException("Select a valid academic year.");
        }

        var rows = await QueryAsync(
            """
            SELECT start_date, end_date
            FROM core.academic_years
            WHERE academic_year_key = @academicYear
              AND is_active = 1
              AND archived_at IS NULL;
            """,
            command => command.Parameters.AddWithValue("@academicYear", academicYear),
            reader => (
                DateOnly.FromDateTime(reader.GetDateTime(0)),
                DateOnly.FromDateTime(reader.GetDateTime(1))),
            cancellationToken);
        return rows.FirstOrDefault() is var bounds && bounds != default
            ? bounds
            : throw new WorkflowValidationException("The selected academic year is not active.");
    }

    private async Task<IReadOnlyList<ElevateStatusCpdSummary>> GetEligibleElevateCpdAsync(
        Guid staffId,
        DateOnly startDate,
        DateOnly endDate,
        SqlConnection? connection,
        SqlTransaction? transaction,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT DISTINCT event.id, event.event_title, event.event_date
            FROM cpd.cpd_attendance attendance
            JOIN cpd.cpd_events event ON event.id = attendance.cpd_event_id
                AND event.archived_at IS NULL
            JOIN forms.form_submissions submission ON submission.record_id = event.record_id
                AND submission.status = N'submitted'
                AND submission.archived_at IS NULL
            JOIN forms.form_template_versions version ON version.id = submission.form_template_version_id
                AND version.archived_at IS NULL
            JOIN forms.form_templates template ON template.id = version.form_template_id
                AND template.template_key = N'cpd_core'
                AND template.archived_at IS NULL
            WHERE attendance.staff_id = @staffId
              AND attendance.attendance_status = N'Attended'
              AND attendance.archived_at IS NULL
              AND event.event_date >= @startDate
              AND event.event_date <= @endDate
            ORDER BY event.event_date DESC, event.event_title;
            """;

        if (connection is null)
        {
            return await QueryAsync(
                sql,
                command =>
                {
                    command.Parameters.AddWithValue("@staffId", staffId);
                    command.Parameters.AddWithValue("@startDate", startDate.ToDateTime(TimeOnly.MinValue));
                    command.Parameters.AddWithValue("@endDate", endDate.ToDateTime(TimeOnly.MinValue));
                },
                reader => new ElevateStatusCpdSummary(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    DateOnly.FromDateTime(reader.GetDateTime(2))),
                cancellationToken);
        }

        await using var command = new SqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@startDate", startDate.ToDateTime(TimeOnly.MinValue));
        command.Parameters.AddWithValue("@endDate", endDate.ToDateTime(TimeOnly.MinValue));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<ElevateStatusCpdSummary>();
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new ElevateStatusCpdSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                DateOnly.FromDateTime(reader.GetDateTime(2))));
        }

        return rows;
    }

    private static async Task<IReadOnlyList<ElevateStatusAwardTransactionRow>> GetActiveElevateStatusAwardsAsync(
        Guid staffId,
        string academicYear,
        SqlConnection connection,
        SqlTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT id, level_number, evidence_cpd_event_id, implementation_impact,
                   qualifying_attendance_count, confirmed_at
            FROM cpd.elevate_status_awards WITH (UPDLOCK, HOLDLOCK)
            WHERE staff_id = @staffId
              AND academic_year_key = @academicYear
              AND archived_at IS NULL
            ORDER BY level_number;
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@academicYear", academicYear);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<ElevateStatusAwardTransactionRow>();
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new ElevateStatusAwardTransactionRow(
                reader.GetGuid(0),
                reader.GetByte(1),
                reader.IsDBNull(2) ? null : reader.GetGuid(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.GetInt32(4),
                reader.GetFieldValue<DateTimeOffset>(5)));
        }

        return rows;
    }

    private static async Task InsertElevateStatusAuditAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid userAccountId,
        Guid awardId,
        string action,
        string summary,
        string? beforeJson,
        string? afterJson,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            INSERT INTO ops.audit_logs (
                user_account_id, entity_name, entity_id, action, summary, before_json, after_json
            )
            VALUES (
                @userAccountId, N'elevate_status_award', @awardId, @action, @summary, @beforeJson, @afterJson
            );
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("@userAccountId", userAccountId);
        command.Parameters.AddWithValue("@awardId", awardId);
        command.Parameters.AddWithValue("@action", action);
        command.Parameters.AddWithValue("@summary", summary);
        command.Parameters.AddWithValue("@beforeJson", beforeJson is null ? DBNull.Value : beforeJson);
        command.Parameters.AddWithValue("@afterJson", afterJson is null ? DBNull.Value : afterJson);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private sealed record ElevateStatusLevelDefinition(
        int LevelNumber,
        string LevelKey,
        string Name,
        int RequiredSessions,
        string RequirementLabel);

    private sealed record ElevateStatusAwardRow(
        int LevelNumber,
        Guid? EvidenceCpdEventId,
        string? ImplementationImpact,
        int QualifyingAttendanceCount,
        DateTimeOffset ConfirmedAt,
        string ConfirmedByName);

    private sealed record ElevateStatusAwardTransactionRow(
        Guid Id,
        int LevelNumber,
        Guid? EvidenceCpdEventId,
        string? ImplementationImpact,
        int QualifyingAttendanceCount,
        DateTimeOffset ConfirmedAt);
}
