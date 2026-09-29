using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<bool> CanValidateElevateStaffAsync(Guid staffId, CurrentUser user, CancellationToken token) =>
        ElevateValidationPolicy.CanReview(user, staffId, ElevateValidationPolicy.HasReviewPermission(user)
            && await IsStaffProfileInScopeAsync(staffId, user, token));

    public async Task<ElevatePracticeWorkspaceSummary> WithElevateValidationAccessAsync(
        ElevatePracticeWorkspaceSummary workspace, CurrentUser user, CancellationToken token)
    {
        if (workspace.Validation is null) return workspace;
        var canReview = await CanValidateElevateStaffAsync(workspace.StaffId, user, token);
        var depth = await GetStaffManagementDepthAsync(workspace.StaffId, user, token);
        return workspace with {
            CanEdit = workspace.CanEdit || ((workspace.Status == "submitted" || workspace.Validation.Status == "returned") && (canReview || depth > 0)),
            Validation = workspace.Validation with { CanValidate = canReview }
        };
    }

    private async Task<ElevateValidationSummary?> GetElevateValidationSummaryAsync(Guid? assessmentId, CancellationToken token)
    {
        if (!assessmentId.HasValue) return null;
        var values = await QueryAsync("""
            SELECT assessment.validation_status, staff.display_name, assessment.reviewed_at, assessment.validation_feedback, assessment.row_version
            FROM quality.elevate_practice_assessments assessment
            LEFT JOIN auth.user_accounts account ON account.id=assessment.reviewed_by_user_account_id
            LEFT JOIN people.staff staff ON staff.id=account.staff_id
            WHERE assessment.id=@id AND assessment.archived_at IS NULL;
            """, command => command.Parameters.AddWithValue("@id", assessmentId.Value),
            reader => new ElevateValidationSummary(reader.GetString(0), GetStringOrNull(reader,1), GetDateTimeOffsetOrNull(reader,2), GetStringOrNull(reader,3), reader.GetFieldValue<byte[]>(4), false, []), token);
        if (values.Count == 0) return null;
        var history = await QueryAsync("""
            SELECT event.action, COALESCE(staff.display_name,N'System'), event.created_at, event.note
            FROM quality.elevate_practice_validation_events event
            LEFT JOIN auth.user_accounts account ON account.id=event.actor_user_account_id
            LEFT JOIN people.staff staff ON staff.id=account.staff_id
            WHERE event.assessment_id=@id ORDER BY event.created_at DESC,event.id DESC;
            """, command => command.Parameters.AddWithValue("@id",assessmentId.Value),
            reader => new ElevateValidationEvent(reader.GetString(0),reader.GetString(1),reader.GetFieldValue<DateTimeOffset>(2),GetStringOrNull(reader,3)),token);
        return values[0] with { History = history };
    }

    private static async Task RecordElevateContentChangeAsync(SqlConnection connection, SqlTransaction transaction,
        Guid assessmentId, CurrentUser user, string status, string? note, CancellationToken token)
    {
        await using var read = new SqlCommand("SELECT validation_status FROM quality.elevate_practice_assessments WITH (UPDLOCK,HOLDLOCK) WHERE id=@id;", connection, transaction);
        read.Parameters.AddWithValue("@id",assessmentId);
        var previous = (string)(await read.ExecuteScalarAsync(token) ?? "draft");
        var next = ElevateValidationPolicy.AfterContentSave(status,previous);
        await using var update = new SqlCommand("""
            UPDATE quality.elevate_practice_assessments SET validation_status=@next,
                reviewed_at=CASE WHEN @next=N'returned' THEN reviewed_at END,
                reviewed_by_user_account_id=CASE WHEN @next=N'returned' THEN reviewed_by_user_account_id END,
                validation_feedback=CASE WHEN @next=N'returned' THEN validation_feedback END
            WHERE id=@id;
            INSERT quality.elevate_practice_validation_events(assessment_id,action,note,actor_user_account_id)
            VALUES(@id,@action,@note,@user);
            """,connection,transaction);
        update.Parameters.AddWithValue("@id",assessmentId);
        update.Parameters.AddWithValue("@next",next);
        update.Parameters.AddWithValue("@action", status=="submitted" ? previous is "returned" or "validated" or "pending" ? "resubmitted" : "submitted" : "draft_saved");
        update.Parameters.AddWithValue("@note",ToDbValue(note));
        update.Parameters.AddWithValue("@user",ToDbValue(user.UserAccountId));
        await update.ExecuteNonQueryAsync(token);
    }

    public async Task<ElevatePracticeWorkspaceSummary?> ReviewElevatePracticeAsync(Guid staffId, Guid assessmentId,
        ReviewElevatePracticeRequest request, CurrentUser user, CancellationToken token)
    {
        if (!await CanValidateElevateStaffAsync(staffId,user,token)) throw new UnauthorizedAccessException("You can only validate another staff member's assessment within your assigned scope.");
        if (request.RowVersion is not {Length:8}) throw new DBConcurrencyException("Refresh this assessment before reviewing it.");
        var action=request.Action?.Trim().ToLowerInvariant() ?? "";
        await using var connection=await OpenConnectionAsync(token);
        await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync(token);
        Guid recordId;
        string status,validationStatus,academicYear;
        await using(var read=new SqlCommand("SELECT record_id,status,validation_status,row_version,academic_year FROM quality.elevate_practice_assessments WITH (UPDLOCK,HOLDLOCK) WHERE id=@id AND staff_id=@staff AND archived_at IS NULL;",connection,transaction))
        {
            read.Parameters.AddWithValue("@id",assessmentId); read.Parameters.AddWithValue("@staff",staffId);
            await using var reader=await read.ExecuteReaderAsync(token);
            if(!await reader.ReadAsync(token)) return null;
            recordId=reader.GetGuid(0);status=reader.GetString(1);validationStatus=reader.GetString(2);
            academicYear=reader.GetString(4);
            if(!reader.GetFieldValue<byte[]>(3).SequenceEqual(request.RowVersion)) throw new DBConcurrencyException("This assessment changed since you opened it. Refresh and review the latest answers.");
        }
        ElevateValidationPolicy.ValidateDecision(status,validationStatus,action,request.Note);
        if (action == "return" && academicYear != GetCurrentAcademicYear())
            throw new WorkflowValidationException("Only the current academic year's assessment can be returned to staff. Historical assessments can be amended together using the tracked edit option.");
        var next=action=="validate"?"validated":"returned";
        await using(var update=new SqlCommand("""
            UPDATE quality.elevate_practice_assessments SET validation_status=@next,
                status=CASE WHEN @next=N'returned' THEN N'draft' ELSE status END,
                reviewed_at=sysutcdatetime(), reviewed_by_user_account_id=@user,
                validation_feedback=@note, updated_at=sysutcdatetime()
            WHERE id=@id;
            UPDATE core.records SET updated_at=sysutcdatetime(),updated_by_user_account_id=@user,
                summary=CASE WHEN @next=N'returned' THEN N'Self-assessment returned for amendments' ELSE N'Validated annual self-assessment' END WHERE id=@record;
            INSERT quality.elevate_practice_validation_events(assessment_id,action,note,actor_user_account_id)
            VALUES(@id,@next,@note,@user);
            """,connection,transaction))
        {
            update.Parameters.AddWithValue("@id",assessmentId);update.Parameters.AddWithValue("@record",recordId);
            update.Parameters.AddWithValue("@next",next);update.Parameters.AddWithValue("@user",ToDbValue(user.UserAccountId));
            update.Parameters.AddWithValue("@note",ToDbValue(request.Note?.Trim()));await update.ExecuteNonQueryAsync(token);
        }
        await WriteAuditAsync(connection,transaction,user.UserAccountId,recordId,"elevate_practice_assessment",assessmentId,
            $"elevate_practice.{next}",$"Self-assessment {next} by {user.DisplayName}.",
            JsonSerializer.Serialize(new {status,validationStatus}),JsonSerializer.Serialize(new {validationStatus=next,request.Note}),token);
        await transaction.CommitAsync(token);
        var result=await GetAdminElevatePracticeWorkspaceAsync(assessmentId,token);
        return result is null?null:await WithElevateValidationAccessAsync(result,user,token);
    }

    public async Task<IReadOnlyList<ElevatePracticeProgressSummary>> GetElevateValidationProgressAsync(CurrentUser user,CancellationToken token)
    {
        if(!ElevateValidationPolicy.HasReviewPermission(user)) throw new UnauthorizedAccessException("Validation permission is required.");
        var visible=await QueryAsync("SELECT staff_id FROM org.fn_visible_staff(@user);",
            command=>command.Parameters.AddWithValue("@user",ToDbValue(user.UserAccountId)),reader=>reader.GetGuid(0),token);
        var ids=visible.ToHashSet();
        var progress=await GetElevatePracticeProgressAsync(GetCurrentAcademicYear(),token);
        var metadata=await QueryAsync("""
            SELECT assessment.id,assessment.validation_status,staff.display_name,assessment.reviewed_at,assessment.validation_feedback
            FROM quality.elevate_practice_assessments assessment
            LEFT JOIN auth.user_accounts account ON account.id=assessment.reviewed_by_user_account_id
            LEFT JOIN people.staff staff ON staff.id=account.staff_id
            WHERE assessment.academic_year=@year AND assessment.archived_at IS NULL;
            """,command=>command.Parameters.AddWithValue("@year",GetCurrentAcademicYear()),
            reader=>new {Id=reader.GetGuid(0),Status=reader.GetString(1),Name=GetStringOrNull(reader,2),At=GetDateTimeOffsetOrNull(reader,3),Note=GetStringOrNull(reader,4)},token);
        var states=metadata.ToDictionary(item=>item.Id);
        return progress.Where(item=>ElevateValidationPolicy.CanReview(user,item.StaffId,ids.Contains(item.StaffId)))
            .Select(item=>item.AssessmentId.HasValue && states.TryGetValue(item.AssessmentId.Value,out var state)
                ? item with {ValidationStatus=state.Status,ReviewedByName=state.Name,ReviewedAt=state.At,Feedback=state.Note}
                : item with {ValidationStatus="draft"}).ToArray();
    }
}
