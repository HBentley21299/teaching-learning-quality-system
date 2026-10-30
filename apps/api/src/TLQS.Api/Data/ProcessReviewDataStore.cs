using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static readonly JsonSerializerOptions ProcessJson = new(JsonSerializerDefaults.Web);
    private const string ProcessScopeSql = """
        (EXISTS(SELECT 1 FROM org.fn_visible_org_units(@processUserId) scope
               WHERE scope.org_unit_id=COALESCE(p.team_org_unit_id,p.faculty_org_unit_id))
         OR (p.process_key=N'activate_growth_review' AND EXISTS(
            SELECT 1 FROM quality.process_review_scopes selected JOIN org.fn_visible_org_units(@processUserId) scope
            ON scope.org_unit_id=selected.org_unit_id WHERE selected.record_id=p.record_id)))
        """;
    private static readonly string ProcessReadSql = $"""
        (@processAll=1 OR r.owner_staff_id=@processStaffId OR (@processScoped=1 AND {ProcessScopeSql}))
        """;
    private sealed record ProcessRow(Guid RecordId, string ProcessKey, string Title, string AcademicYear,
        Guid? FacultyId, string? FacultyName, Guid? TeamId, string? TeamName, DateOnly? RecordDate,
        Guid OwnerId, string OwnerName, string Status, DateTimeOffset UpdatedAt, string RowVersion,
        ProcessReviewConfiguration Configuration, ProcessReviewData Data, int OpenActions, DateOnly? SnapshotAsOf, bool InScope,
        IReadOnlyList<ProcessReviewOrgScope>? SelectedSubTeams=null,IReadOnlyList<ProcessReviewParticipant>? Participants=null,ProcessReviewConfiguration? LegacyConfiguration=null,
        bool IsFollowUp=false,ProcessReviewLink? ParentReview=null,IReadOnlyList<ProcessReviewLink>? FollowUpReviews=null,
        ActivatePreviousReviewContext? ParentReviewContext=null,IReadOnlyList<Guid>? AncestorReviewIds=null);

    public async Task<ProcessReviewConfiguration> GetProcessReviewConfigurationAsync(string processKey, CancellationToken ct)
    {
        if (!ProcessReviewRules.IsProcess(processKey)) throw new WorkflowValidationException("Select a supported review process.");
        var rows = await QueryAsync("""
            SELECT TOP (1) configuration_json,version,row_version FROM quality.process_review_configurations
            WHERE process_key=@key ORDER BY version DESC;
            """, command => command.Parameters.AddWithValue("@key", processKey),
            reader => JsonSerializer.Deserialize<ProcessReviewConfiguration>(reader.GetString(0), ProcessJson)! with
            { Version = reader.GetInt32(1), RowVersion = Convert.ToBase64String((byte[])reader[2]) }, ct);
        return rows.FirstOrDefault() ?? ProcessReviewRules.DefaultConfiguration(processKey);
    }

    public async Task<ProcessReviewConfiguration> SaveProcessReviewConfigurationAsync(string processKey,
        ProcessReviewConfiguration request, CurrentUser user, CancellationToken ct)
    {
        if (!ProcessReviewRules.CanManageConfiguration(user)) throw new UnauthorizedAccessException("Form administration access is required.");
        if(processKey==ProcessReviewRules.Activate&&request.SkillsScanPillars is null)
            throw new WorkflowValidationException("Activate+ settings require the six Skills Scan pillars and five specialist action themes.");
        ProcessReviewRules.ValidateConfiguration(processKey, request);
        await using var connection = await OpenConnectionAsync(ct);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await using var current = new SqlCommand("""
            SELECT TOP (1) version,row_version FROM quality.process_review_configurations WITH(UPDLOCK,HOLDLOCK)
            WHERE process_key=@key ORDER BY version DESC;
            """, connection, transaction);
        current.Parameters.AddWithValue("@key", processKey);
        int version;
        await using (var reader = await current.ExecuteReaderAsync(ct))
        {
            if (await reader.ReadAsync(ct))
            {
                if (request.RowVersion != Convert.ToBase64String((byte[])reader[1])) throw new DBConcurrencyException("The settings changed. Reload before saving your new version.");
                version = reader.GetInt32(0) + 1;
            }
            else
            {
                if (!string.IsNullOrEmpty(request.RowVersion)) throw new DBConcurrencyException("The settings changed. Reload before saving.");
                version = ProcessReviewRules.DefaultConfiguration(processKey).Version+1;
            }
        }
        var saved = request with { ProcessKey = processKey, Version = version, RowVersion = null };
        await using var insert = new SqlCommand("""
            INSERT INTO quality.process_review_configurations(process_key,version,configuration_json,created_by_user_account_id)
            VALUES(@key,@version,@json,@user);
            """, connection, transaction);
        insert.Parameters.AddWithValue("@key", processKey); insert.Parameters.AddWithValue("@version", version);
        insert.Parameters.AddWithValue("@json", JsonSerializer.Serialize(saved, ProcessJson)); insert.Parameters.AddWithValue("@user", user.UserAccountId!.Value);
        await insert.ExecuteNonQueryAsync(ct);
        await WriteAuditAsync(connection, transaction, user.UserAccountId, null, "process_review_configuration", null,
            "process_review.configuration_published", $"{saved.Title} framework version {version} saved.", null, JsonSerializer.Serialize(saved, ProcessJson), ct);
        await transaction.CommitAsync(ct);
        return await GetProcessReviewConfigurationAsync(processKey, ct);
    }

    public async Task<IReadOnlyList<ProcessReviewSummary>> GetProcessReviewsAsync(string processKey, string? academicYear, CurrentUser user, CancellationToken ct)
    {
        var rows = await ReadProcessRowsAsync(processKey, academicYear, null, user, ct);
        return rows.Select(row => new ProcessReviewSummary(row.RecordId,row.ProcessKey,row.Title,row.AcademicYear,
            row.FacultyId,row.FacultyName,row.TeamId,row.TeamName,row.RecordDate,row.OwnerId,row.OwnerName,row.Status,
            row.UpdatedAt,row.RowVersion,row.Data.Samples.Count,row.Data.Responses.Count(x=>!string.IsNullOrEmpty(x.RatingKey)),
            row.Configuration.Standards.Sum(x=>x.Statements.Count),row.OpenActions,row.SnapshotAsOf,row.SelectedSubTeams,row.Participants,
            row.Data.Activate?.SkillsScanScores,row.Data.Activate?.FollowUpDate,row.Data.Activate?.AllSubTeams,
            row.IsFollowUp,row.ParentReview,row.FollowUpReviews)).ToArray();
    }

    private async Task<IReadOnlyList<ProcessRow>> ReadProcessRowsAsync(string? processKey, string? academicYear, Guid? recordId, CurrentUser user, CancellationToken ct,
        IReadOnlyCollection<Guid>? recordIds=null,bool includeFollowUps=true)
    {
        if (processKey is not null && !ProcessReviewRules.IsProcess(processKey)) throw new WorkflowValidationException("Select a supported review process.");
        if (!user.UserAccountId.HasValue || !user.StaffId.HasValue) return [];
        var rows=await QueryAsync($"""
            SELECT r.id,p.process_key,r.title,r.academic_year_key,p.faculty_org_unit_id,faculty.name,
                p.team_org_unit_id,team.name,r.record_date,r.owner_staff_id,owner.display_name,p.status,
                COALESCE(r.updated_at,r.created_at),p.row_version,p.configuration_json,p.data_json,
                (SELECT COUNT(*) FROM quality.actions a LEFT JOIN core.lookup_values status ON status.id=a.status_lookup_value_id
                    WHERE a.source_record_id=r.id AND a.archived_at IS NULL AND COALESCE(status.value_key,N'open') NOT IN (N'complete',N'cancelled')),
                (SELECT TOP(1) snapshot.as_of_date FROM quality.process_review_snapshots snapshot WHERE snapshot.record_id=r.id ORDER BY snapshot.recorded_at DESC),
                CONVERT(bit,CASE WHEN {ProcessScopeSql} THEN 1 ELSE 0 END),p.legacy_configuration_json
            FROM quality.process_reviews p JOIN core.records r ON r.id=p.record_id
            JOIN people.staff owner ON owner.id=r.owner_staff_id
            LEFT JOIN org.org_units faculty ON faculty.id=p.faculty_org_unit_id LEFT JOIN org.org_units team ON team.id=p.team_org_unit_id
            WHERE r.archived_at IS NULL AND (@key IS NULL OR p.process_key=@key) AND (@year IS NULL OR r.academic_year_key=@year)
              AND (@recordId IS NULL OR r.id=@recordId)
              AND (@recordIds IS NULL OR r.id IN(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@recordIds)))
              AND ((p.process_key=N'digital_learning_walk' AND (@digitalAll=1 OR r.owner_staff_id=@processStaffId OR (@digitalScoped=1 AND {ProcessScopeSql})))
                OR (p.process_key=N'activate_growth_review' AND (@activateAll=1 OR r.owner_staff_id=@processStaffId OR (@activateScoped=1 AND {ProcessScopeSql}))))
            ORDER BY COALESCE(r.record_date,CONVERT(date,r.created_at)) DESC,r.title;
            """, command =>
            {
                AddProcessParameters(command, user); command.Parameters.AddWithValue("@key",ToDbValue(processKey));
                command.Parameters.AddWithValue("@year",ToDbValue(string.IsNullOrWhiteSpace(academicYear)?null:academicYear)); command.Parameters.AddWithValue("@recordId",ToDbValue(recordId));
                command.Parameters.AddWithValue("@recordIds",recordIds is null?DBNull.Value:JsonSerializer.Serialize(recordIds));
            }, reader=>new ProcessRow(reader.GetGuid(0),reader.GetString(1),reader.GetString(2),reader.GetString(3),
                GetGuidOrNull(reader,4),GetStringOrNull(reader,5),GetGuidOrNull(reader,6),GetStringOrNull(reader,7),
                reader.IsDBNull(8)?null:DateOnly.FromDateTime(reader.GetDateTime(8)),reader.GetGuid(9),reader.GetString(10),reader.GetString(11),reader.GetFieldValue<DateTimeOffset>(12),
                Convert.ToBase64String((byte[])reader[13]),JsonSerializer.Deserialize<ProcessReviewConfiguration>(reader.GetString(14),ProcessJson)!,
                JsonSerializer.Deserialize<ProcessReviewData>(reader.GetString(15),ProcessJson)!,reader.GetInt32(16),
                reader.IsDBNull(17)?null:DateOnly.FromDateTime(reader.GetDateTime(17)),reader.GetBoolean(18),LegacyConfiguration:
                reader.IsDBNull(19)?null:JsonSerializer.Deserialize<ProcessReviewConfiguration>(reader.GetString(19),ProcessJson)),ct);
        rows=await HydrateActivateReviewRowsAsync(rows,ct);
        return includeFollowUps?await HydrateActivateFollowUpRowsAsync(rows,user,ct):rows;
    }

    public async Task<ProcessReviewDetail?> GetProcessReviewAsync(Guid recordId, CurrentUser user, CancellationToken ct)
    {
        var row = (await ReadProcessRowsAsync(null,null,recordId,user,ct)).SingleOrDefault();
        if (row is null) return null;
        var snapshots = await QueryAsync("""
            SELECT s.id,s.as_of_date,s.recorded_at,staff.display_name,s.source_meeting,s.teams_link,s.data_json
            FROM quality.process_review_snapshots s JOIN auth.user_accounts account ON account.id=s.recorded_by_user_account_id
            JOIN people.staff staff ON staff.id=account.staff_id WHERE s.record_id=@id ORDER BY s.recorded_at DESC;
            """, command=>command.Parameters.AddWithValue("@id",recordId),reader=>new ProcessReviewSnapshot(reader.GetGuid(0),DateOnly.FromDateTime(reader.GetDateTime(1)),
                reader.GetFieldValue<DateTimeOffset>(2),reader.GetString(3),reader.GetString(4),reader.GetString(5),JsonSerializer.Deserialize<ProcessReviewData>(reader.GetString(6),ProcessJson)!),ct);
        var actions = row.IsFollowUp
            ? await ReadActivateFollowUpActionsAsync(recordId,user,ct)
            : await ReadProcessActionsAsync(row.ProcessKey,null,recordId,null,user,true,ct);
        return new ProcessReviewDetail(row.RecordId,row.ProcessKey,row.Title,row.AcademicYear,row.FacultyId,row.FacultyName,row.TeamId,row.TeamName,
            row.RecordDate,row.OwnerId,row.OwnerName,row.Status,row.UpdatedAt,row.RowVersion,row.Configuration,row.Data,snapshots,actions,
            ProcessReviewRules.CanEdit(user,row.ProcessKey,row.OwnerId,row.InScope),row.SelectedSubTeams,row.Participants,row.LegacyConfiguration,
            row.IsFollowUp,row.ParentReview,row.FollowUpReviews,row.ParentReviewContext);
    }

    public async Task<ProcessReviewDetail> SaveProcessReviewAsync(string processKey, Guid? recordId, SaveProcessReviewRequest request, CurrentUser user, CancellationToken ct)
    {
        if(request.Data is null||request.Data.Fields is null||request.Data.Samples is null||request.Data.Responses is null)
            throw new WorkflowValidationException("Provide the saved form fields, samples and responses.");
        if (!ProcessReviewRules.IsProcess(processKey) || !ProcessReviewRules.CanCreate(user, processKey) && !recordId.HasValue)
            throw new UnauthorizedAccessException("You do not have permission to create this review.");
        var existing = recordId.HasValue ? await GetProcessReviewAsync(recordId.Value,user,ct) : null;
        if (recordId.HasValue && (existing is null || !existing.CanEdit || existing.ProcessKey!=processKey)) throw new UnauthorizedAccessException("You cannot edit this review.");
        if(existing?.IsFollowUp==true)ValidateActivateFollowUpScope(request,existing);
        var configuration = existing?.Configuration ?? await GetProcessReviewConfigurationAsync(processKey,ct);
        if(existing is null&&processKey==ProcessReviewRules.Activate&&configuration.SkillsScanPillars is not null&&request.Data.Activate is null)
            throw new WorkflowValidationException("Use the updated Activate+ review form with Skills Scan averages and meeting participants.");
        var upgrading=processKey==ProcessReviewRules.Activate&&request.Data.Activate is not null&&configuration.SkillsScanPillars is null;
        if(upgrading)configuration=await GetProcessReviewConfigurationAsync(processKey,ct);
        IReadOnlyList<ProcessReviewOrgScope> activateScopes=[];IReadOnlyList<ProcessReviewParticipant> activateParticipants=[];
        if(processKey==ProcessReviewRules.Activate&&request.Data.Activate is not null)
        {
            ProcessReviewRules.ValidateSave(request,configuration);
            var normalized=await NormalizeActivateReviewAsync(request,existing,user,ct);
            request=normalized.Request;activateScopes=normalized.Scopes;activateParticipants=normalized.Participants;
            if((request.Submit||existing?.Status=="submitted")&&activateScopes.Count==0)
                throw new WorkflowValidationException("Select at least one active sub-team within the review area before recording the review.");
        }
        if (existing?.Status == "draft")
        {
            var latest = await GetProcessReviewConfigurationAsync(processKey,ct);
            if (ProcessReviewRules.CanRefreshUnratedDraft(configuration,latest,request.Data)) configuration=latest;
        }
        ProcessReviewRules.ValidateSave(existing?.Status=="submitted" && (processKey==ProcessReviewRules.Digital||request.Data.Activate is not null)
            ? request with {Submit=true}:request,configuration);
        if (existing is not null && request.RowVersion!=existing.RowVersion) throw new DBConcurrencyException("This review changed. Reload it before saving; your unsaved changes remain in the form.");
        await using var connection=await OpenConnectionAsync(ct);
        await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        if(request.Data.Activate is null)await ValidateProcessOrganisationAsync(connection,transaction,request.FacultyOrgUnitId,request.TeamOrgUnitId,user,ct);
        await ValidateProcessSampleStaffAsync(connection,transaction,request.Data.Samples,user,ct);
        var participants=request.Data.Activate is null?ProcessReviewRules.ParticipantStaffIds(request.Data):[];
        if(participants.Count>0)await ValidateProcessSampleStaffAsync(connection,transaction,
            [new ProcessReviewSample("participants","Review participants","staff",null,null,participants,null,null)],user,ct);
        var id=recordId??Guid.NewGuid();
        var title=string.IsNullOrWhiteSpace(request.Title)?$"{configuration.Title} · {request.AcademicYear} draft":request.Title.Trim();
        if (existing is null)
        {
            await using var insert=new SqlCommand("""
                INSERT INTO core.records(id,module_id,record_type,title,owner_staff_id,org_unit_id,record_date,created_by_user_account_id,academic_year_key)
                SELECT @id,module.id,@key,@title,@owner,COALESCE(@team,@faculty),@date,@user,@year
                FROM core.modules module WHERE module.module_key=@key AND module.is_enabled=1;
                IF @@ROWCOUNT=0 THROW 51000,'This review process is not installed or is disabled.',1;
                INSERT INTO quality.process_reviews(record_id,process_key,configuration_json,data_json,faculty_org_unit_id,team_org_unit_id,status)
                VALUES(@id,@key,@configuration,@data,@faculty,@team,@status);
                """,connection,transaction);
            AddProcessSaveParameters(insert,id,processKey,title,request,user,configuration,request.Submit?"submitted":"draft");
            await insert.ExecuteNonQueryAsync(ct);
        }
        else
        {
            await using var update=new SqlCommand("""
                UPDATE quality.process_reviews SET configuration_json=@configuration,data_json=@data,faculty_org_unit_id=@faculty,team_org_unit_id=@team,
                    status=CASE WHEN status=N'submitted' OR @status=N'submitted' THEN N'submitted' ELSE N'draft' END
                WHERE record_id=@id AND row_version=@version;
                IF @@ROWCOUNT=0 THROW 51001,'This review changed. Reload before saving.',1;
                UPDATE core.records SET title=@title,org_unit_id=COALESCE(@team,@faculty),record_date=@date,academic_year_key=@year,
                    updated_at=sysutcdatetime(),updated_by_user_account_id=@user WHERE id=@id AND archived_at IS NULL;
                """,connection,transaction);
            AddProcessSaveParameters(update,id,processKey,title,request,user,configuration,request.Submit?"submitted":"draft");
            update.Parameters.Add("@version",SqlDbType.Binary,8).Value=Convert.FromBase64String(existing.RowVersion);
            try { await update.ExecuteNonQueryAsync(ct); } catch(SqlException exception) when(exception.Number==51001) { throw new DBConcurrencyException(exception.Message,exception); }
        }
        if(request.Data.Activate is not null)
            await SaveActivateReviewContextAsync(connection,transaction,id,activateScopes,activateParticipants,ct);
        if(upgrading)
        {
            await using var legacy=new SqlCommand("UPDATE quality.process_reviews SET legacy_configuration_json=COALESCE(legacy_configuration_json,@legacy) WHERE record_id=@id;",connection,transaction);
            legacy.Parameters.AddWithValue("@id",id);legacy.Parameters.AddWithValue("@legacy",JsonSerializer.Serialize(existing!.Configuration,ProcessJson));await legacy.ExecuteNonQueryAsync(ct);
        }
        if (processKey==ProcessReviewRules.Activate && request.Data.Activate is null && request.Submit)
        {
            await using var snapshot=new SqlCommand("""
                INSERT INTO quality.process_review_snapshots(record_id,as_of_date,source_meeting,teams_link,data_json,recorded_by_user_account_id)
                VALUES(@id,@asOf,@meeting,@link,@data,@user);
                """,connection,transaction);
            snapshot.Parameters.AddWithValue("@id",id);snapshot.Parameters.AddWithValue("@asOf",DateOnly.Parse(request.Data.Fields["snapshotDate"]).ToDateTime(TimeOnly.MinValue));
            snapshot.Parameters.AddWithValue("@meeting",request.Data.Fields["sourceMeeting"]);snapshot.Parameters.AddWithValue("@link",request.Data.Fields["teamsUrl"]);
            snapshot.Parameters.AddWithValue("@data",JsonSerializer.Serialize(request.Data,ProcessJson));snapshot.Parameters.AddWithValue("@user",user.UserAccountId!.Value);
            await snapshot.ExecuteNonQueryAsync(ct);
        }
        await WriteAuditAsync(connection,transaction,user.UserAccountId,id,"process_review",id,request.Submit?"process_review.submitted":"process_review.saved",
            $"{title} {(request.Submit?"recorded":"saved")} by {user.DisplayName}.",null,null,ct);
        await transaction.CommitAsync(ct);
        return await GetProcessReviewAsync(id,user,ct) ?? throw new InvalidOperationException("The saved review could not be read.");
    }

    private static void AddProcessSaveParameters(SqlCommand command,Guid id,string key,string title,SaveProcessReviewRequest request,
        CurrentUser user,ProcessReviewConfiguration configuration,string status)
    {
        command.Parameters.AddWithValue("@id",id);command.Parameters.AddWithValue("@key",key);command.Parameters.AddWithValue("@title",title);
        command.Parameters.AddWithValue("@owner",ToDbValue(user.StaffId));command.Parameters.AddWithValue("@faculty",ToDbValue(request.FacultyOrgUnitId));
        command.Parameters.AddWithValue("@team",ToDbValue(request.TeamOrgUnitId));command.Parameters.AddWithValue("@date",ToDbValue(request.RecordDate));
        command.Parameters.AddWithValue("@user",ToDbValue(user.UserAccountId));command.Parameters.AddWithValue("@year",request.AcademicYear);command.Parameters.AddWithValue("@status",status);
        command.Parameters.AddWithValue("@configuration",JsonSerializer.Serialize(configuration,ProcessJson));command.Parameters.AddWithValue("@data",JsonSerializer.Serialize(request.Data,ProcessJson));
    }

    private static void AddProcessParameters(SqlCommand command,CurrentUser user)
    {
        command.Parameters.AddWithValue("@processUserId",ToDbValue(user.UserAccountId));command.Parameters.AddWithValue("@processStaffId",ToDbValue(user.StaffId));
        command.Parameters.AddWithValue("@digitalAll",ProcessReviewRules.CanViewAll(user,ProcessReviewRules.Digital));
        command.Parameters.AddWithValue("@digitalScoped",ProcessReviewRules.CanViewScoped(user,ProcessReviewRules.Digital));
        command.Parameters.AddWithValue("@activateAll",ProcessReviewRules.CanViewAll(user,ProcessReviewRules.Activate));
        command.Parameters.AddWithValue("@activateScoped",ProcessReviewRules.CanViewScoped(user,ProcessReviewRules.Activate));
    }

    private static async Task ValidateProcessOrganisationAsync(SqlConnection connection,SqlTransaction transaction,Guid? faculty,Guid? team,CurrentUser user,CancellationToken ct)
    {
        if (!faculty.HasValue && !team.HasValue) return;
        if (!faculty.HasValue) throw new WorkflowValidationException("Select the faculty before selecting a team.");
        await using var command=new SqlCommand("""
            WITH descendants AS (
                SELECT id,parent_org_unit_id FROM org.org_units WHERE id=@faculty AND org_unit_type=N'faculty' AND is_active=1 AND archived_at IS NULL
                UNION ALL SELECT child.id,child.parent_org_unit_id FROM org.org_units child JOIN descendants parent ON child.parent_org_unit_id=parent.id
                    WHERE child.is_active=1 AND child.archived_at IS NULL
            )
            SELECT CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM descendants WHERE id=@faculty)
                AND (@team IS NULL OR EXISTS(SELECT 1 FROM descendants WHERE id=@team AND id<>@faculty))
                AND (@all=1 OR EXISTS(SELECT 1 FROM org.fn_visible_org_units(@user) scope WHERE scope.org_unit_id=COALESCE(@team,@faculty))) THEN 1 ELSE 0 END)
            OPTION(MAXRECURSION 100);
            """,connection,transaction);
        command.Parameters.AddWithValue("@faculty",faculty.Value);command.Parameters.AddWithValue("@team",ToDbValue(team));command.Parameters.AddWithValue("@user",ToDbValue(user.UserAccountId));
        command.Parameters.AddWithValue("@all",ProcessReviewRules.CanManageConfiguration(user));
        if (!(bool)(await command.ExecuteScalarAsync(ct))!) throw new WorkflowValidationException("Select an active faculty and a team within it that is in your organisation scope.");
    }

    private static async Task ValidateProcessSampleStaffAsync(SqlConnection connection,SqlTransaction transaction,IReadOnlyList<ProcessReviewSample> samples,CurrentUser user,CancellationToken ct)
    {
        var ids=samples.SelectMany(x=>x.StaffIds).Distinct().ToArray();if(ids.Length==0)return;
        await using var command=new SqlCommand("""
            SELECT COUNT(*) FROM OPENJSON(@ids) requested
            JOIN people.staff staff ON staff.id=TRY_CONVERT(uniqueidentifier,requested.value)
            WHERE staff.archived_at IS NULL AND staff.account_status=N'active'
              AND (@all=1 OR staff.id=@self OR EXISTS(SELECT 1 FROM org.fn_visible_staff(@user) scope WHERE scope.staff_id=staff.id));
            """,connection,transaction);
        command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(ids));command.Parameters.AddWithValue("@all",ProcessReviewRules.CanManageConfiguration(user));
        command.Parameters.AddWithValue("@self",ToDbValue(user.StaffId));command.Parameters.AddWithValue("@user",ToDbValue(user.UserAccountId));
        if(Convert.ToInt32(await command.ExecuteScalarAsync(ct))!=ids.Length)throw new WorkflowValidationException("Select associated staff who are active and in your staff scope.");
    }
}
