using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<ElevatePracticeWorkspaceSummary> SaveElevatePracticeAssessmentAsync(
        SaveElevatePracticeAssessmentRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (!currentUser.StaffId.HasValue)
        {
            throw new WorkflowValidationException("A staff profile is required to complete Elevate Learning and Innovation.");
        }

        var staffId = currentUser.StaffId.Value;
        var academicYear = GetCurrentAcademicYear();
        var current = await GetElevatePracticeWorkspaceAsync(staffId, academicYear, true, cancellationToken);
        if (current.Status == "submitted")
        {
            throw new WorkflowValidationException("This academic year's assessment has been submitted and is locked.");
        }

        var ratings = (request.Ratings ?? [])
            .GroupBy(value => value.AreaId)
            .Select(group => group.Last())
            .ToArray();
        var reflections = (request.Reflections ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value.AreaKey))
            .GroupBy(value => value.AreaKey, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.Last())
            .ToArray();
        var livInformation = request.LivInformation
            ?? new SaveElevateLivInformationRequest(null, null, null, null, null, null);

        var knownAreaIds = current.Areas.Select(area => area.Id).ToHashSet();
        var knownAreaKeys = current.Areas.Select(area => area.AreaKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var activeDescriptorIds = current.RatingScale
            .Where(value => value.IsActive)
            .Select(value => value.Id)
            .ToHashSet();
        var noticeKeys = current.LivInformation.NoticeOptions.Select(option => option.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var focusKeys = current.LivInformation.FocusOptions.Select(option => option.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (ratings.Any(value => !knownAreaIds.Contains(value.AreaId) || !activeDescriptorIds.Contains(value.DescriptorId)))
        {
            throw new WorkflowValidationException("Every section response must use an active descriptor from this assessment framework.");
        }
        if (reflections.Any(value => !knownAreaKeys.Contains(value.AreaKey)))
        {
            throw new WorkflowValidationException("One or more reflections do not belong to this assessment framework.");
        }
        if (!string.IsNullOrWhiteSpace(livInformation.NoticePreferenceKey)
            && !noticeKeys.Contains(livInformation.NoticePreferenceKey))
        {
            throw new WorkflowValidationException("The selected LIV notice preference is no longer available.");
        }
        if ((!string.IsNullOrWhiteSpace(livInformation.PrimaryFocusKey) && !focusKeys.Contains(livInformation.PrimaryFocusKey))
            || (!string.IsNullOrWhiteSpace(livInformation.SecondaryFocusKey) && !focusKeys.Contains(livInformation.SecondaryFocusKey)))
        {
            throw new WorkflowValidationException("One or more selected LIV focus areas are no longer available.");
        }
        if (string.Equals(livInformation.PrimaryFocusKey, "other", StringComparison.OrdinalIgnoreCase))
        {
            throw new WorkflowValidationException("Select a named primary LIV focus area.");
        }
        if (string.Equals(livInformation.SecondaryFocusKey, "other", StringComparison.OrdinalIgnoreCase)
            && string.IsNullOrWhiteSpace(livInformation.SecondaryFocusOther))
        {
            throw new WorkflowValidationException("Describe the secondary LIV focus when Other is selected.");
        }

        DateOnly? preferredVisitMonth = null;
        if (!string.IsNullOrWhiteSpace(livInformation.PreferredVisitMonth))
        {
            if (!DateOnly.TryParseExact(
                    $"{livInformation.PreferredVisitMonth}-01",
                    "yyyy-MM-dd",
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None,
                    out var parsedMonth))
            {
                throw new WorkflowValidationException("The preferred LIV month is invalid.");
            }
            preferredVisitMonth = parsedMonth;
        }

        if (request.Submit)
        {
            if (ratings.Length != current.Areas.Count)
            {
                throw new WorkflowValidationException("Rate every Elevate Learning and Innovation section before submitting.");
            }
            if (string.IsNullOrWhiteSpace(livInformation.NoticePreferenceKey)
                || !preferredVisitMonth.HasValue
                || string.IsNullOrWhiteSpace(livInformation.PrimaryFocusKey)
                || string.IsNullOrWhiteSpace(livInformation.DesiredOutcome))
            {
                throw new WorkflowValidationException("Complete the LIV notice, preferred month, primary focus and intended outcome before submitting.");
            }
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var frameworkId = await ReadActiveElevateFrameworkIdAsync(connection, transaction, cancellationToken);
            var (assessmentId, recordId, isNew) = await GetOrCreateElevateAssessmentIdentityAsync(
                connection, transaction, staffId, academicYear, cancellationToken);

            if (isNew)
            {
                await InsertElevateAssessmentAsync(
                    connection, transaction, assessmentId, recordId, frameworkId,
                    staffId, academicYear, currentUser.UserAccountId, cancellationToken);
            }

            await ClearLegacyElevateDraftAsync(
                connection, transaction, assessmentId, currentUser.UserAccountId, cancellationToken);

            foreach (var rating in ratings)
            {
                await using var command = new SqlCommand(
                    """
                    INSERT INTO quality.elevate_practice_area_ratings (
                        assessment_id, area_id, descriptor_id, hidden_numeric_value
                    )
                    SELECT @assessmentId, area.id, descriptor.id, descriptor.hidden_numeric_value
                    FROM quality.elevate_practice_areas area
                    JOIN quality.elevate_practice_rubric_descriptors descriptor
                      ON descriptor.id = @descriptorId
                     AND descriptor.framework_id = area.framework_id
                    WHERE area.id = @areaId
                      AND area.framework_id = @frameworkId
                      AND descriptor.is_active = 1
                      AND descriptor.archived_at IS NULL;
                    """,
                    connection,
                    (SqlTransaction)transaction);
                command.Parameters.AddWithValue("@assessmentId", assessmentId);
                command.Parameters.AddWithValue("@areaId", rating.AreaId);
                command.Parameters.AddWithValue("@descriptorId", rating.DescriptorId);
                command.Parameters.AddWithValue("@frameworkId", frameworkId);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var reflection in reflections)
            {
                await using var command = new SqlCommand(
                    """
                    INSERT INTO quality.elevate_practice_reflections (assessment_id, area_id, reflection_text)
                    SELECT @assessmentId, id, @text
                    FROM quality.elevate_practice_areas
                    WHERE framework_id = @frameworkId AND area_key = @areaKey;
                    """,
                    connection,
                    (SqlTransaction)transaction);
                command.Parameters.AddWithValue("@assessmentId", assessmentId);
                command.Parameters.AddWithValue("@frameworkId", frameworkId);
                command.Parameters.AddWithValue("@areaKey", reflection.AreaKey);
                command.Parameters.AddWithValue("@text", ToDbValue(string.IsNullOrWhiteSpace(reflection.Text) ? null : reflection.Text.Trim()));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await SaveElevateLivInformationAsync(
                connection, transaction, assessmentId, livInformation, preferredVisitMonth, cancellationToken);

            var status = request.Submit ? "submitted" : "draft";
            await using (var command = new SqlCommand(
                """
                UPDATE quality.elevate_practice_assessments
                SET status = @status,
                    submitted_at = CASE WHEN @status = N'submitted' THEN sysutcdatetime() ELSE NULL END,
                    updated_at = sysutcdatetime()
                WHERE id = @assessmentId;

                UPDATE core.records
                SET summary = @summary,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @recordId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@assessmentId", assessmentId);
                command.Parameters.AddWithValue("@recordId", recordId);
                command.Parameters.AddWithValue("@status", status);
                command.Parameters.AddWithValue("@summary", request.Submit ? "Submitted annual self-assessment" : "Draft annual self-assessment");
                command.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, recordId,
                "elevate_practice_assessment", assessmentId,
                request.Submit ? "elevate_practice.submitted" : "elevate_practice.draft_saved",
                request.Submit
                    ? $"Elevate Learning and Innovation {academicYear} submitted by {currentUser.DisplayName}."
                    : $"Elevate Learning and Innovation {academicYear} draft saved by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(request), cancellationToken);

            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }

        return await GetElevatePracticeWorkspaceAsync(staffId, academicYear, true, cancellationToken);
    }

    private static async Task<Guid> ReadActiveElevateFrameworkIdAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            "SELECT TOP (1) id FROM quality.elevate_practice_frameworks WHERE is_active = 1 AND archived_at IS NULL ORDER BY created_at DESC;",
            connection,
            (SqlTransaction)transaction);
        return (Guid)(await command.ExecuteScalarAsync(cancellationToken)
            ?? throw new WorkflowValidationException("The Elevate Learning and Innovation framework has not been configured."));
    }

    private static async Task<(Guid AssessmentId, Guid RecordId, bool IsNew)> GetOrCreateElevateAssessmentIdentityAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid staffId,
        string academicYear,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT id, record_id, status
            FROM quality.elevate_practice_assessments WITH (UPDLOCK, HOLDLOCK)
            WHERE staff_id = @staffId AND academic_year = @academicYear AND archived_at IS NULL;
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@academicYear", academicYear);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return (Guid.NewGuid(), Guid.NewGuid(), true);
        }
        if (reader.GetString(2) == "submitted")
        {
            throw new WorkflowValidationException("This academic year's assessment has been submitted and is locked.");
        }
        return (reader.GetGuid(0), reader.GetGuid(1), false);
    }

    private static async Task InsertElevateAssessmentAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid assessmentId,
        Guid recordId,
        Guid frameworkId,
        Guid staffId,
        string academicYear,
        Guid? userAccountId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            DECLARE @moduleId uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = N'elevate_practice');
            DECLARE @orgUnitId uniqueidentifier = (SELECT primary_org_unit_id FROM people.staff WHERE id = @staffId);
            INSERT INTO core.records (
                id, module_id, record_type, title, summary, subject_staff_id, owner_staff_id,
                org_unit_id, record_date, created_by_user_account_id
            )
            VALUES (
                @recordId, @moduleId, N'elevate_practice_assessment', @title, N'Draft annual self-assessment',
                @staffId, @staffId, @orgUnitId, CONVERT(date, sysutcdatetime()), @userAccountId
            );
            INSERT INTO quality.elevate_practice_assessments (
                id, record_id, framework_id, staff_id, academic_year, status
            ) VALUES (@assessmentId, @recordId, @frameworkId, @staffId, @academicYear, N'draft');
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@assessmentId", assessmentId);
        command.Parameters.AddWithValue("@recordId", recordId);
        command.Parameters.AddWithValue("@frameworkId", frameworkId);
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@academicYear", academicYear);
        command.Parameters.AddWithValue("@title", $"Elevate Learning and Innovation - {academicYear}");
        command.Parameters.AddWithValue("@userAccountId", ToDbValue(userAccountId));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task ClearLegacyElevateDraftAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid assessmentId,
        Guid? userAccountId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            UPDATE action_row
            SET archived_at = COALESCE(action_row.archived_at, sysutcdatetime()),
                deleted_by_user_account_id = @userAccountId,
                deletion_reason = N'Legacy EYP development plan removed in V2.',
                updated_by_user_account_id = @userAccountId,
                updated_at = sysutcdatetime()
            FROM quality.actions action_row
            JOIN quality.elevate_practice_development_plans plan_row ON plan_row.action_id = action_row.id
            WHERE plan_row.assessment_id = @assessmentId;

            DELETE FROM quality.elevate_practice_development_plans WHERE assessment_id = @assessmentId;
            DELETE FROM quality.elevate_practice_selections WHERE assessment_id = @assessmentId;
            DELETE FROM quality.elevate_practice_reflections WHERE assessment_id = @assessmentId;
            DELETE FROM quality.elevate_practice_ratings WHERE assessment_id = @assessmentId;
            DELETE FROM quality.elevate_practice_area_ratings WHERE assessment_id = @assessmentId;
            DELETE FROM quality.elevate_practice_liv_information WHERE assessment_id = @assessmentId;
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@assessmentId", assessmentId);
        command.Parameters.AddWithValue("@userAccountId", ToDbValue(userAccountId));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task SaveElevateLivInformationAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid assessmentId,
        SaveElevateLivInformationRequest request,
        DateOnly? preferredVisitMonth,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            INSERT INTO quality.elevate_practice_liv_information (
                assessment_id, notice_preference_lookup_value_id, preferred_visit_month,
                primary_focus_lookup_value_id, secondary_focus_lookup_value_id,
                secondary_focus_other, desired_outcome
            )
            SELECT @assessmentId, notice.id, @preferredVisitMonth,
                   primary_focus.id, secondary_focus.id, @secondaryFocusOther, @desiredOutcome
            FROM (SELECT 1 AS anchor) seed
            LEFT JOIN core.lookup_values notice ON notice.value_key = @noticePreferenceKey
              AND notice.lookup_type_id = (SELECT id FROM core.lookup_types WHERE lookup_key = N'liv_notice_preference')
            LEFT JOIN core.lookup_values primary_focus ON primary_focus.value_key = @primaryFocusKey
              AND primary_focus.lookup_type_id = (SELECT id FROM core.lookup_types WHERE lookup_key = N'liv_focus_area')
            LEFT JOIN core.lookup_values secondary_focus ON secondary_focus.value_key = @secondaryFocusKey
              AND secondary_focus.lookup_type_id = (SELECT id FROM core.lookup_types WHERE lookup_key = N'liv_focus_area');
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@assessmentId", assessmentId);
        command.Parameters.AddWithValue("@noticePreferenceKey", ToDbValue(request.NoticePreferenceKey));
        command.Parameters.AddWithValue("@preferredVisitMonth", ToDbValue(preferredVisitMonth));
        command.Parameters.AddWithValue("@primaryFocusKey", ToDbValue(request.PrimaryFocusKey));
        command.Parameters.AddWithValue("@secondaryFocusKey", ToDbValue(request.SecondaryFocusKey));
        command.Parameters.AddWithValue("@secondaryFocusOther", ToDbValue(request.SecondaryFocusOther?.Trim()));
        command.Parameters.AddWithValue("@desiredOutcome", ToDbValue(request.DesiredOutcome?.Trim()));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
