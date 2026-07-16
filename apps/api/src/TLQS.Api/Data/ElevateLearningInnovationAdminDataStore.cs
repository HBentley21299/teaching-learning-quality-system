using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<ElevatePracticeWorkspaceSummary?> AdminSaveElevatePracticeAssessmentAsync(
        Guid assessmentId,
        AdminSaveElevatePracticeAssessmentRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var current = await GetAdminElevatePracticeWorkspaceAsync(assessmentId, cancellationToken);
        if (current is null)
        {
            return null;
        }

        var status = request.Status.Trim().ToLowerInvariant();
        if (status is not ("draft" or "submitted"))
        {
            throw new WorkflowValidationException("The record status must be Draft or Submitted.");
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

        var areaIds = current.Areas.Select(area => area.Id).ToHashSet();
        var areaKeys = current.Areas.Select(area => area.AreaKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var descriptorIds = current.RatingScale.Select(descriptor => descriptor.Id).ToHashSet();
        var noticeKeys = current.LivInformation.NoticeOptions.Select(option => option.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var focusKeys = current.LivInformation.FocusOptions.Select(option => option.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (ratings.Any(value => !areaIds.Contains(value.AreaId) || !descriptorIds.Contains(value.DescriptorId)))
        {
            throw new WorkflowValidationException("Every section response must belong to this assessment framework.");
        }
        if (reflections.Any(value => !areaKeys.Contains(value.AreaKey)))
        {
            throw new WorkflowValidationException("One or more reflections do not belong to this assessment framework.");
        }
        if ((!string.IsNullOrWhiteSpace(livInformation.NoticePreferenceKey) && !noticeKeys.Contains(livInformation.NoticePreferenceKey))
            || (!string.IsNullOrWhiteSpace(livInformation.PrimaryFocusKey) && !focusKeys.Contains(livInformation.PrimaryFocusKey))
            || (!string.IsNullOrWhiteSpace(livInformation.SecondaryFocusKey) && !focusKeys.Contains(livInformation.SecondaryFocusKey)))
        {
            throw new WorkflowValidationException("One or more LIV information choices are no longer available.");
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
                    $"{livInformation.PreferredVisitMonth}-01", "yyyy-MM-dd",
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None,
                    out var parsedMonth))
            {
                throw new WorkflowValidationException("The preferred LIV month is invalid.");
            }
            preferredVisitMonth = parsedMonth;
        }

        if (status == "submitted"
            && (ratings.Length != current.Areas.Count
                || string.IsNullOrWhiteSpace(livInformation.NoticePreferenceKey)
                || !preferredVisitMonth.HasValue
                || string.IsNullOrWhiteSpace(livInformation.PrimaryFocusKey)
                || string.IsNullOrWhiteSpace(livInformation.DesiredOutcome)))
        {
            throw new WorkflowValidationException("A submitted record needs every section rating and complete LIV information.");
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            Guid recordId;
            Guid frameworkId;
            string academicYear;
            await using (var command = new SqlCommand(
                """
                SELECT record_id, framework_id, academic_year
                FROM quality.elevate_practice_assessments WITH (UPDLOCK, HOLDLOCK)
                WHERE id = @assessmentId AND archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@assessmentId", assessmentId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return null;
                }
                recordId = reader.GetGuid(0);
                frameworkId = reader.GetGuid(1);
                academicYear = reader.GetString(2);
            }

            var beforeJson = JsonSerializer.Serialize(current);
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
                      ON descriptor.id = @descriptorId AND descriptor.framework_id = area.framework_id
                    WHERE area.id = @areaId AND area.framework_id = @frameworkId
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

            await using (var command = new SqlCommand(
                """
                UPDATE quality.elevate_practice_assessments
                SET status = @status,
                    submitted_at = CASE
                        WHEN @status = N'submitted' THEN COALESCE(submitted_at, sysutcdatetime())
                        ELSE NULL
                    END,
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
                command.Parameters.AddWithValue("@summary", status == "submitted" ? "Submitted annual self-assessment" : "Draft annual self-assessment");
                command.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, recordId,
                "elevate_practice_assessment", assessmentId,
                "elevate_practice.admin_updated",
                $"Elevate Learning and Innovation {academicYear} amended by {currentUser.DisplayName}; status set to {status}.",
                beforeJson, JsonSerializer.Serialize(request), cancellationToken);

            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }

        return await GetAdminElevatePracticeWorkspaceAsync(assessmentId, cancellationToken);
    }
}
