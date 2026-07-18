using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<IReadOnlyList<StaffReflectionSummary>> GetStaffReflectionsAsync(
        Guid staffId,
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT
                reflection.id,
                reflection.staff_id,
                reflection.elevate_practice_assessment_id,
                reflection.elevate_practice_record_id,
                assessment.academic_year,
                reflection.reflection_date,
                reflection.progress,
                reflection.impact,
                reflection.examples,
                reflection.status,
                reflection.created_by_user_account_id,
                created_by.display_name,
                reflection.created_at,
                reflection.updated_by_user_account_id,
                updated_by.display_name,
                reflection.updated_at
            FROM quality.staff_reflections reflection
            JOIN quality.elevate_practice_assessments assessment
                ON assessment.id = reflection.elevate_practice_assessment_id
            LEFT JOIN auth.user_accounts created_account
                ON created_account.id = reflection.created_by_user_account_id
            LEFT JOIN people.staff created_by ON created_by.id = created_account.staff_id
            LEFT JOIN auth.user_accounts updated_account
                ON updated_account.id = reflection.updated_by_user_account_id
            LEFT JOIN people.staff updated_by ON updated_by.id = updated_account.staff_id
            WHERE reflection.staff_id = @staffId
              AND reflection.archived_at IS NULL
            ORDER BY reflection.reflection_date DESC, reflection.created_at DESC
            OPTION (RECOMPILE, MAX_GRANT_PERCENT = 1);
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader => new StaffReflectionRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetGuid(2),
                reader.GetGuid(3),
                reader.GetString(4),
                DateOnly.FromDateTime(reader.GetDateTime(5)),
                GetStringOrNull(reader, 6),
                GetStringOrNull(reader, 7),
                GetStringOrNull(reader, 8),
                reader.GetString(9),
                GetGuidOrNull(reader, 10),
                GetStringOrNull(reader, 11),
                reader.GetFieldValue<DateTimeOffset>(12),
                GetGuidOrNull(reader, 13),
                GetStringOrNull(reader, 14),
                GetDateTimeOffsetOrNull(reader, 15)),
            cancellationToken);

        if (rows.Count == 0)
        {
            return [];
        }

        var focusAreas = await QueryAsync(
            """
            SELECT
                link.reflection_id,
                link.focus_lookup_value_id,
                link.focus_key_snapshot,
                link.focus_text_snapshot,
                link.focus_type,
                link.display_order
            FROM quality.staff_reflection_focus_areas link
            JOIN quality.staff_reflections reflection ON reflection.id = link.reflection_id
            WHERE reflection.staff_id = @staffId
              AND reflection.archived_at IS NULL
            ORDER BY link.reflection_id, link.display_order;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader => new StaffReflectionFocusRow(
                reader.GetGuid(0),
                GetGuidOrNull(reader, 1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetInt32(5)),
            cancellationToken);

        var focusByReflection = focusAreas
            .GroupBy(focus => focus.ReflectionId)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyList<StaffReflectionFocusAreaSummary>)group
                    .Select(focus => new StaffReflectionFocusAreaSummary(
                        focus.FocusLookupValueId,
                        focus.FocusKeySnapshot,
                        focus.TextSnapshot,
                        focus.FocusType,
                        focus.DisplayOrder))
                    .ToArray());

        return rows
            .Select(row => new StaffReflectionSummary(
                row.Id,
                row.StaffId,
                row.ElevatePracticeAssessmentId,
                row.ElevatePracticeRecordId,
                row.AcademicYear,
                row.ReflectionDate,
                row.Progress,
                row.Impact,
                row.Examples,
                row.Status,
                focusByReflection.GetValueOrDefault(row.Id, []),
                row.CreatedByUserAccountId,
                row.CreatedByName,
                row.CreatedAt,
                row.UpdatedByUserAccountId,
                row.UpdatedByName,
                row.UpdatedAt))
            .ToArray();
    }

    public async Task<StaffReflectionMutationResult> CreateStaffReflectionAsync(
        Guid staffId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (!CanEditStaffReflection(staffId, currentUser))
        {
            return new StaffReflectionMutationResult(StaffReflectionMutationStatus.Forbidden, null, null);
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            ElevateAssessmentLink? assessment = null;
            await using (var command = new SqlCommand(
                """
                SELECT TOP (1) assessment.id, assessment.record_id, assessment.academic_year
                FROM quality.elevate_practice_assessments assessment
                WHERE assessment.staff_id = @staffId
                  AND assessment.status = 'submitted'
                  AND assessment.archived_at IS NULL
                ORDER BY assessment.submitted_at DESC, assessment.created_at DESC;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                {
                    assessment = new ElevateAssessmentLink(
                        reader.GetGuid(0),
                        reader.GetGuid(1),
                        reader.GetString(2));
                }
            }

            if (assessment is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return new StaffReflectionMutationResult(
                    StaffReflectionMutationStatus.NoSubmittedElevateAssessment,
                    null,
                    "A submitted Elevate Learning and Innovation assessment is required before a reflection can be created.");
            }

            var reflectionId = Guid.NewGuid();
            await using (var command = new SqlCommand(
                """
                INSERT INTO quality.staff_reflections (
                    id,
                    staff_id,
                    elevate_practice_assessment_id,
                    elevate_practice_record_id,
                    reflection_date,
                    status,
                    created_by_user_account_id
                )
                VALUES (
                    @id,
                    @staffId,
                    @assessmentId,
                    @recordId,
                    CONVERT(date, sysutcdatetime()),
                    'draft',
                    @createdByUserAccountId
                );

                INSERT INTO quality.staff_reflection_focus_areas (
                    reflection_id,
                    focus_lookup_value_id,
                    focus_key_snapshot,
                    focus_text_snapshot,
                    focus_type,
                    display_order
                )
                SELECT
                    @id,
                    focus.id,
                    focus.value_key,
                    focus.display_name,
                    N'primary',
                    1
                FROM quality.elevate_practice_liv_information information
                JOIN core.lookup_values focus ON focus.id = information.primary_focus_lookup_value_id
                WHERE information.assessment_id = @assessmentId
                UNION ALL
                SELECT
                    @id,
                    focus.id,
                    focus.value_key,
                    CASE
                        WHEN focus.value_key = N'other'
                            THEN COALESCE(NULLIF(LTRIM(RTRIM(information.secondary_focus_other)), N''), focus.display_name)
                        ELSE focus.display_name
                    END,
                    N'secondary',
                    2
                FROM quality.elevate_practice_liv_information information
                JOIN core.lookup_values focus ON focus.id = information.secondary_focus_lookup_value_id
                WHERE information.assessment_id = @assessmentId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", reflectionId);
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@assessmentId", assessment.Id);
                command.Parameters.AddWithValue("@recordId", assessment.RecordId);
                command.Parameters.AddWithValue("@createdByUserAccountId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                assessment.RecordId,
                "staff_reflection",
                reflectionId,
                "staff_profile.reflection_created",
                $"Staff reflection created by {currentUser.DisplayName}.",
                null,
                JsonSerializer.Serialize(new
                {
                    staffId,
                    elevatePracticeAssessmentId = assessment.Id,
                    elevatePracticeRecordId = assessment.RecordId,
                    assessment.AcademicYear,
                    status = "draft"
                }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            var saved = (await GetStaffReflectionsAsync(staffId, cancellationToken))
                .First(reflection => reflection.Id == reflectionId);
            return new StaffReflectionMutationResult(StaffReflectionMutationStatus.Saved, saved, null);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<StaffReflectionMutationResult> UpdateStaffReflectionAsync(
        Guid staffId,
        Guid reflectionId,
        SaveStaffReflectionRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (!CanEditStaffReflection(staffId, currentUser))
        {
            return new StaffReflectionMutationResult(StaffReflectionMutationStatus.Forbidden, null, null);
        }

        var status = (request.Status ?? string.Empty).Trim().ToLowerInvariant();
        if (status is not ("draft" or "submitted"))
        {
            return new StaffReflectionMutationResult(
                StaffReflectionMutationStatus.ValidationFailed,
                null,
                "Status must be draft or submitted.");
        }

        var progress = NormalizeReflectionText(request.Progress);
        var impact = NormalizeReflectionText(request.Impact);
        var examples = NormalizeReflectionText(request.Examples);
        if (status == "submitted"
            && (progress is null || impact is null || examples is null))
        {
            return new StaffReflectionMutationResult(
                StaffReflectionMutationStatus.ValidationFailed,
                null,
                "Progress, impact and examples are required before a reflection is submitted.");
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            ExistingStaffReflection? existing = null;
            await using (var command = new SqlCommand(
                """
                SELECT
                    elevate_practice_record_id,
                    reflection_date,
                    progress,
                    impact,
                    examples,
                    status
                FROM quality.staff_reflections
                WHERE id = @reflectionId
                  AND staff_id = @staffId
                  AND archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@reflectionId", reflectionId);
                command.Parameters.AddWithValue("@staffId", staffId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                {
                    existing = new ExistingStaffReflection(
                        reader.GetGuid(0),
                        DateOnly.FromDateTime(reader.GetDateTime(1)),
                        GetStringOrNull(reader, 2),
                        GetStringOrNull(reader, 3),
                        GetStringOrNull(reader, 4),
                        reader.GetString(5));
                }
            }

            if (existing is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return new StaffReflectionMutationResult(StaffReflectionMutationStatus.NotFound, null, null);
            }

            await using (var command = new SqlCommand(
                """
                UPDATE quality.staff_reflections
                SET reflection_date = @reflectionDate,
                    progress = @progress,
                    impact = @impact,
                    examples = @examples,
                    status = @status,
                    updated_by_user_account_id = @updatedByUserAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @reflectionId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@reflectionDate", request.ReflectionDate.ToDateTime(TimeOnly.MinValue));
                command.Parameters.AddWithValue("@progress", ToDbValue(progress));
                command.Parameters.AddWithValue("@impact", ToDbValue(impact));
                command.Parameters.AddWithValue("@examples", ToDbValue(examples));
                command.Parameters.AddWithValue("@status", status);
                command.Parameters.AddWithValue("@updatedByUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@reflectionId", reflectionId);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                existing.RecordId,
                "staff_reflection",
                reflectionId,
                status == "submitted" && existing.Status != "submitted"
                    ? "staff_profile.reflection_submitted"
                    : "staff_profile.reflection_updated",
                $"Staff reflection {status} by {currentUser.DisplayName}.",
                JsonSerializer.Serialize(new
                {
                    reflectionDate = existing.ReflectionDate.ToString("yyyy-MM-dd"),
                    existing.Progress,
                    existing.Impact,
                    existing.Examples,
                    existing.Status
                }),
                JsonSerializer.Serialize(new
                {
                    reflectionDate = request.ReflectionDate.ToString("yyyy-MM-dd"),
                    progress,
                    impact,
                    examples,
                    status
                }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            var saved = (await GetStaffReflectionsAsync(staffId, cancellationToken))
                .First(reflection => reflection.Id == reflectionId);
            return new StaffReflectionMutationResult(StaffReflectionMutationStatus.Saved, saved, null);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static bool CanEditStaffReflection(Guid staffId, CurrentUser currentUser) =>
        (currentUser.StaffId.HasValue && currentUser.StaffId.Value == staffId)
        || currentUser.HasPermission(PermissionKeys.StaffManage);

    private static string? NormalizeReflectionText(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private sealed record StaffReflectionRow(
        Guid Id,
        Guid StaffId,
        Guid ElevatePracticeAssessmentId,
        Guid ElevatePracticeRecordId,
        string AcademicYear,
        DateOnly ReflectionDate,
        string? Progress,
        string? Impact,
        string? Examples,
        string Status,
        Guid? CreatedByUserAccountId,
        string? CreatedByName,
        DateTimeOffset CreatedAt,
        Guid? UpdatedByUserAccountId,
        string? UpdatedByName,
        DateTimeOffset? UpdatedAt);

    private sealed record StaffReflectionFocusRow(
        Guid ReflectionId,
        Guid? FocusLookupValueId,
        string FocusKeySnapshot,
        string TextSnapshot,
        string FocusType,
        int DisplayOrder);

    private sealed record ElevateAssessmentLink(Guid Id, Guid RecordId, string AcademicYear);

    private sealed record ExistingStaffReflection(
        Guid RecordId,
        DateOnly ReflectionDate,
        string? Progress,
        string? Impact,
        string? Examples,
        string Status);
}
