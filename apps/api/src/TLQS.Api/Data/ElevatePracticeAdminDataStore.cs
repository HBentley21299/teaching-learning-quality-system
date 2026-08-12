using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<ElevatePracticeWorkspaceSummary?> GetAdminElevatePracticeWorkspaceAsync(
        Guid assessmentId,
        CancellationToken cancellationToken)
    {
        var records = await QueryAsync(
            """
            SELECT staff_id, academic_year
            FROM quality.elevate_practice_assessments
            WHERE id = @assessmentId
              AND archived_at IS NULL;
            """,
            command => command.Parameters.AddWithValue("@assessmentId", assessmentId),
            reader => new AdminElevateRecordLookup(reader.GetGuid(0), reader.GetString(1)),
            cancellationToken);

        var record = records.FirstOrDefault();
        return record is null
            ? null
            : await GetElevatePracticeWorkspaceAsync(record.StaffId, record.AcademicYear, true, cancellationToken);
    }

    public Task<IReadOnlyList<ElevatePracticeAuditSummary>> GetElevatePracticeAuditHistoryAsync(
        Guid assessmentId,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT audit.id, audit.action, audit.summary,
                   COALESCE(actor.display_name, 'System') AS actor_name,
                   audit.before_json, audit.after_json, audit.created_at
            FROM quality.elevate_practice_assessments assessment
            JOIN ops.audit_logs audit ON audit.record_id = assessment.record_id
            LEFT JOIN auth.user_accounts account ON account.id = audit.user_account_id
            LEFT JOIN people.staff actor ON actor.id = account.staff_id
            WHERE assessment.id = @assessmentId
            ORDER BY audit.created_at DESC;
            """,
            command => command.Parameters.AddWithValue("@assessmentId", assessmentId),
            reader => new ElevatePracticeAuditSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                GetStringOrNull(reader, 2),
                reader.GetString(3),
                GetStringOrNull(reader, 4),
                GetStringOrNull(reader, 5),
                reader.GetFieldValue<DateTimeOffset>(6)),
            cancellationToken);

    [Obsolete("V1 statement-level admin save retained for migration compatibility only.")]
    public async Task<ElevatePracticeWorkspaceSummary?> AdminSaveLegacyElevatePracticeAssessmentAsync(
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
            throw new WorkflowValidationException("Elevate Learning and Innovation status must be Draft or Submitted.");
        }

        var ratings = (request.Ratings ?? [])
            .GroupBy(value => value.StatementId)
            .Select(group => group.Last())
            .ToArray();
        var reflections = (request.Reflections ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value.AreaKey))
            .GroupBy(value => value.AreaKey, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.Last())
            .ToArray();
        var strengths = NormalizeKeys(request.StrengthAreaKeys);
        var developments = NormalizeKeys(request.DevelopmentAreaKeys);
        var plans = (request.DevelopmentPlans ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value.AreaKey))
            .GroupBy(value => value.AreaKey, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.Last())
            .ToArray();

        ValidateAdminElevatePracticeRequest(current, ratings, reflections, strengths, developments, plans, status);
        var beforeJson = JsonSerializer.Serialize(current);

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            AdminElevateAssessmentRow assessment;
            await using (var assessmentCommand = new SqlCommand(
                """
                SELECT id, record_id, staff_id, framework_id, academic_year, status
                FROM quality.elevate_practice_assessments WITH (UPDLOCK, HOLDLOCK)
                WHERE id = @assessmentId
                  AND archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                assessmentCommand.Parameters.AddWithValue("@assessmentId", assessmentId);
                await using var reader = await assessmentCommand.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return null;
                }

                assessment = new AdminElevateAssessmentRow(
                    reader.GetGuid(0),
                    reader.GetGuid(1),
                    reader.GetGuid(2),
                    reader.GetGuid(3),
                    reader.GetString(4),
                    reader.GetString(5));
            }

            var existingPlans = new List<AdminElevatePlanActionRow>();
            await using (var existingPlanCommand = new SqlCommand(
                """
                SELECT area.area_key, plan_row.action_id
                FROM quality.elevate_practice_development_plans plan_row
                JOIN quality.elevate_practice_areas area ON area.id = plan_row.area_id
                WHERE plan_row.assessment_id = @assessmentId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                existingPlanCommand.Parameters.AddWithValue("@assessmentId", assessmentId);
                await using var reader = await existingPlanCommand.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    existingPlans.Add(new AdminElevatePlanActionRow(
                        reader.GetString(0),
                        GetGuidOrNull(reader, 1)));
                }
            }

            await using (var clearCommand = new SqlCommand(
                """
                DELETE FROM quality.elevate_practice_development_plans WHERE assessment_id = @assessmentId;
                DELETE FROM quality.elevate_practice_selections WHERE assessment_id = @assessmentId;
                DELETE FROM quality.elevate_practice_reflections WHERE assessment_id = @assessmentId;
                DELETE FROM quality.elevate_practice_ratings WHERE assessment_id = @assessmentId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                clearCommand.Parameters.AddWithValue("@assessmentId", assessmentId);
                await clearCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var rating in ratings)
            {
                await using var command = new SqlCommand(
                    """
                    INSERT INTO quality.elevate_practice_ratings (assessment_id, statement_id, score, descriptor_id)
                    SELECT @assessmentId, @statementId, descriptor.hidden_numeric_value, descriptor.id
                    FROM quality.elevate_practice_rubric_descriptors descriptor
                    WHERE descriptor.id = @descriptorId
                      AND descriptor.framework_id = @frameworkId
                      AND descriptor.archived_at IS NULL;
                    """,
                    connection,
                    (SqlTransaction)transaction);
                command.Parameters.AddWithValue("@assessmentId", assessmentId);
                command.Parameters.AddWithValue("@statementId", rating.StatementId);
                command.Parameters.AddWithValue("@descriptorId", rating.DescriptorId);
                command.Parameters.AddWithValue("@frameworkId", assessment.FrameworkId);
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
                command.Parameters.AddWithValue("@frameworkId", assessment.FrameworkId);
                command.Parameters.AddWithValue("@areaKey", reflection.AreaKey);
                command.Parameters.AddWithValue("@text", ToDbValue(string.IsNullOrWhiteSpace(reflection.Text) ? null : reflection.Text.Trim()));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var (areaKey, selectionType) in strengths.Select(value => (value, "strength"))
                         .Concat(developments.Select(value => (value, "development"))))
            {
                await using var command = new SqlCommand(
                    """
                    INSERT INTO quality.elevate_practice_selections (assessment_id, area_id, selection_type)
                    SELECT @assessmentId, id, @selectionType
                    FROM quality.elevate_practice_areas
                    WHERE framework_id = @frameworkId AND area_key = @areaKey;
                    """,
                    connection,
                    (SqlTransaction)transaction);
                command.Parameters.AddWithValue("@assessmentId", assessmentId);
                command.Parameters.AddWithValue("@frameworkId", assessment.FrameworkId);
                command.Parameters.AddWithValue("@areaKey", areaKey);
                command.Parameters.AddWithValue("@selectionType", selectionType);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            var retainedActionIds = new HashSet<Guid>();
            foreach (var plan in plans.Where(value => developments.Contains(value.AreaKey, StringComparer.OrdinalIgnoreCase)))
            {
                var area = current.Areas.Single(value => value.AreaKey.Equals(plan.AreaKey, StringComparison.OrdinalIgnoreCase));
                var supportNames = current.SupportOptions
                    .Where(option => (plan.SupportKeys ?? []).Contains(option.Key, StringComparer.OrdinalIgnoreCase))
                    .Select(option => option.Name)
                    .ToArray();
                var actionDetail = BuildElevatePracticeActionDetail(plan, supportNames);
                Guid? actionId = null;
                var existingActionId = existingPlans
                    .FirstOrDefault(value => value.AreaKey.Equals(plan.AreaKey, StringComparison.OrdinalIgnoreCase))
                    ?.ActionId;

                if (status == "submitted")
                {
                    if (existingActionId.HasValue)
                    {
                        await using var updateActionCommand = new SqlCommand(
                            """
                            UPDATE quality.actions
                            SET action_theme = @actionTheme,
                                title = @title,
                                detail = @detail,
                                due_date = NULL,
                                source_form_type = 'elevate_practice',
                                visibility_setting = 'staff_and_management',
                                archived_at = NULL,
                                deleted_by_user_account_id = NULL,
                                deletion_reason = NULL,
                                updated_by_user_account_id = @userAccountId,
                                updated_at = sysutcdatetime()
                            WHERE id = @actionId;
                            """,
                            connection,
                            (SqlTransaction)transaction);
                        updateActionCommand.Parameters.AddWithValue("@actionId", existingActionId.Value);
                        updateActionCommand.Parameters.AddWithValue("@actionTheme", area.Name);
                        updateActionCommand.Parameters.AddWithValue("@title", $"Elevate Learning and Innovation: {area.Name}");
                        updateActionCommand.Parameters.AddWithValue("@detail", actionDetail);
                        updateActionCommand.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                        await updateActionCommand.ExecuteNonQueryAsync(cancellationToken);
                        actionId = existingActionId.Value;
                    }
                    else
                    {
                        actionId = await InsertElevatePracticeActionAsync(
                            connection,
                            transaction,
                            assessment.RecordId,
                            assessment.StaffId,
                            area.Name,
                            actionDetail,
                            currentUser.UserAccountId,
                            cancellationToken);
                    }

                    retainedActionIds.Add(actionId.Value);
                }

                await using var planCommand = new SqlCommand(
                    """
                    INSERT INTO quality.elevate_practice_development_plans (
                        id, assessment_id, area_id, development_approach, support_keys_json,
                        support_details, success_evidence, intended_impact, action_id
                    )
                    SELECT @id, @assessmentId, id, @developmentApproach, @supportKeysJson,
                           @supportDetails, @successEvidence, @intendedImpact, @actionId
                    FROM quality.elevate_practice_areas
                    WHERE framework_id = @frameworkId AND area_key = @areaKey;
                    """,
                    connection,
                    (SqlTransaction)transaction);
                planCommand.Parameters.AddWithValue("@id", Guid.NewGuid());
                planCommand.Parameters.AddWithValue("@assessmentId", assessmentId);
                planCommand.Parameters.AddWithValue("@frameworkId", assessment.FrameworkId);
                planCommand.Parameters.AddWithValue("@areaKey", plan.AreaKey);
                planCommand.Parameters.AddWithValue("@developmentApproach", ToDbValue(plan.DevelopmentApproach));
                planCommand.Parameters.AddWithValue("@supportKeysJson", JsonSerializer.Serialize(NormalizeKeys(plan.SupportKeys)));
                planCommand.Parameters.AddWithValue("@supportDetails", ToDbValue(plan.SupportDetails));
                planCommand.Parameters.AddWithValue("@successEvidence", ToDbValue(plan.SuccessEvidence));
                planCommand.Parameters.AddWithValue("@intendedImpact", ToDbValue(plan.IntendedImpact));
                planCommand.Parameters.AddWithValue("@actionId", ToDbValue(actionId));
                await planCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var actionId in existingPlans
                         .Where(value => value.ActionId.HasValue && !retainedActionIds.Contains(value.ActionId.Value))
                         .Select(value => value.ActionId!.Value))
            {
                await using var archiveActionCommand = new SqlCommand(
                    """
                    UPDATE quality.actions
                    SET archived_at = sysutcdatetime(),
                        deleted_by_user_account_id = @userAccountId,
                        deletion_reason = 'Development area removed from Elevate Learning and Innovation.',
                        updated_by_user_account_id = @userAccountId,
                        updated_at = sysutcdatetime()
                    WHERE id = @actionId;
                    """,
                    connection,
                    (SqlTransaction)transaction);
                archiveActionCommand.Parameters.AddWithValue("@actionId", actionId);
                archiveActionCommand.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                await archiveActionCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var updateCommand = new SqlCommand(
                """
                UPDATE quality.elevate_practice_assessments
                SET status = @status,
                    submitted_at = CASE
                        WHEN @status = 'submitted' THEN COALESCE(submitted_at, sysutcdatetime())
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
                updateCommand.Parameters.AddWithValue("@assessmentId", assessmentId);
                updateCommand.Parameters.AddWithValue("@recordId", assessment.RecordId);
                updateCommand.Parameters.AddWithValue("@status", status);
                updateCommand.Parameters.AddWithValue("@summary", status == "submitted" ? "Submitted annual self-assessment" : "Draft annual self-assessment");
                updateCommand.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                await updateCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                assessment.RecordId,
                "elevate_practice_assessment",
                assessment.Id,
                "elevate_practice.admin_updated",
                $"Elevate Learning and Innovation {assessment.AcademicYear} amended by {currentUser.DisplayName}; status set to {status}.",
                beforeJson,
                JsonSerializer.Serialize(request),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }

        return await GetAdminElevatePracticeWorkspaceAsync(assessmentId, cancellationToken);
    }

    public async Task<bool> ArchiveElevatePracticeAssessmentAsync(
        Guid assessmentId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            Guid recordId;
            string academicYear;
            await using (var readCommand = new SqlCommand(
                """
                SELECT record_id, academic_year
                FROM quality.elevate_practice_assessments WITH (UPDLOCK, HOLDLOCK)
                WHERE id = @assessmentId
                  AND archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                readCommand.Parameters.AddWithValue("@assessmentId", assessmentId);
                await using var reader = await readCommand.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return false;
                }

                recordId = reader.GetGuid(0);
                academicYear = reader.GetString(1);
            }

            await using (var archiveCommand = new SqlCommand(
                """
                UPDATE quality.actions
                SET archived_at = sysutcdatetime(),
                    deleted_by_user_account_id = @userAccountId,
                    deletion_reason = 'Source Elevate Learning and Innovation record deleted.',
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE source_record_id = @recordId AND archived_at IS NULL;

                UPDATE quality.elevate_practice_assessments
                SET archived_at = sysutcdatetime(), updated_at = sysutcdatetime()
                WHERE id = @assessmentId;

                UPDATE core.records
                SET archived_at = sysutcdatetime(), updated_by_user_account_id = @userAccountId, updated_at = sysutcdatetime()
                WHERE id = @recordId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                archiveCommand.Parameters.AddWithValue("@assessmentId", assessmentId);
                archiveCommand.Parameters.AddWithValue("@recordId", recordId);
                archiveCommand.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                await archiveCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                recordId,
                "elevate_practice_assessment",
                assessmentId,
                "elevate_practice.archived",
                $"Elevate Learning and Innovation {academicYear} archived by {currentUser.DisplayName}.",
                JsonSerializer.Serialize(new { assessmentId, academicYear, archived = false }),
                JsonSerializer.Serialize(new { assessmentId, academicYear, archived = true }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static void ValidateAdminElevatePracticeRequest(
        ElevatePracticeWorkspaceSummary current,
        IReadOnlyList<ElevatePracticeRatingRequest> ratings,
        IReadOnlyList<ElevatePracticeReflectionRequest> reflections,
        IReadOnlyList<string> strengths,
        IReadOnlyList<string> developments,
        IReadOnlyList<ElevatePracticePlanRequest> plans,
        string status)
    {
        var statementIds = current.Areas.SelectMany(area => area.Statements).Select(statement => statement.Id).ToHashSet();
        var descriptorIds = current.RatingScale.Select(descriptor => descriptor.Id).ToHashSet();
        var areaKeys = current.Areas.Select(area => area.AreaKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var supportKeys = current.SupportOptions.Select(option => option.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (ratings.Any(value => !statementIds.Contains(value.StatementId) || !descriptorIds.Contains(value.DescriptorId)))
        {
            throw new WorkflowValidationException("Every rubric response must belong to this assessment framework.");
        }

        if (reflections.Any(value => !areaKeys.Contains(value.AreaKey))
            || strengths.Any(value => !areaKeys.Contains(value))
            || developments.Any(value => !areaKeys.Contains(value))
            || plans.Any(value => !areaKeys.Contains(value.AreaKey)))
        {
            throw new WorkflowValidationException("One or more selected practice areas do not belong to this assessment framework.");
        }

        if (plans.SelectMany(value => value.SupportKeys ?? []).Any(value => !supportKeys.Contains(value)))
        {
            throw new WorkflowValidationException("One or more selected support options are no longer available.");
        }

        if (strengths.Count > 3 || developments.Count > 2 || strengths.Intersect(developments, StringComparer.OrdinalIgnoreCase).Any())
        {
            throw new WorkflowValidationException("Select up to three distinct strengths and two distinct development areas.");
        }

        if (status == "submitted")
        {
            ValidateElevatePracticeSubmission(current, ratings, strengths, developments, plans);
        }
    }

    private static string BuildElevatePracticeActionDetail(
        ElevatePracticePlanRequest plan,
        IReadOnlyList<string> supportNames) =>
        $"Development approach:\n{plan.DevelopmentApproach}\n\nSupport:\n{(supportNames.Count == 0 ? "None selected" : string.Join(", ", supportNames))}\n\nSuccess evidence:\n{plan.SuccessEvidence}\n\nIntended impact:\n{plan.IntendedImpact}";

    private static async Task<Guid> InsertElevatePracticeActionAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid recordId,
        Guid staffId,
        string areaName,
        string detail,
        Guid? userAccountId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            INSERT INTO quality.actions (
                source_record_id, source_form_type, subject_staff_id, owner_staff_id, action_theme, title, detail,
                priority_lookup_value_id, status_lookup_value_id, published_to_staff,
                visibility_setting, created_by_user_account_id
            )
            OUTPUT inserted.id
            VALUES (
                @recordId, 'elevate_practice', @staffId, @staffId, @actionTheme, @title, @detail,
                (SELECT TOP (1) value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id WHERE type.lookup_key = 'priority' AND value.value_key = 'medium'),
                (SELECT TOP (1) value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id WHERE type.lookup_key = 'action_status' AND value.value_key = 'open'),
                1, 'staff_and_management', @userAccountId
            );
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@recordId", recordId);
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@actionTheme", areaName);
        command.Parameters.AddWithValue("@title", $"Elevate Learning and Innovation: {areaName}");
        command.Parameters.AddWithValue("@detail", detail);
        command.Parameters.AddWithValue("@userAccountId", ToDbValue(userAccountId));
        return (Guid)(await command.ExecuteScalarAsync(cancellationToken)
            ?? throw new InvalidOperationException("The development action insert did not return an id."));
    }

    private sealed record AdminElevateRecordLookup(Guid StaffId, string AcademicYear);
    private sealed record AdminElevateAssessmentRow(
        Guid Id,
        Guid RecordId,
        Guid StaffId,
        Guid FrameworkId,
        string AcademicYear,
        string Status);
    private sealed record AdminElevatePlanActionRow(string AreaKey, Guid? ActionId);
}
