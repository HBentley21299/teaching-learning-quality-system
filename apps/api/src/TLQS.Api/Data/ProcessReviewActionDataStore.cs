using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static void PreventGenericProcessActionMutation(ActionSummary? action)
    {
        if(action is not null && ProcessReviewRules.IsProcess(action.SourceFormType))
            throw new WorkflowValidationException("Update this review action through its action progress editor.");
    }
    public async Task<IReadOnlyList<ProcessReviewAction>> GetProcessReviewActionsAsync(string processKey,string? academicYear,CurrentUser user,CancellationToken ct)
    {
        var direct=await ReadProcessActionsAsync(processKey,academicYear,null,null,user,false,ct);
        if(processKey!=ProcessReviewRules.Activate)return direct;
        var reviews=await ReadProcessRowsAsync(processKey,academicYear,null,user,ct);
        var inheritedSources=reviews.SelectMany(review=>review.AncestorReviewIds??[]).Distinct().ToArray();
        var inherited=inheritedSources.Length==0?[]:await ReadProcessActionsAsync(processKey,null,null,null,user,false,ct,inheritedSources);
        return direct.Concat(inherited).DistinctBy(action=>action.ActionId).Select(action=>action with
        {
            AssociatedReviewIds=reviews.Where(review=>review.RecordId==action.RecordId||review.AncestorReviewIds?.Contains(action.RecordId)==true)
                .Select(review=>review.RecordId).ToArray()
        }).ToArray();
    }

    public async Task<ProcessReviewAction?> GetProcessReviewActionAsync(Guid actionId,CurrentUser user,CancellationToken ct) =>
        (await ReadProcessActionsAsync(null,null,null,actionId,user,true,ct)).SingleOrDefault();

    private async Task<IReadOnlyList<ProcessReviewAction>> ReadProcessActionsAsync(string? processKey,string? academicYear,Guid? recordId,Guid? actionId,
        CurrentUser user,bool includeUpdates,CancellationToken ct,IReadOnlyCollection<Guid>? sourceRecordIds=null)
    {
        if (!user.UserAccountId.HasValue || !user.StaffId.HasValue) return [];
        if (processKey is not null && !ProcessReviewRules.IsProcess(processKey)) throw new WorkflowValidationException("Select a supported review process.");
        var actions=await QueryAsync($"""
            SELECT a.id,r.id,p.process_key,r.title,r.academic_year_key,faculty.name,team.name,a.title,metadata.theme_key,
                a.owner_staff_id,owner.display_name,a.due_date,metadata.support_required,metadata.success_evidence,
                COALESCE(status.value_key,N'open'),metadata.impact_status,metadata.impact_evidence,metadata.impact_evidence_link,a.row_version,
                CONVERT(bit,CASE WHEN a.owner_staff_id=@processStaffId OR r.owner_staff_id=@processStaffId OR @formsManage=1
                    OR EXISTS(SELECT 1 FROM quality.process_review_action_assignees assignee WHERE assignee.action_id=a.id AND assignee.staff_id=@processStaffId)
                    OR ((p.process_key=N'digital_learning_walk' AND @digitalManage=1 OR p.process_key=N'activate_growth_review' AND @activateManage=1) AND {ProcessScopeSql}) THEN 1 ELSE 0 END),a.action_theme,
                metadata.impact_area_key,metadata.action_detail,metadata.review_date,p.configuration_json
            FROM quality.process_review_actions metadata JOIN quality.actions a ON a.id=metadata.action_id
            JOIN quality.process_reviews p ON p.record_id=a.source_record_id JOIN core.records r ON r.id=p.record_id
            JOIN people.staff owner ON owner.id=a.owner_staff_id LEFT JOIN core.lookup_values status ON status.id=a.status_lookup_value_id
            LEFT JOIN org.org_units faculty ON faculty.id=p.faculty_org_unit_id LEFT JOIN org.org_units team ON team.id=p.team_org_unit_id
            WHERE a.archived_at IS NULL AND r.archived_at IS NULL AND (@key IS NULL OR p.process_key=@key)
                AND (@year IS NULL OR r.academic_year_key=@year) AND (@record IS NULL OR r.id=@record) AND (@action IS NULL OR a.id=@action)
                AND (@sourceRecords IS NULL OR r.id IN(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@sourceRecords)))
                AND (a.owner_staff_id=@processStaffId OR r.owner_staff_id=@processStaffId
                    OR EXISTS(SELECT 1 FROM quality.process_review_action_assignees assignee WHERE assignee.action_id=a.id AND assignee.staff_id=@processStaffId)
                    OR p.process_key=N'digital_learning_walk' AND (@digitalAll=1 OR @digitalScoped=1 AND {ProcessScopeSql})
                    OR p.process_key=N'activate_growth_review' AND (@activateAll=1 OR @activateScoped=1 AND {ProcessScopeSql}))
            ORDER BY a.due_date,r.title,a.title;
            """,command=>
            {
                AddProcessParameters(command,user);command.Parameters.AddWithValue("@key",ToDbValue(processKey));command.Parameters.AddWithValue("@year",ToDbValue(academicYear));
                command.Parameters.AddWithValue("@record",ToDbValue(recordId));command.Parameters.AddWithValue("@action",ToDbValue(actionId));
                command.Parameters.AddWithValue("@sourceRecords",sourceRecordIds is null?DBNull.Value:JsonSerializer.Serialize(sourceRecordIds));
                command.Parameters.AddWithValue("@formsManage",user.IsAdministrator);
                command.Parameters.AddWithValue("@digitalManage",user.HasPermission(ProcessReviewRules.Digital+".manage"));
                command.Parameters.AddWithValue("@activateManage",user.HasPermission(ProcessReviewRules.Activate+".manage"));
            },reader=>new ProcessReviewAction(reader.GetGuid(0),reader.GetGuid(1),reader.GetString(2),reader.GetString(3),reader.GetString(4),
                GetStringOrNull(reader,5),GetStringOrNull(reader,6),reader.GetString(7),reader.GetString(8),reader.GetGuid(9),reader.GetString(10),
                DateOnly.FromDateTime(reader.GetDateTime(11)),reader.GetString(12),reader.GetString(13),reader.GetString(14),reader.GetString(15),
                GetStringOrNull(reader,16),GetStringOrNull(reader,17),Convert.ToBase64String((byte[])reader[18]),[],reader.GetBoolean(19),reader.GetString(20),
                ImpactAreaKey:GetStringOrNull(reader,21),ImpactAreaLabel:ProcessReviewRules.SkillAreaLabel(JsonSerializer.Deserialize<ProcessReviewConfiguration>(reader.GetString(24),ProcessJson)!,GetStringOrNull(reader,21)),
                Detail:GetStringOrNull(reader,22),ReviewDate:GetDateOnlyOrNull(reader,23)),ct);
        if(actions.Count>0)
        {
            var assigned=await QueryAsync("""
                SELECT action_id,staff_id,display_name_snapshot FROM quality.process_review_action_assignees
                WHERE action_id IN(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@ids)) ORDER BY display_name_snapshot;
                """,command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(actions.Select(x=>x.ActionId))),reader=>new
                {Id=reader.GetGuid(0),Person=new ProcessReviewResponsibleStaff(reader.GetGuid(1),reader.GetString(2))},ct);
            var groups=assigned.ToLookup(x=>x.Id,x=>x.Person);
            actions=actions.Select(action=>action.ProcessKey!=ProcessReviewRules.Activate?action:action with
            {ResponsibleStaffIds=groups[action.ActionId].Select(x=>x.StaffId).ToArray(),ResponsibleStaff=groups[action.ActionId].ToArray()}).ToArray();
        }
        if (!includeUpdates || actions.Count==0) return actions;
        var updates=await QueryAsync("""
            SELECT history.action_id,history.id,history.updated_at,staff.display_name,history.update_json
            FROM quality.process_review_action_updates history
            JOIN OPENJSON(@ids) requested ON history.action_id=TRY_CONVERT(uniqueidentifier,requested.value)
            JOIN auth.user_accounts account ON account.id=history.updated_by_user_account_id JOIN people.staff staff ON staff.id=account.staff_id
            ORDER BY history.updated_at DESC;
            """,command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(actions.Select(x=>x.ActionId))),reader=>new
            {
                ActionId=reader.GetGuid(0),Update=JsonSerializer.Deserialize<ProcessReviewActionUpdate>(reader.GetString(4),ProcessJson)! with
                {UpdateId=reader.GetGuid(1),UpdatedAt=reader.GetFieldValue<DateTimeOffset>(2),UpdatedByName=reader.GetString(3)}
            },ct);
        var grouped=updates.ToLookup(x=>x.ActionId,x=>x.Update);
        return actions.Select(x=>x with {Updates=grouped[x.ActionId].ToArray()}).ToArray();
    }

    public async Task<ProcessReviewAction> SaveProcessReviewActionAsync(Guid recordId,Guid? actionId,SaveProcessReviewActionRequest request,CurrentUser user,CancellationToken ct)
    {
        var review=await GetProcessReviewAsync(recordId,user,ct);
        var existing=actionId.HasValue?await GetProcessReviewActionAsync(actionId.Value,user,ct):null;
        if (actionId.HasValue && (existing is null || existing.RecordId!=recordId || !existing.CanEdit)) throw new UnauthorizedAccessException("You cannot edit this action.");
        if (!actionId.HasValue && review?.CanEdit!=true) throw new UnauthorizedAccessException("Only the review owner or an authorised coordinator can assign actions.");
        ProcessReviewConfiguration configuration;
        if (review is not null) configuration=review.Configuration;
        else
        {
            // Action assignment allows action access, without disclosing the review narrative.
            if(existing is null || !existing.CanEdit)throw new UnauthorizedAccessException("You cannot edit this action.");
            var configurations=await QueryAsync("SELECT configuration_json FROM quality.process_reviews WHERE record_id=@id;",
                command=>command.Parameters.AddWithValue("@id",recordId),reader=>JsonSerializer.Deserialize<ProcessReviewConfiguration>(reader.GetString(0),ProcessJson)!,ct);
            configuration=configurations.Single();
        }
        var modern=configuration.ProcessKey==ProcessReviewRules.Activate&&configuration.SkillsScanPillars is not null;
        if(modern&&request.ResponsibleStaffIds is {Count:>0} people&&request.ReviewDate.HasValue)
        {
            var primary=existing is not null&&people.Contains(existing.OwnerStaffId)?existing.OwnerStaffId:people[0];
            var title=string.IsNullOrWhiteSpace(request.Title)?(request.Detail??"").Trim():request.Title.Trim();
            request=request with{OwnerStaffId=primary,DueDate=request.ReviewDate!.Value,Title=title.Length>300?title[..300]:title,SupportRequired=""};
        }
        ProcessReviewRules.ValidateAction(request,configuration,existing?.DueDate);
        if (existing is null && request.Progress!="open") throw new WorkflowValidationException("Assign a new action as open, then record its progress in a dated update.");
        var canManageSource=review?.CanEdit==true;
        if (!canManageSource && existing!.OwnerStaffId!=request.OwnerStaffId) throw new UnauthorizedAccessException("Only the review owner or coordinator can reassign this action.");
        if(!canManageSource&&modern&&!(existing!.ResponsibleStaffIds??[existing.OwnerStaffId]).Order().SequenceEqual(request.ResponsibleStaffIds!.Order()))
            throw new UnauthorizedAccessException("Only the review owner or coordinator can change responsible staff.");
        if (existing is not null && request.RowVersion!=existing.RowVersion) throw new DBConcurrencyException("This action changed. Reload it before saving your update.");
        await using var connection=await OpenConnectionAsync(ct);
        await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        if (existing is null || existing.OwnerStaffId!=request.OwnerStaffId)
            await ValidateProcessSampleStaffAsync(connection,transaction,[new ProcessReviewSample("action_owner","Action owner","staff",null,null,[request.OwnerStaffId],null,null)],user,ct);
        if(modern)
        {
            var additions=request.ResponsibleStaffIds!.Except(existing?.ResponsibleStaffIds??[]).ToArray();
            if(additions.Length>0)await ValidateProcessSampleStaffAsync(connection,transaction,[new("responsible","Responsible staff","staff",null,null,additions,null,null)],user,ct);
        }
        var id=actionId??Guid.NewGuid();
        var theme=modern?configuration.ActionThemes!.First(x=>x.Key==request.ThemeKey).Title:configuration.Standards.First(x=>x.Key==request.ThemeKey).Title;
        // The central status/date are authoritative for both the process and /actions/{id}.
        if (existing is null)
        {
            await using var insert=new SqlCommand("""
                INSERT INTO quality.actions(id,source_record_id,source_form_type,owner_staff_id,action_theme,title,detail,
                    status_lookup_value_id,due_date,original_due_date,published_to_staff,visibility_setting,created_by_user_account_id,
                    intended_evidence,intended_impact)
                VALUES(@id,@record,@key,@owner,@theme,@title,@detail,
                    (SELECT TOP(1) value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id=value.lookup_type_id WHERE type.lookup_key=N'action_status' AND value.value_key=@progress),
                    @due,@due,1,N'staff_and_management',@user,@success,@success);
                INSERT INTO quality.process_review_actions(action_id,theme_key,support_required,success_evidence,impact_status,impact_evidence,impact_evidence_link)
                VALUES(@id,@themeKey,@support,@success,@impact,@impactEvidence,@impactLink);
                """,connection,transaction);
            AddProcessActionParameters(insert,id,recordId,configuration.ProcessKey,theme,request,user);
            await insert.ExecuteNonQueryAsync(ct);
        }
        else
        {
            await using var update=new SqlCommand("""
                UPDATE quality.actions SET title=@title,action_theme=@theme,owner_staff_id=@owner,detail=@detail,
                    status_lookup_value_id=(SELECT TOP(1) value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id=value.lookup_type_id WHERE type.lookup_key=N'action_status' AND value.value_key=@progress),
                    revised_due_date=CASE WHEN @due=original_due_date THEN NULL WHEN @due<>due_date THEN @due ELSE revised_due_date END,
                    due_date=@due,completed_date=CASE WHEN @progress=N'complete' THEN COALESCE(completed_date,CONVERT(date,sysutcdatetime())) ELSE NULL END,
                    completed_by_user_account_id=CASE WHEN @progress=N'complete' THEN COALESCE(completed_by_user_account_id,@user) ELSE NULL END,
                    completion_note=CASE WHEN @progress=N'complete' THEN COALESCE(@progressNote,completion_note) ELSE NULL END,
                    cancelled_at=CASE WHEN @progress=N'cancelled' THEN COALESCE(cancelled_at,sysutcdatetime()) ELSE NULL END,
                    cancelled_by_user_account_id=CASE WHEN @progress=N'cancelled' THEN COALESCE(cancelled_by_user_account_id,@user) ELSE NULL END,
                    cancellation_comments=CASE WHEN @progress=N'cancelled' THEN COALESCE(@progressNote,cancellation_comments) ELSE NULL END,
                    updated_at=sysutcdatetime(),updated_by_user_account_id=@user,intended_evidence=@success,intended_impact=@success
                WHERE id=@id AND source_record_id=@record AND row_version=@version AND archived_at IS NULL;
                IF @@ROWCOUNT=0 THROW 51001,'This action changed. Reload before saving.',1;
                UPDATE quality.process_review_actions SET theme_key=@themeKey,support_required=@support,success_evidence=@success,
                    impact_status=@impact,impact_evidence=@impactEvidence,impact_evidence_link=@impactLink WHERE action_id=@id;
                """,connection,transaction);
            AddProcessActionParameters(update,id,recordId,configuration.ProcessKey,theme,request,user);
            update.Parameters.Add("@version",SqlDbType.Binary,8).Value=Convert.FromBase64String(existing.RowVersion);
            try {await update.ExecuteNonQueryAsync(ct);}catch(SqlException exception)when(exception.Number==51001){throw new DBConcurrencyException(exception.Message,exception);}
            if (existing.DueDate!=request.DueDate)
            {
                await using var extension=new SqlCommand("""
                    INSERT INTO quality.action_extensions(action_id,previous_due_date,extended_due_date,reason,created_by_user_account_id)
                    SELECT @id,@previous,@due,@reason,@user WHERE @due>@previous;
                    """,connection,transaction);
                extension.Parameters.AddWithValue("@id",id);extension.Parameters.AddWithValue("@previous",existing.DueDate.ToDateTime(TimeOnly.MinValue));
                extension.Parameters.AddWithValue("@due",request.DueDate.ToDateTime(TimeOnly.MinValue));extension.Parameters.AddWithValue("@reason",request.DeadlineChangeReason!);
                extension.Parameters.AddWithValue("@user",user.UserAccountId!.Value);await extension.ExecuteNonQueryAsync(ct);
            }
        }
        var updateData=new ProcessReviewActionUpdate(Guid.Empty,DateTimeOffset.UtcNow,user.DisplayName,request.Progress,request.ProgressNote,request.EvidenceLink,
            request.Barriers,request.NextStep,request.DueDate,request.DeadlineChangeReason,request.ImpactStatus,request.ImpactEvidence,request.ImpactEvidenceLink);
        await using var history=new SqlCommand("""
            INSERT INTO quality.process_review_action_updates(action_id,updated_by_user_account_id,update_json) VALUES(@id,@user,@json);
            """,connection,transaction);
        history.Parameters.AddWithValue("@id",id);history.Parameters.AddWithValue("@user",user.UserAccountId!.Value);
        history.Parameters.AddWithValue("@json",JsonSerializer.Serialize(updateData,ProcessJson));await history.ExecuteNonQueryAsync(ct);
        await WriteAuditAsync(connection,transaction,user.UserAccountId,recordId,"action",id,existing is null?"action.created":"action.updated",
            $"{request.Title} {(existing is null?"assigned":"updated")} by {user.DisplayName}.",
            existing is null?null:JsonSerializer.Serialize(existing with{Updates=[]},ProcessJson),
            JsonSerializer.Serialize(request,ProcessJson),ct);
        if(modern)await SaveActivateActionDetailsAsync(connection,transaction,id,request,ct);
        if(existing is null||modern&&request.ResponsibleStaffIds!.Except(existing.ResponsibleStaffIds??[]).Any())
            await InsertDomainEventAsync(connection,transaction,"action.assigned","action",id,recordId,
                modern?JsonSerializer.Serialize(new{responsibleStaffIds=request.ResponsibleStaffIds},ProcessJson):"{}",user.UserAccountId,ct);
        await transaction.CommitAsync(ct);
        return await GetProcessReviewActionAsync(id,user,ct)??throw new InvalidOperationException("The saved action could not be read.");
    }

    private static void AddProcessActionParameters(SqlCommand command,Guid id,Guid recordId,string processKey,string theme,SaveProcessReviewActionRequest request,CurrentUser user)
    {
        command.Parameters.AddWithValue("@id",id);command.Parameters.AddWithValue("@record",recordId);command.Parameters.AddWithValue("@key",processKey);
        command.Parameters.AddWithValue("@owner",request.OwnerStaffId);command.Parameters.AddWithValue("@theme",theme);command.Parameters.AddWithValue("@title",request.Title.Trim());
        command.Parameters.AddWithValue("@themeKey",request.ThemeKey);
        command.Parameters.AddWithValue("@detail",processKey==ProcessReviewRules.Activate&&request.ResponsibleStaffIds is not null?request.Detail??"":$"Support required: {request.SupportRequired}\nSuccess evidence: {request.SuccessEvidence}");
        command.Parameters.AddWithValue("@support",request.SupportRequired??"");command.Parameters.AddWithValue("@success",request.SuccessEvidence);
        command.Parameters.AddWithValue("@due",request.DueDate.ToDateTime(TimeOnly.MinValue));command.Parameters.AddWithValue("@progress",request.Progress);
        command.Parameters.AddWithValue("@progressNote",ToDbValue(request.ProgressNote));command.Parameters.AddWithValue("@impact",request.ImpactStatus);
        command.Parameters.AddWithValue("@impactEvidence",ToDbValue(request.ImpactEvidence));command.Parameters.AddWithValue("@impactLink",ToDbValue(request.ImpactEvidenceLink));
        command.Parameters.AddWithValue("@user",ToDbValue(user.UserAccountId));
    }

    private static async Task SaveActivateActionDetailsAsync(SqlConnection connection,SqlTransaction transaction,Guid id,SaveProcessReviewActionRequest request,CancellationToken ct)
    {
        await using var command=new SqlCommand("""
            UPDATE quality.process_review_actions SET impact_area_key=@area,action_detail=@detail,review_date=@review WHERE action_id=@id;
            UPDATE quality.actions SET review_date=@review WHERE id=@id;
            DELETE quality.process_review_action_assignees WHERE action_id=@id;
            INSERT quality.process_review_action_assignees(action_id,staff_id,display_name_snapshot)
            SELECT @id,staff.id,staff.display_name FROM OPENJSON(@people) selected JOIN people.staff staff ON staff.id=TRY_CONVERT(uniqueidentifier,selected.value);
            """,connection,transaction);
        command.Parameters.AddWithValue("@id",id);command.Parameters.AddWithValue("@area",request.ImpactAreaKey!);command.Parameters.AddWithValue("@detail",request.Detail!);
        command.Parameters.AddWithValue("@review",request.ReviewDate!.Value.ToDateTime(TimeOnly.MinValue));command.Parameters.AddWithValue("@people",JsonSerializer.Serialize(request.ResponsibleStaffIds));
        await command.ExecuteNonQueryAsync(ct);
    }
}
