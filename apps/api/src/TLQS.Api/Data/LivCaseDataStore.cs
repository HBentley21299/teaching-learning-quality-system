using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<IReadOnlyList<LivCaseSummary>> GetLivCasesAsync(
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var canViewAll = currentUser.HasPermission(PermissionKeys.LivManage)
            || currentUser.HasPermission(PermissionKeys.ReportsViewAll);
        var canViewScoped = currentUser.HasPermission(PermissionKeys.LivSubmit);
        var canManage = currentUser.HasPermission(PermissionKeys.LivManage);
        var hasSensitivePermission = currentUser.HasPermission(PermissionKeys.LivSensitiveRead)
            || currentUser.HasPermission(PermissionKeys.UsersManage);
        var visibilityFilter = canViewAll
            ? string.Empty
            : """
                AND (
                    liv.subject_staff_id = @currentStaffId
                    OR liv.reviewer_staff_id = @currentStaffId
                    OR (
                        @canViewScoped = 1
                        AND (
                            EXISTS (
                                SELECT 1 FROM org.fn_visible_staff(@currentUserAccountId) visible
                                WHERE visible.staff_id = liv.subject_staff_id
                            )
                            OR EXISTS (
                                SELECT 1 FROM org.fn_visible_org_units(@currentUserAccountId) visible
                                WHERE visible.org_unit_id = liv.org_unit_id
                            )
                        )
                    )
                )
              """;

        var cases = await QueryAsync(
            $"""
            SELECT
                liv.id, liv.record_id, liv.subject_staff_id, subject_staff.display_name,
                liv.reviewer_staff_id, reviewer_staff.display_name, liv.org_unit_id,
                org_unit.code, parent_org.code, liv.pre_conversation, liv.status,
                liv.current_stage, liv.visibility_status, liv.completion_date,
                liv.created_at, liv.updated_at,
                CASE
                    WHEN liv.status = 'in_progress'
                     AND (@canManage = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId)
                    THEN CAST(1 AS bit) ELSE CAST(0 AS bit)
                END AS can_edit,
                CASE
                    WHEN @hasSensitivePermission = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId
                    THEN CAST(1 AS bit) ELSE CAST(0 AS bit)
                END AS can_view_sensitive,
                CASE
                    WHEN @hasSensitivePermission = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId
                    THEN liv.is_elevate_practitioner ELSE NULL
                END AS is_elevate_practitioner,
                CASE
                    WHEN @hasSensitivePermission = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId
                    THEN liv.area_of_practice_keys_json ELSE NULL
                END AS area_of_practice_keys_json,
                CASE
                    WHEN @hasSensitivePermission = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId
                    THEN liv.area_of_practice_other ELSE NULL
                END AS area_of_practice_other
            FROM quality.liv_records liv
            JOIN people.staff subject_staff ON subject_staff.id = liv.subject_staff_id
            LEFT JOIN people.staff reviewer_staff ON reviewer_staff.id = liv.reviewer_staff_id
            LEFT JOIN org.org_units org_unit ON org_unit.id = liv.org_unit_id
            LEFT JOIN org.org_units parent_org ON parent_org.id = org_unit.parent_org_unit_id
            LEFT JOIN org.org_units subject_org ON subject_org.id = subject_staff.primary_org_unit_id
            WHERE liv.archived_at IS NULL
            {visibilityFilter}
            OPTION (LOOP JOIN);
            """,
            command =>
            {
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@canViewScoped", canViewScoped);
                command.Parameters.AddWithValue("@canManage", canManage);
                command.Parameters.AddWithValue("@hasSensitivePermission", hasSensitivePermission);
            },
            reader => new LivCaseSummary(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
                GetGuidOrNull(reader, 4), GetStringOrNull(reader, 5), GetGuidOrNull(reader, 6),
                GetStringOrNull(reader, 7), GetStringOrNull(reader, 8), GetStringOrNull(reader, 9),
                reader.GetString(10), GetStringOrNull(reader, 11) ?? "visit_1",
                GetStringOrNull(reader, 12) ?? "staff_visible", GetDateOnlyOrNull(reader, 13),
                reader.GetFieldValue<DateTimeOffset>(14), GetDateTimeOffsetOrNull(reader, 15),
                reader.GetBoolean(16), reader.GetBoolean(17),
                reader.IsDBNull(18) ? null : reader.GetBoolean(18),
                ParseLivStringList(GetStringOrNull(reader, 19)), GetStringOrNull(reader, 20), [], []),
            cancellationToken);

        if (cases.Count == 0)
        {
            return cases;
        }

        var visibleCaseIds = cases.Select(liv => liv.Id).ToHashSet();
        var selectedThemes = await QueryAsync(
            """
            SELECT selection.liv_record_id, selection.theme_id
            FROM quality.liv_record_themes selection
            JOIN core.themes theme ON theme.id = selection.theme_id
            WHERE theme.archived_at IS NULL;
            """,
            null,
            reader => new LivThemeSelectionRow(reader.GetGuid(0), reader.GetGuid(1)),
            cancellationToken);
        var visits = await QueryAsync(
            """
            SELECT
                visit.liv_record_id, visit.id, visit.visit_number, visit.visit_date,
                CONVERT(nvarchar(5), visit.visit_time, 108), visit.visit_type,
                visit.course_name, visit.course_group, visit.course_level,
                visit.reflection_notes, visit.findings, visit.visit_status,
                visit.created_at, visit.updated_at
            FROM quality.liv_visits visit
            WHERE visit.archived_at IS NULL;
            """,
            null,
            reader => new LivVisitRow(
                reader.GetGuid(0),
                new LivVisitSummary(
                    reader.GetGuid(1), reader.GetInt32(2), GetDateOnlyOrNull(reader, 3),
                    GetStringOrNull(reader, 4), reader.GetString(5), GetStringOrNull(reader, 6),
                    GetStringOrNull(reader, 7), GetStringOrNull(reader, 8), GetStringOrNull(reader, 9),
                    GetStringOrNull(reader, 10), reader.GetString(11),
                    reader.GetFieldValue<DateTimeOffset>(12), GetDateTimeOffsetOrNull(reader, 13))),
            cancellationToken);

        var visitsByCase = visits
            .Where(row => visibleCaseIds.Contains(row.LivRecordId))
            .GroupBy(row => row.LivRecordId)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyList<LivVisitSummary>)group
                    .OrderBy(row => row.Visit.VisitNumber)
                    .Select(row => row.Visit)
                    .ToArray());

        return cases
            .OrderByDescending(liv => liv.UpdatedAt ?? liv.CreatedAt)
            .Select(liv => liv with
            {
                AreaOfPracticeThemeIds = liv.CanViewSensitive
                    ? selectedThemes.Where(selection => selection.LivRecordId == liv.Id).Select(selection => selection.ThemeId).ToArray()
                    : [],
                Visits = visitsByCase.GetValueOrDefault(liv.Id, [])
            })
            .ToArray();
    }

    public async Task<Guid> CreateLivCaseAsync(
        SaveLivCaseRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var initialVisit = request.InitialVisit ?? new SaveLivVisitRequest(
            null, null, null, null, null, null, null);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var moduleId = await GetModuleIdAsync(connection, transaction, "liv", cancellationToken);
            var recordId = Guid.NewGuid();
            var livId = Guid.NewGuid();
            var visitId = Guid.NewGuid();

            await using (var command = new SqlCommand(
                """
                INSERT INTO core.records (
                    id, module_id, record_type, title, subject_staff_id, owner_staff_id,
                    org_unit_id, record_date, created_by_user_account_id)
                SELECT @recordId, @moduleId, 'liv', 'LIV - ' + s.display_name, @subjectStaffId,
                    @ownerStaffId, COALESCE(@orgUnitId, s.primary_org_unit_id), @recordDate, @createdBy
                FROM people.staff s
                WHERE s.id = @subjectStaffId AND s.archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@recordId", recordId);
                command.Parameters.AddWithValue("@moduleId", moduleId);
                command.Parameters.AddWithValue("@subjectStaffId", request.SubjectStaffId);
                command.Parameters.AddWithValue("@ownerStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@orgUnitId", ToDbValue(request.OrgUnitId));
                command.Parameters.AddWithValue("@recordDate", ToDbValue(initialVisit.VisitDate));
                command.Parameters.AddWithValue("@createdBy", ToDbValue(currentUser.UserAccountId));
                if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
                {
                    throw new WorkflowValidationException("The selected staff member was not found.");
                }
            }

            await using (var command = new SqlCommand(
                """
                INSERT INTO quality.liv_records (
                    id, record_id, subject_staff_id, reviewer_staff_id, org_unit_id,
                    pre_conversation, status, current_stage, visibility_status,
                    is_elevate_practitioner, area_of_practice_keys_json, area_of_practice_other,
                    course_seen, liv_date, liv_time, liv_overview, post_conversation,
                    created_by_user_account_id)
                SELECT @id, @recordId, @subjectStaffId, @reviewerStaffId,
                    COALESCE(@orgUnitId, s.primary_org_unit_id), @preConversation,
                    'in_progress', 'visit_1', 'staff_visible', @isElevatePractitioner,
                    @areaKeysJson, @areaOther, @courseName, @visitDate, @visitTime,
                    @reflectionNotes, @findings, @createdBy
                FROM people.staff s
                WHERE s.id = @subjectStaffId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                AddLivCaseParameters(command, livId, recordId, request, currentUser);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await SaveLivThemeSelectionsAsync(connection, transaction, livId, request, cancellationToken);
            await InsertLivVisitAsync(connection, transaction, visitId, livId, 1, "initial", initialVisit, currentUser, cancellationToken);

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, recordId,
                "liv_record", livId, "liv.created",
                $"LIV case created in progress by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(request), cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return livId;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> UpdateLivCaseAsync(
        Guid livId,
        SaveLivCaseRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var initialVisit = request.InitialVisit ?? new SaveLivVisitRequest(
            null, null, null, null, null, null, null);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var metadata = await GetLivCaseMetadataAsync(connection, transaction, livId, cancellationToken);
            if (metadata is null)
            {
                return FormSubmissionUpdateResult.NotFound;
            }
            if (!CanEditLivCase(metadata, currentUser))
            {
                return FormSubmissionUpdateResult.Forbidden;
            }
            var canWriteSensitive = CanViewLivSensitive(metadata, currentUser);

            await using (var command = new SqlCommand(
                """
                UPDATE quality.liv_records
                SET org_unit_id = @orgUnitId,
                    pre_conversation = @preConversation,
                    is_elevate_practitioner = CASE WHEN @canWriteSensitive = 1 THEN @isElevatePractitioner ELSE is_elevate_practitioner END,
                    area_of_practice_keys_json = CASE WHEN @canWriteSensitive = 1 THEN @areaKeysJson ELSE area_of_practice_keys_json END,
                    area_of_practice_other = CASE WHEN @canWriteSensitive = 1 THEN @areaOther ELSE area_of_practice_other END,
                    course_seen = @courseName, liv_date = @visitDate, liv_time = @visitTime,
                    liv_overview = @reflectionNotes, post_conversation = @findings,
                    updated_by_user_account_id = @updatedBy, updated_at = sysutcdatetime()
                WHERE id = @id;

                UPDATE quality.liv_visits
                SET visit_date = @visitDate, visit_time = @visitTime,
                    course_name = @courseName, course_group = @courseGroup,
                    course_level = @courseLevel, reflection_notes = @reflectionNotes,
                    findings = @findings, updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                WHERE liv_record_id = @id AND visit_number = 1 AND archived_at IS NULL;

                UPDATE core.records
                SET org_unit_id = @orgUnitId, record_date = @visitDate,
                    updated_by_user_account_id = @updatedBy, updated_at = sysutcdatetime()
                WHERE id = @recordId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", livId);
                command.Parameters.AddWithValue("@recordId", metadata.RecordId);
                command.Parameters.AddWithValue("@orgUnitId", ToDbValue(request.OrgUnitId));
                command.Parameters.AddWithValue("@preConversation", ToDbValue(request.PreConversation));
                command.Parameters.AddWithValue("@canWriteSensitive", canWriteSensitive);
                command.Parameters.AddWithValue("@isElevatePractitioner", ToDbValue(request.IsElevatePractitioner));
                command.Parameters.AddWithValue("@areaKeysJson", ToDbValue(SerializeLivStringList(request.AreaOfPracticeKeys)));
                command.Parameters.AddWithValue("@areaOther", ToDbValue(request.AreaOfPracticeOther));
                command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                AddLivVisitParameters(command, initialVisit);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            if (canWriteSensitive)
            {
                await SaveLivThemeSelectionsAsync(connection, transaction, livId, request, cancellationToken);
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, metadata.RecordId,
                "liv_record", livId, "liv.updated", $"LIV case updated by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(request), cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<LivVisitCreatedSummary?> AddLivVisitAsync(
        Guid livId,
        SaveLivVisitRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);

        try
        {
            var metadata = await GetLivCaseMetadataAsync(connection, transaction, livId, cancellationToken);
            if (metadata is null || !CanEditLivCase(metadata, currentUser))
            {
                return null;
            }

            int visitNumber;
            await using (var numberCommand = new SqlCommand(
                "SELECT COALESCE(MAX(visit_number), 0) + 1 FROM quality.liv_visits WITH (UPDLOCK, HOLDLOCK) WHERE liv_record_id = @livId;",
                connection,
                (SqlTransaction)transaction))
            {
                numberCommand.Parameters.AddWithValue("@livId", livId);
                visitNumber = Convert.ToInt32(await numberCommand.ExecuteScalarAsync(cancellationToken));
            }

            var visitId = Guid.NewGuid();
            await InsertLivVisitAsync(connection, transaction, visitId, livId, visitNumber, "follow_up", request, currentUser, cancellationToken);

            await using (var command = new SqlCommand(
                """
                UPDATE quality.liv_records
                SET current_stage = @currentStage,
                    updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                WHERE id = @id;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", livId);
                command.Parameters.AddWithValue("@currentStage", $"visit_{visitNumber}");
                command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, metadata.RecordId,
                "liv_visit", visitId, "liv.visit_added", $"Visit {visitNumber} added by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(request), cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return new LivVisitCreatedSummary(visitId, visitNumber);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> UpdateLivVisitAsync(
        Guid livId,
        Guid visitId,
        SaveLivVisitRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var metadata = await GetLivCaseMetadataAsync(connection, transaction, livId, cancellationToken);
            if (metadata is null)
            {
                return FormSubmissionUpdateResult.NotFound;
            }
            if (!CanEditLivCase(metadata, currentUser))
            {
                return FormSubmissionUpdateResult.Forbidden;
            }

            int visitNumber;
            await using (var command = new SqlCommand(
                """
                UPDATE quality.liv_visits
                SET visit_date = @visitDate, visit_time = @visitTime,
                    course_name = @courseName, course_group = @courseGroup,
                    course_level = @courseLevel, reflection_notes = @reflectionNotes,
                    findings = @findings, updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                OUTPUT inserted.visit_number
                WHERE id = @visitId AND liv_record_id = @livId AND archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@visitId", visitId);
                command.Parameters.AddWithValue("@livId", livId);
                command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                AddLivVisitParameters(command, request);
                var result = await command.ExecuteScalarAsync(cancellationToken);
                if (result is null)
                {
                    return FormSubmissionUpdateResult.NotFound;
                }
                visitNumber = Convert.ToInt32(result);
            }

            if (visitNumber == 1)
            {
                await using var syncCommand = new SqlCommand(
                    """
                    UPDATE quality.liv_records
                    SET course_seen = @courseName, liv_date = @visitDate, liv_time = @visitTime,
                        liv_overview = @reflectionNotes, post_conversation = @findings,
                        updated_by_user_account_id = @updatedBy, updated_at = sysutcdatetime()
                    WHERE id = @livId;

                    UPDATE core.records
                    SET record_date = @visitDate, updated_by_user_account_id = @updatedBy,
                        updated_at = sysutcdatetime()
                    WHERE id = @recordId;
                    """,
                    connection,
                    (SqlTransaction)transaction);
                syncCommand.Parameters.AddWithValue("@livId", livId);
                syncCommand.Parameters.AddWithValue("@recordId", metadata.RecordId);
                syncCommand.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                AddLivVisitParameters(syncCommand, request);
                await syncCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, metadata.RecordId,
                "liv_visit", visitId, "liv.visit_updated", $"Visit {visitNumber} updated by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(request), cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> ChangeLivCaseStatusAsync(
        Guid livId,
        string action,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var metadata = await GetLivCaseMetadataAsync(connection, transaction, livId, cancellationToken);
            if (metadata is null)
            {
                return FormSubmissionUpdateResult.NotFound;
            }

            var canManage = currentUser.HasPermission(PermissionKeys.LivManage);
            var isCreator = metadata.ReviewerStaffId == currentUser.StaffId
                || metadata.CreatedByUserAccountId == currentUser.UserAccountId;
            var allowed = action switch
            {
                "close" => canManage || isCreator,
                "reopen" => canManage,
                "archive" => canManage,
                _ => false
            };
            if (!allowed)
            {
                return FormSubmissionUpdateResult.Forbidden;
            }

            var status = action == "reopen" ? "in_progress" : "closed";
            await using (var command = new SqlCommand(
                """
                UPDATE quality.liv_records
                SET status = @status,
                    current_stage = CASE WHEN @action = 'close' THEN 'completed' ELSE current_stage END,
                    completion_date = CASE WHEN @action = 'close' THEN CAST(sysutcdatetime() AS date) WHEN @action = 'reopen' THEN NULL ELSE completion_date END,
                    archived_at = CASE WHEN @action = 'archive' THEN sysutcdatetime() ELSE archived_at END,
                    updated_by_user_account_id = @updatedBy, updated_at = sysutcdatetime()
                WHERE id = @id;

                UPDATE quality.liv_visits
                SET visit_status = CASE WHEN @action = 'close' THEN 'completed' ELSE visit_status END,
                    updated_by_user_account_id = @updatedBy, updated_at = sysutcdatetime()
                WHERE liv_record_id = @id AND archived_at IS NULL;

                UPDATE core.records
                SET archived_at = CASE WHEN @action = 'archive' THEN sysutcdatetime() ELSE archived_at END,
                    updated_by_user_account_id = @updatedBy, updated_at = sysutcdatetime()
                WHERE id = @recordId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", livId);
                command.Parameters.AddWithValue("@recordId", metadata.RecordId);
                command.Parameters.AddWithValue("@action", action);
                command.Parameters.AddWithValue("@status", status);
                command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, metadata.RecordId,
                "liv_record", livId, $"liv.{action}", $"LIV case {action}d by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(new { action, status }), cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static bool CanEditLivCase(LivCaseMetadata metadata, CurrentUser currentUser) =>
        LivAccessPolicy.CanEdit(
            metadata.Status,
            metadata.ReviewerStaffId == currentUser.StaffId
                || metadata.CreatedByUserAccountId == currentUser.UserAccountId,
            currentUser.HasPermission(PermissionKeys.LivManage));

    private static bool CanViewLivSensitive(LivCaseMetadata metadata, CurrentUser currentUser) =>
        LivAccessPolicy.CanViewSensitive(
            metadata.ReviewerStaffId == currentUser.StaffId
                || metadata.CreatedByUserAccountId == currentUser.UserAccountId,
            currentUser.HasPermission(PermissionKeys.UsersManage),
            currentUser.HasPermission(PermissionKeys.LivSensitiveRead));

    private static async Task<LivCaseMetadata?> GetLivCaseMetadataAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid livId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            "SELECT record_id, reviewer_staff_id, created_by_user_account_id, status FROM quality.liv_records WHERE id = @id AND archived_at IS NULL;",
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@id", livId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new LivCaseMetadata(reader.GetGuid(0), GetGuidOrNull(reader, 1), GetGuidOrNull(reader, 2), reader.GetString(3))
            : null;
    }

    private static async Task InsertLivVisitAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid visitId,
        Guid livId,
        int visitNumber,
        string visitType,
        SaveLivVisitRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            INSERT INTO quality.liv_visits (
                id, liv_record_id, visit_number, visit_date, visit_time, visit_type,
                course_name, course_group, course_level, reflection_notes, findings,
                visit_status, created_by_user_account_id)
            VALUES (
                @id, @livId, @visitNumber, @visitDate, @visitTime, @visitType,
                @courseName, @courseGroup, @courseLevel, @reflectionNotes, @findings,
                'in_progress', @createdBy);
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@id", visitId);
        command.Parameters.AddWithValue("@livId", livId);
        command.Parameters.AddWithValue("@visitNumber", visitNumber);
        command.Parameters.AddWithValue("@visitType", visitType);
        command.Parameters.AddWithValue("@createdBy", ToDbValue(currentUser.UserAccountId));
        AddLivVisitParameters(command, request);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task SaveLivThemeSelectionsAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid livId,
        SaveLivCaseRequest request,
        CancellationToken cancellationToken)
    {
        var requestedIds = (request.AreaOfPracticeThemeIds ?? [])
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
        var requestedKeys = (request.AreaOfPracticeKeys ?? [])
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .Select(key => key.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var useIds = requestedIds.Length > 0;

        var selected = new List<LivThemeOptionRow>();
        if (useIds || requestedKeys.Length > 0)
        {
            await using var select = new SqlCommand(
                """
                SELECT theme.id, theme.theme_key, theme.name, theme_group.name,
                       application.display_order, theme.is_other
                FROM core.themes theme
                JOIN core.theme_groups theme_group ON theme_group.id = theme.theme_group_id
                JOIN core.theme_applications application ON application.theme_id = theme.id
                    AND application.application_key = N'liv'
                    AND application.is_active = 1
                WHERE theme.archived_at IS NULL
                  AND theme_group.archived_at IS NULL
                  AND (
                        (theme.is_active = 1 AND theme_group.is_active = 1)
                        OR EXISTS (
                            SELECT 1
                            FROM quality.liv_record_themes existing
                            WHERE existing.liv_record_id = @livId
                              AND existing.theme_id = theme.id
                        )
                  )
                  AND (
                        (@useIds = 1 AND theme.id IN (
                            SELECT id FROM OPENJSON(@idsJson) WITH (id uniqueidentifier '$')
                        ))
                        OR (@useIds = 0 AND theme.theme_key IN (
                            SELECT theme_key FROM OPENJSON(@keysJson) WITH (theme_key nvarchar(150) '$')
                        ))
                  )
                ORDER BY theme_group.display_order, application.display_order, theme.name;
                """,
                connection,
                (SqlTransaction)transaction);
            select.Parameters.AddWithValue("@useIds", useIds);
            select.Parameters.AddWithValue("@livId", livId);
            select.Parameters.AddWithValue("@idsJson", JsonSerializer.Serialize(requestedIds));
            select.Parameters.AddWithValue("@keysJson", JsonSerializer.Serialize(requestedKeys));
            await using var reader = await select.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                selected.Add(new LivThemeOptionRow(
                    reader.GetGuid(0), reader.GetString(1), reader.GetString(2),
                    reader.GetString(3), reader.GetInt32(4), reader.GetBoolean(5)));
            }
        }

        var requestedCount = useIds ? requestedIds.Length : requestedKeys.Length;
        if (selected.Count != requestedCount)
        {
            throw new WorkflowValidationException("One or more selected LIV themes are no longer available.");
        }
        if (selected.Any(theme => theme.IsOther) && string.IsNullOrWhiteSpace(request.AreaOfPracticeOther))
        {
            throw new WorkflowValidationException("Describe the area of practice when Other is selected.");
        }

        await using var command = new SqlCommand(
            """
            DELETE FROM quality.liv_record_themes WHERE liv_record_id = @livId;

            INSERT INTO quality.liv_record_themes (
                liv_record_id, theme_id, theme_name_snapshot,
                group_name_snapshot, display_order_snapshot
            )
            SELECT @livId, theme.id, theme.name, theme_group.name, application.display_order
            FROM core.themes theme
            JOIN core.theme_groups theme_group ON theme_group.id = theme.theme_group_id
            JOIN core.theme_applications application ON application.theme_id = theme.id
                AND application.application_key = N'liv'
            WHERE theme.id IN (
                SELECT id FROM OPENJSON(@selectedIdsJson) WITH (id uniqueidentifier '$')
            );

            UPDATE quality.liv_records
            SET area_of_practice_keys_json = @keysJson
            WHERE id = @livId;
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@livId", livId);
        command.Parameters.AddWithValue("@selectedIdsJson", JsonSerializer.Serialize(selected.Select(theme => theme.Id)));
        command.Parameters.AddWithValue("@keysJson", ToDbValue(SerializeLivStringList(selected.Select(theme => theme.ThemeKey).ToArray())));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static void AddLivCaseParameters(
        SqlCommand command,
        Guid livId,
        Guid recordId,
        SaveLivCaseRequest request,
        CurrentUser currentUser)
    {
        command.Parameters.AddWithValue("@id", livId);
        command.Parameters.AddWithValue("@recordId", recordId);
        command.Parameters.AddWithValue("@subjectStaffId", request.SubjectStaffId);
        command.Parameters.AddWithValue("@reviewerStaffId", ToDbValue(currentUser.StaffId));
        command.Parameters.AddWithValue("@orgUnitId", ToDbValue(request.OrgUnitId));
        command.Parameters.AddWithValue("@preConversation", ToDbValue(request.PreConversation));
        command.Parameters.AddWithValue("@isElevatePractitioner", ToDbValue(request.IsElevatePractitioner));
        command.Parameters.AddWithValue("@areaKeysJson", ToDbValue(SerializeLivStringList(request.AreaOfPracticeKeys)));
        command.Parameters.AddWithValue("@areaOther", ToDbValue(request.AreaOfPracticeOther));
        command.Parameters.AddWithValue("@createdBy", ToDbValue(currentUser.UserAccountId));
        AddLivVisitParameters(
            command,
            request.InitialVisit ?? new SaveLivVisitRequest(null, null, null, null, null, null, null));
    }

    private static void AddLivVisitParameters(SqlCommand command, SaveLivVisitRequest request)
    {
        command.Parameters.AddWithValue("@visitDate", ToDbValue(request.VisitDate));
        command.Parameters.AddWithValue("@visitTime", ToDbValue(request.VisitTime));
        command.Parameters.AddWithValue("@courseName", ToDbValue(request.CourseName));
        command.Parameters.AddWithValue("@courseGroup", ToDbValue(request.CourseGroup));
        command.Parameters.AddWithValue("@courseLevel", ToDbValue(request.CourseLevel));
        command.Parameters.AddWithValue("@reflectionNotes", ToDbValue(request.ReflectionNotes));
        command.Parameters.AddWithValue("@findings", ToDbValue(request.Findings));
    }

    private static string? SerializeLivStringList(IReadOnlyList<string>? values)
    {
        var normalized = values?
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray() ?? [];
        return normalized.Length == 0 ? null : JsonSerializer.Serialize(normalized);
    }

    private static IReadOnlyList<string> ParseLivStringList(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private sealed record LivCaseMetadata(
        Guid RecordId,
        Guid? ReviewerStaffId,
        Guid? CreatedByUserAccountId,
        string Status);

    private sealed record LivVisitRow(Guid LivRecordId, LivVisitSummary Visit);
    private sealed record LivThemeSelectionRow(Guid LivRecordId, Guid ThemeId);
    private sealed record LivThemeOptionRow(
        Guid Id,
        string ThemeKey,
        string Name,
        string GroupName,
        int DisplayOrder,
        bool IsOther);
}
