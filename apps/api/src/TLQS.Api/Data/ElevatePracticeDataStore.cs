using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static readonly IReadOnlyList<ElevatePracticeRatingScaleSummary> ElevatePracticeRatingScale =
    [
        new(1, "Not yet evident", "This is not currently evident or established within my practice.", "#B42318"),
        new(2, "Emerging", "I am beginning to develop this, but it is not yet consistent or fully effective.", "#E56B1F"),
        new(3, "Secure", "This is usually evident within my practice and generally supports learners effectively.", "#D7A700"),
        new(4, "Strong", "This is consistently embedded within my practice and has a clear positive impact on learners.", "#69A84F"),
        new(5, "Leading practice", "This is highly effective, consistently embedded and supported by clear evidence of impact.", "#237A3B")
    ];

    public static string GetCurrentAcademicYear(DateTimeOffset? current = null)
    {
        var date = current ?? DateTimeOffset.UtcNow;
        var startYear = date.Month >= 9 ? date.Year : date.Year - 1;
        return $"{startYear}/{(startYear + 1) % 100:00}";
    }

    public async Task<ElevatePracticeWorkspaceSummary> GetElevatePracticeWorkspaceAsync(
        Guid staffId,
        string academicYear,
        bool canEdit,
        CancellationToken cancellationToken)
    {
        var staffRows = await QueryAsync(
            """
            SELECT s.id, s.display_name,
                   CASE WHEN team.org_unit_type = 'faculty' THEN team.name ELSE faculty.name END AS faculty_name,
                   CASE WHEN team.org_unit_type = 'team' THEN team.name ELSE NULL END AS team_name
            FROM people.staff s
            LEFT JOIN org.org_units team ON team.id = s.primary_org_unit_id AND team.archived_at IS NULL
            LEFT JOIN org.org_units faculty ON faculty.id = team.parent_org_unit_id AND faculty.archived_at IS NULL
            WHERE s.id = @staffId AND s.archived_at IS NULL;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader => new ElevatePracticeStaffRow(
                reader.GetGuid(0),
                reader.GetString(1),
                GetStringOrNull(reader, 2),
                GetStringOrNull(reader, 3)),
            cancellationToken);

        if (staffRows.Count == 0)
        {
            throw new WorkflowValidationException("The selected staff profile was not found.");
        }

        var frameworkRows = await QueryAsync(
            """
            SELECT TOP (1) id
            FROM quality.elevate_practice_frameworks
            WHERE is_active = 1 AND archived_at IS NULL
            ORDER BY created_at DESC;
            """,
            reader => reader.GetGuid(0),
            cancellationToken);
        if (frameworkRows.Count == 0)
        {
            throw new WorkflowValidationException("The Elevate Your Practice framework has not been configured.");
        }

        var frameworkId = frameworkRows[0];
        var assessmentRows = await QueryAsync(
            """
            SELECT id, record_id, framework_id, status, submitted_at
            FROM quality.elevate_practice_assessments
            WHERE staff_id = @staffId AND academic_year = @academicYear;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@academicYear", academicYear);
            },
            reader => new ElevatePracticeAssessmentRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetGuid(2),
                reader.GetString(3),
                GetDateTimeOffsetOrNull(reader, 4)),
            cancellationToken);
        var assessment = assessmentRows.FirstOrDefault();
        frameworkId = assessment?.FrameworkId ?? frameworkId;

        var definitionRows = await QueryAsync(
            """
            SELECT a.id, a.area_key, a.category, a.name, a.reflection_prompt, a.display_order,
                   s.id, s.statement_key, s.statement_text, s.display_order,
                   rating.score, reflection.reflection_text
            FROM quality.elevate_practice_areas a
            JOIN quality.elevate_practice_statements s ON s.area_id = a.id
            LEFT JOIN quality.elevate_practice_ratings rating
                ON rating.statement_id = s.id AND rating.assessment_id = @assessmentId
            LEFT JOIN quality.elevate_practice_reflections reflection
                ON reflection.area_id = a.id AND reflection.assessment_id = @assessmentId
            WHERE a.framework_id = @frameworkId
            ORDER BY a.display_order, s.display_order;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@frameworkId", frameworkId);
                command.Parameters.AddWithValue("@assessmentId", ToDbValue(assessment?.Id));
            },
            reader => new ElevatePracticeDefinitionRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetInt32(5),
                reader.GetGuid(6),
                reader.GetString(7),
                reader.GetString(8),
                reader.GetInt32(9),
                reader.IsDBNull(10) ? null : reader.GetByte(10),
                GetStringOrNull(reader, 11)),
            cancellationToken);

        var areas = definitionRows
            .GroupBy(row => new { row.AreaId, row.AreaKey, row.Category, row.AreaName, row.ReflectionPrompt, row.AreaOrder })
            .Select(group =>
            {
                var scores = group.Where(row => row.Score.HasValue).Select(row => (decimal)row.Score!.Value).ToArray();
                return new ElevatePracticeAreaSummary(
                    group.Key.AreaId,
                    group.Key.AreaKey,
                    group.Key.Category,
                    group.Key.AreaName,
                    group.Key.ReflectionPrompt,
                    group.Key.AreaOrder,
                    scores.Length == 0 ? null : Math.Round(scores.Average(), 2),
                    group.First().Reflection,
                    group.Select(row => new ElevatePracticeStatementSummary(
                        row.StatementId,
                        row.StatementKey,
                        row.StatementText,
                        row.StatementOrder,
                        row.Score)).ToArray());
            })
            .OrderBy(area => area.DisplayOrder)
            .ToArray();

        IReadOnlyList<ElevatePracticeSelectionRow> selections = [];
        IReadOnlyList<ElevatePracticePlanSummary> plans = [];
        if (assessment is not null)
        {
            selections = await QueryAsync(
                """
                SELECT a.area_key, selection.selection_type
                FROM quality.elevate_practice_selections selection
                JOIN quality.elevate_practice_areas a ON a.id = selection.area_id
                WHERE selection.assessment_id = @assessmentId;
                """,
                command => command.Parameters.AddWithValue("@assessmentId", assessment.Id),
                reader => new ElevatePracticeSelectionRow(reader.GetString(0), reader.GetString(1)),
                cancellationToken);

            plans = await QueryAsync(
                """
                SELECT a.area_key, development.development_approach, development.support_keys_json, development.support_details,
                       development.success_evidence, development.intended_impact, development.review_date, development.action_id
                FROM quality.elevate_practice_development_plans development
                JOIN quality.elevate_practice_areas a ON a.id = development.area_id
                WHERE development.assessment_id = @assessmentId
                ORDER BY a.display_order;
                """,
                command => command.Parameters.AddWithValue("@assessmentId", assessment.Id),
                reader => new ElevatePracticePlanSummary(
                    reader.GetString(0),
                    GetStringOrNull(reader, 1) ?? "",
                    ParseJsonStringList(GetStringOrNull(reader, 2)),
                    GetStringOrNull(reader, 3) ?? "",
                    GetStringOrNull(reader, 4) ?? "",
                    GetStringOrNull(reader, 5) ?? "",
                    GetDateOnlyOrNull(reader, 6),
                    GetGuidOrNull(reader, 7)),
                cancellationToken);
        }

        var supportOptions = await QueryAsync(
            """
            SELECT lv.value_key, lv.display_name
            FROM core.lookup_values lv
            JOIN core.lookup_types lt ON lt.id = lv.lookup_type_id
            WHERE lt.lookup_key = 'elevate_practice_support'
              AND lv.is_active = 1
              AND lv.archived_at IS NULL
            ORDER BY lv.display_order, lv.display_name;
            """,
            reader => new ElevatePracticeSupportOptionSummary(reader.GetString(0), reader.GetString(1)),
            cancellationToken);

        var scoredAreas = areas.Where(area => area.AverageScore.HasValue).ToArray();
        var suggestedStrengths = scoredAreas
            .OrderByDescending(area => area.AverageScore)
            .ThenBy(area => area.DisplayOrder)
            .Take(3)
            .Select(area => area.AreaKey)
            .ToArray();
        var suggestedDevelopments = scoredAreas
            .OrderBy(area => area.AverageScore)
            .ThenByDescending(area => area.DisplayOrder)
            .Take(2)
            .Select(area => area.AreaKey)
            .ToArray();
        var staff = staffRows[0];

        return new ElevatePracticeWorkspaceSummary(
            academicYear,
            assessment?.Id,
            assessment?.RecordId,
            assessment?.Status ?? "not_started",
            assessment?.SubmittedAt,
            staff.Id,
            staff.DisplayName,
            staff.FacultyName,
            staff.TeamName,
            canEdit && !string.Equals(assessment?.Status, "submitted", StringComparison.OrdinalIgnoreCase),
            ElevatePracticeRatingScale,
            supportOptions,
            areas,
            selections.Where(value => value.SelectionType == "strength").Select(value => value.AreaKey).ToArray(),
            selections.Where(value => value.SelectionType == "development").Select(value => value.AreaKey).ToArray(),
            suggestedStrengths,
            suggestedDevelopments,
            plans);
    }

    public async Task<ElevatePracticeWorkspaceSummary?> GetLatestElevatePracticeWorkspaceAsync(
        Guid staffId,
        CancellationToken cancellationToken)
    {
        var years = await QueryAsync(
            """
            SELECT TOP (1) academic_year
            FROM quality.elevate_practice_assessments
            WHERE staff_id = @staffId
            ORDER BY academic_year DESC;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader => reader.GetString(0),
            cancellationToken);
        return years.Count == 0
            ? null
            : await GetElevatePracticeWorkspaceAsync(staffId, years[0], false, cancellationToken);
    }

    public async Task<ElevatePracticeWorkspaceSummary> SaveElevatePracticeAssessmentAsync(
        SaveElevatePracticeAssessmentRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (!currentUser.StaffId.HasValue)
        {
            throw new WorkflowValidationException("A staff profile is required to complete Elevate Your Practice.");
        }

        var staffId = currentUser.StaffId.Value;
        var academicYear = GetCurrentAcademicYear();
        var current = await GetElevatePracticeWorkspaceAsync(staffId, academicYear, true, cancellationToken);
        if (current.Status == "submitted")
        {
            throw new WorkflowValidationException("This academic year's assessment has been submitted and is locked.");
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

        var knownStatementIds = current.Areas.SelectMany(area => area.Statements).Select(statement => statement.Id).ToHashSet();
        var knownAreaKeys = current.Areas.Select(area => area.AreaKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var knownSupportKeys = current.SupportOptions.Select(option => option.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (ratings.Any(value => !knownStatementIds.Contains(value.StatementId) || value.Score is < 1 or > 5))
        {
            throw new WorkflowValidationException("Every saved rating must belong to the active framework and use a score from 1 to 5.");
        }

        if (reflections.Any(value => !knownAreaKeys.Contains(value.AreaKey))
            || strengths.Any(value => !knownAreaKeys.Contains(value))
            || developments.Any(value => !knownAreaKeys.Contains(value))
            || plans.Any(value => !knownAreaKeys.Contains(value.AreaKey)))
        {
            throw new WorkflowValidationException("One or more selected practice areas do not belong to the active framework.");
        }

        if (plans.SelectMany(value => value.SupportKeys ?? []).Any(value => !knownSupportKeys.Contains(value)))
        {
            throw new WorkflowValidationException("One or more selected support options are no longer active.");
        }

        if (strengths.Count > 3 || developments.Count > 2 || strengths.Intersect(developments, StringComparer.OrdinalIgnoreCase).Any())
        {
            throw new WorkflowValidationException("Select up to three distinct strengths and two distinct development areas.");
        }

        if (request.Submit)
        {
            ValidateElevatePracticeSubmission(current, ratings, reflections, strengths, developments, plans);
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            Guid frameworkId;
            await using (var frameworkCommand = new SqlCommand(
                "SELECT TOP (1) id FROM quality.elevate_practice_frameworks WHERE is_active = 1 AND archived_at IS NULL ORDER BY created_at DESC;",
                connection,
                (SqlTransaction)transaction))
            {
                frameworkId = (Guid)(await frameworkCommand.ExecuteScalarAsync(cancellationToken)
                    ?? throw new WorkflowValidationException("The Elevate Your Practice framework has not been configured."));
            }

            Guid assessmentId;
            Guid recordId;
            var isNewAssessment = false;
            await using (var existingCommand = new SqlCommand(
                """
                SELECT id, record_id, status
                FROM quality.elevate_practice_assessments WITH (UPDLOCK, HOLDLOCK)
                WHERE staff_id = @staffId AND academic_year = @academicYear;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                existingCommand.Parameters.AddWithValue("@staffId", staffId);
                existingCommand.Parameters.AddWithValue("@academicYear", academicYear);
                await using var reader = await existingCommand.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                {
                    assessmentId = reader.GetGuid(0);
                    recordId = reader.GetGuid(1);
                    if (reader.GetString(2) == "submitted")
                    {
                        throw new WorkflowValidationException("This academic year's assessment has been submitted and is locked.");
                    }
                }
                else
                {
                    assessmentId = Guid.NewGuid();
                    recordId = Guid.NewGuid();
                    isNewAssessment = true;
                }
            }

            if (isNewAssessment)
            {
                await using var insertCommand = new SqlCommand(
                    """
                    DECLARE @moduleId uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = 'elevate_practice');
                    DECLARE @orgUnitId uniqueidentifier = (SELECT primary_org_unit_id FROM people.staff WHERE id = @staffId);
                    INSERT INTO core.records (
                        id, module_id, record_type, title, summary, subject_staff_id, owner_staff_id,
                        org_unit_id, record_date, created_by_user_account_id
                    )
                    VALUES (
                        @recordId, @moduleId, 'elevate_practice_assessment', @title, 'Draft annual self-assessment',
                        @staffId, @staffId, @orgUnitId, CONVERT(date, sysutcdatetime()), @userAccountId
                    );
                    INSERT INTO quality.elevate_practice_assessments (
                        id, record_id, framework_id, staff_id, academic_year, status
                    )
                    VALUES (@assessmentId, @recordId, @frameworkId, @staffId, @academicYear, 'draft');
                    """,
                    connection,
                    (SqlTransaction)transaction);
                insertCommand.Parameters.AddWithValue("@assessmentId", assessmentId);
                insertCommand.Parameters.AddWithValue("@recordId", recordId);
                insertCommand.Parameters.AddWithValue("@frameworkId", frameworkId);
                insertCommand.Parameters.AddWithValue("@staffId", staffId);
                insertCommand.Parameters.AddWithValue("@academicYear", academicYear);
                insertCommand.Parameters.AddWithValue("@title", $"Elevate Your Practice - {academicYear}");
                insertCommand.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                await insertCommand.ExecuteNonQueryAsync(cancellationToken);
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
                    "INSERT INTO quality.elevate_practice_ratings (assessment_id, statement_id, score) VALUES (@assessmentId, @statementId, @score);",
                    connection,
                    (SqlTransaction)transaction);
                command.Parameters.AddWithValue("@assessmentId", assessmentId);
                command.Parameters.AddWithValue("@statementId", rating.StatementId);
                command.Parameters.AddWithValue("@score", rating.Score);
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
                command.Parameters.AddWithValue("@text", ToDbValue(reflection.Text));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var (key, type) in strengths.Select(key => (key, "strength")).Concat(developments.Select(key => (key, "development"))))
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
                command.Parameters.AddWithValue("@frameworkId", frameworkId);
                command.Parameters.AddWithValue("@areaKey", key);
                command.Parameters.AddWithValue("@selectionType", type);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var plan in plans.Where(value => developments.Contains(value.AreaKey, StringComparer.OrdinalIgnoreCase)))
            {
                var planId = Guid.NewGuid();
                await using (var command = new SqlCommand(
                    """
                    INSERT INTO quality.elevate_practice_development_plans (
                        id, assessment_id, area_id, development_approach, support_keys_json, support_details,
                        success_evidence, intended_impact, review_date
                    )
                    SELECT @id, @assessmentId, id, @developmentApproach, @supportKeysJson, @supportDetails,
                           @successEvidence, @intendedImpact, @reviewDate
                    FROM quality.elevate_practice_areas
                    WHERE framework_id = @frameworkId AND area_key = @areaKey;
                    """,
                    connection,
                    (SqlTransaction)transaction))
                {
                    command.Parameters.AddWithValue("@id", planId);
                    command.Parameters.AddWithValue("@assessmentId", assessmentId);
                    command.Parameters.AddWithValue("@frameworkId", frameworkId);
                    command.Parameters.AddWithValue("@areaKey", plan.AreaKey);
                    command.Parameters.AddWithValue("@developmentApproach", ToDbValue(plan.DevelopmentApproach));
                    command.Parameters.AddWithValue("@supportKeysJson", JsonSerializer.Serialize(NormalizeKeys(plan.SupportKeys)));
                    command.Parameters.AddWithValue("@supportDetails", ToDbValue(plan.SupportDetails));
                    command.Parameters.AddWithValue("@successEvidence", ToDbValue(plan.SuccessEvidence));
                    command.Parameters.AddWithValue("@intendedImpact", ToDbValue(plan.IntendedImpact));
                    command.Parameters.AddWithValue("@reviewDate", ToDbValue(plan.ReviewDate));
                    await command.ExecuteNonQueryAsync(cancellationToken);
                }

                if (request.Submit)
                {
                    var area = current.Areas.Single(value => value.AreaKey.Equals(plan.AreaKey, StringComparison.OrdinalIgnoreCase));
                    var supportNames = current.SupportOptions
                        .Where(option => (plan.SupportKeys ?? []).Contains(option.Key, StringComparer.OrdinalIgnoreCase))
                        .Select(option => option.Name)
                        .ToArray();
                    var detail = $"Development approach:\n{plan.DevelopmentApproach}\n\nSupport:\n{(supportNames.Length == 0 ? "None selected" : string.Join(", ", supportNames))}\n\nSuccess evidence:\n{plan.SuccessEvidence}\n\nIntended impact:\n{plan.IntendedImpact}";
                    Guid actionId;
                    await using (var actionCommand = new SqlCommand(
                        """
                        INSERT INTO quality.actions (
                            source_record_id, subject_staff_id, owner_staff_id, title, detail,
                            priority_lookup_value_id, status_lookup_value_id, due_date, published_to_staff,
                            created_by_user_account_id
                        )
                        OUTPUT inserted.id
                        VALUES (
                            @recordId, @staffId, @staffId, @title, @detail,
                            (SELECT TOP (1) lv.id FROM core.lookup_values lv JOIN core.lookup_types lt ON lt.id = lv.lookup_type_id WHERE lt.lookup_key = 'priority' AND lv.value_key = 'medium'),
                            (SELECT TOP (1) lv.id FROM core.lookup_values lv JOIN core.lookup_types lt ON lt.id = lv.lookup_type_id WHERE lt.lookup_key = 'action_status' AND lv.value_key = 'open'),
                            @dueDate, 1, @userAccountId
                        );
                        """,
                        connection,
                        (SqlTransaction)transaction))
                    {
                        actionCommand.Parameters.AddWithValue("@recordId", recordId);
                        actionCommand.Parameters.AddWithValue("@staffId", staffId);
                        actionCommand.Parameters.AddWithValue("@title", $"Elevate Your Practice: {area.Name}");
                        actionCommand.Parameters.AddWithValue("@detail", detail);
                        actionCommand.Parameters.AddWithValue("@dueDate", ToDbValue(plan.ReviewDate));
                        actionCommand.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                        actionId = (Guid)(await actionCommand.ExecuteScalarAsync(cancellationToken)
                            ?? throw new InvalidOperationException("The development action insert did not return an id."));
                    }

                    await WriteAuditAsync(
                        connection,
                        transaction,
                        currentUser.UserAccountId,
                        recordId,
                        "action",
                        actionId,
                        "action.created",
                        $"Elevate Your Practice development action for {area.Name} created by {currentUser.DisplayName}.",
                        null,
                        JsonSerializer.Serialize(new
                        {
                            title = $"Elevate Your Practice: {area.Name}",
                            ownerStaffId = staffId,
                            dueDate = plan.ReviewDate?.ToString("yyyy-MM-dd"),
                            status = "open"
                        }),
                        cancellationToken);

                    await using var linkCommand = new SqlCommand(
                        "UPDATE quality.elevate_practice_development_plans SET action_id = @actionId WHERE id = @planId;",
                        connection,
                        (SqlTransaction)transaction);
                    linkCommand.Parameters.AddWithValue("@actionId", actionId);
                    linkCommand.Parameters.AddWithValue("@planId", planId);
                    await linkCommand.ExecuteNonQueryAsync(cancellationToken);
                }
            }

            await using (var updateCommand = new SqlCommand(
                """
                UPDATE quality.elevate_practice_assessments
                SET status = @status,
                    submitted_at = CASE WHEN @submit = 1 THEN sysutcdatetime() ELSE NULL END,
                    updated_at = sysutcdatetime()
                WHERE id = @assessmentId;

                UPDATE core.records
                SET summary = @summary,
                    status_lookup_value_id = (
                        SELECT TOP (1) lv.id
                        FROM core.lookup_values lv
                        JOIN core.lookup_types lt ON lt.id = lv.lookup_type_id
                        WHERE lt.lookup_key = 'review_status' AND lv.value_key = @status
                    ),
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @recordId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                updateCommand.Parameters.AddWithValue("@assessmentId", assessmentId);
                updateCommand.Parameters.AddWithValue("@recordId", recordId);
                updateCommand.Parameters.AddWithValue("@submit", request.Submit);
                updateCommand.Parameters.AddWithValue("@status", request.Submit ? "submitted" : "draft");
                updateCommand.Parameters.AddWithValue("@summary", request.Submit ? "Submitted annual self-assessment" : "Draft annual self-assessment");
                updateCommand.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                await updateCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                recordId,
                "elevate_practice_assessment",
                assessmentId,
                request.Submit ? "elevate_practice.submitted" : "elevate_practice.draft_saved",
                request.Submit
                    ? $"Elevate Your Practice {academicYear} submitted and locked by {currentUser.DisplayName}."
                    : $"Elevate Your Practice {academicYear} draft saved by {currentUser.DisplayName}.",
                null,
                JsonSerializer.Serialize(new { academicYear, status = request.Submit ? "submitted" : "draft", ratingCount = ratings.Length }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }

        return await GetElevatePracticeWorkspaceAsync(staffId, academicYear, true, cancellationToken);
    }

    public Task<IReadOnlyList<ElevatePracticeProgressSummary>> GetElevatePracticeProgressAsync(
        string academicYear,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT s.id, s.external_id, s.display_name, s.email,
                   CASE WHEN team.org_unit_type = 'faculty' THEN team.code ELSE faculty.code END AS faculty_code,
                   CASE WHEN team.org_unit_type = 'faculty' THEN team.name ELSE faculty.name END AS faculty_name,
                   CASE WHEN team.org_unit_type = 'team' THEN team.code ELSE NULL END AS team_code,
                   CASE WHEN team.org_unit_type = 'team' THEN team.name ELSE NULL END AS team_name,
                   COALESCE(assessment.status, 'not_started') AS status,
                   assessment.updated_at, assessment.submitted_at
            FROM people.staff s
            LEFT JOIN org.org_units team ON team.id = s.primary_org_unit_id AND team.archived_at IS NULL
            LEFT JOIN org.org_units faculty ON faculty.id = team.parent_org_unit_id AND faculty.archived_at IS NULL
            LEFT JOIN quality.elevate_practice_assessments assessment
                ON assessment.staff_id = s.id AND assessment.academic_year = @academicYear
            WHERE s.account_status = 'active' AND s.archived_at IS NULL
            ORDER BY s.display_name;
            """,
            command => command.Parameters.AddWithValue("@academicYear", academicYear),
            reader => new ElevatePracticeProgressSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                GetStringOrNull(reader, 4),
                GetStringOrNull(reader, 5),
                GetStringOrNull(reader, 6),
                GetStringOrNull(reader, 7),
                academicYear,
                reader.GetString(8),
                GetDateTimeOffsetOrNull(reader, 9),
                GetDateTimeOffsetOrNull(reader, 10)),
            cancellationToken);

    private async Task<StaffElevatePracticeSummary?> GetElevatePracticeProfileSummaryAsync(
        Guid staffId,
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT TOP (1) assessment.id, assessment.academic_year, assessment.status,
                   CAST(AVG(CAST(rating.score AS decimal(10, 2))) AS decimal(10, 2)) AS overall_average,
                   assessment.submitted_at
            FROM quality.elevate_practice_assessments assessment
            LEFT JOIN quality.elevate_practice_ratings rating ON rating.assessment_id = assessment.id
            WHERE assessment.staff_id = @staffId
            GROUP BY assessment.id, assessment.academic_year, assessment.status, assessment.submitted_at
            ORDER BY assessment.academic_year DESC;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader => new StaffElevatePracticeSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetDecimal(3),
                GetDateTimeOffsetOrNull(reader, 4)),
            cancellationToken);
        return rows.FirstOrDefault();
    }

    private static void ValidateElevatePracticeSubmission(
        ElevatePracticeWorkspaceSummary current,
        IReadOnlyList<ElevatePracticeRatingRequest> ratings,
        IReadOnlyList<ElevatePracticeReflectionRequest> reflections,
        IReadOnlyList<string> strengths,
        IReadOnlyList<string> developments,
        IReadOnlyList<ElevatePracticePlanRequest> plans)
    {
        var statementCount = current.Areas.Sum(area => area.Statements.Count);
        if (ratings.Count != statementCount)
        {
            throw new WorkflowValidationException("Rate every self-assessment statement before submitting.");
        }

        var reflectionByArea = reflections.ToDictionary(value => value.AreaKey, StringComparer.OrdinalIgnoreCase);
        if (current.Areas.Any(area => !reflectionByArea.TryGetValue(area.AreaKey, out var value) || string.IsNullOrWhiteSpace(value.Text)))
        {
            throw new WorkflowValidationException("Add an evidence or reflection response for every practice area before submitting.");
        }

        if (strengths.Count != 3)
        {
            throw new WorkflowValidationException("Select exactly three strongest areas before submitting.");
        }

        if (developments.Count != 2)
        {
            throw new WorkflowValidationException("Select exactly two development areas before submitting.");
        }

        var planByArea = plans.ToDictionary(value => value.AreaKey, StringComparer.OrdinalIgnoreCase);
        if (planByArea.Count != 2 || developments.Any(key => !planByArea.ContainsKey(key)))
        {
            throw new WorkflowValidationException("Complete a development plan for each selected development area.");
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        foreach (var areaKey in developments)
        {
            var plan = planByArea[areaKey];
            if (string.IsNullOrWhiteSpace(plan.DevelopmentApproach)
                || string.IsNullOrWhiteSpace(plan.SuccessEvidence)
                || string.IsNullOrWhiteSpace(plan.IntendedImpact)
                || !plan.ReviewDate.HasValue)
            {
                throw new WorkflowValidationException("Every development plan needs an approach, success evidence, intended impact and review date.");
            }

            if (plan.ReviewDate.Value < today)
            {
                throw new WorkflowValidationException("Development plan review dates cannot be in the past.");
            }
        }
    }

    private static IReadOnlyList<string> NormalizeKeys(IEnumerable<string>? values) =>
        (values ?? [])
            .Select(value => value.Trim())
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

    private static IReadOnlyList<string> ParseJsonStringList(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(value) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private sealed record ElevatePracticeStaffRow(Guid Id, string DisplayName, string? FacultyName, string? TeamName);
    private sealed record ElevatePracticeAssessmentRow(Guid Id, Guid RecordId, Guid FrameworkId, string Status, DateTimeOffset? SubmittedAt);
    private sealed record ElevatePracticeSelectionRow(string AreaKey, string SelectionType);
    private sealed record ElevatePracticeDefinitionRow(
        Guid AreaId,
        string AreaKey,
        string Category,
        string AreaName,
        string ReflectionPrompt,
        int AreaOrder,
        Guid StatementId,
        string StatementKey,
        string StatementText,
        int StatementOrder,
        int? Score,
        string? Reflection);
}
