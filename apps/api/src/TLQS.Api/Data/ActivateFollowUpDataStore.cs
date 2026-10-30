using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<ProcessReviewDetail> CreateActivateFollowUpAsync(Guid parentRecordId,CreateActivateFollowUpRequest request,
        CurrentUser user,CancellationToken ct)
    {
        if(!ProcessReviewRules.CanCreate(user,ProcessReviewRules.Activate))
            throw new UnauthorizedAccessException("You cannot create an Activate+ follow-up review.");
        var parent=await GetProcessReviewAsync(parentRecordId,user,ct);
        if(parent?.ProcessKey!=ProcessReviewRules.Activate||!parent.CanEdit)
            throw new UnauthorizedAccessException("Only the review owner or an authorised coordinator can add its follow-up.");
        var alreadyLinked=await QueryAsync("SELECT child_record_id FROM quality.process_review_follow_ups WHERE parent_record_id=@parent;",
            command=>command.Parameters.AddWithValue("@parent",parentRecordId),reader=>reader.GetGuid(0),ct);
        if(alreadyLinked.Count>0)return await GetProcessReviewAsync(alreadyLinked[0],user,ct)
            ??throw new UnauthorizedAccessException("An existing follow-up is outside your review access.");
        var configuration=parent.Configuration.SkillsScanPillars is null
            ? await GetProcessReviewConfigurationAsync(ProcessReviewRules.Activate,ct):parent.Configuration;
        var date=request.RecordDate??DateOnly.FromDateTime(DateTime.UtcNow);
        var scopes=parent.SelectedSubTeams??[];
        IReadOnlyList<ProcessReviewParticipant> participants=parent.Participants??[];
        var source=parent.Data.Activate;
        IReadOnlyList<ProcessReviewParticipant> automatic=source?.AutomaticParticipants??participants.Where(x=>x.IsLocked||x.Roles.Contains("Programme leader")).ToArray();
        if(source is null)
        {
            if(!parent.FacultyOrgUnitId.HasValue)throw new WorkflowValidationException("Save the review's faculty and sub-team scope before adding a follow-up.");
            var context=await ResolveActivateReviewContextAsync(new(parent.FacultyOrgUnitId.Value,!parent.TeamOrgUnitId.HasValue,
                parent.TeamOrgUnitId.HasValue?[parent.TeamOrgUnitId.Value]:[],parent.RecordId,parent.RecordDate),user,ct);
            scopes=context.AvailableSubTeams.Where(x=>context.SelectedSubTeamOrgUnitIds.Contains(x.OrgUnitId)).ToArray();
            participants=context.Participants;automatic=context.Participants;
        }
        if(scopes.Count==0)throw new WorkflowValidationException("Save at least one sub-team on the review before adding a follow-up.");
        // The new record belongs to its creator. Other participants and leadership defaults retain their recorded identities.
        var defaults=ActivateFollowUpParticipants(automatic,user,parent.FacultyName);
        var selected=ActivateFollowUpParticipants(participants,user,parent.FacultyName);
        var removed=(source?.RemovedProgrammeLeaderStaffIds??[]).Where(id=>id!=user.StaffId).ToArray();
        var data=new ActivateGrowthReviewData(source?.AllSubTeams??!parent.TeamOrgUnitId.HasValue,scopes.Select(x=>x.OrgUnitId).ToArray(),
            selected.Select(x=>x.StaffId).ToArray(),removed,new Dictionary<string,decimal?>(),
            HeadOfFacultyStaffIds:selected.Where(x=>x.Roles.Contains("Head of faculty")).Select(x=>x.StaffId).ToArray(),
            ProgrammeLeaderStaffIds:selected.Where(x=>x.Roles.Contains("Programme leader")).Select(x=>x.StaffId).ToArray(),AutomaticParticipants:defaults);
        var title=$"Follow-up · {parent.Title}";if(title.Length>300)title=title[..300];
        var save=new SaveProcessReviewRequest(title,request.AcademicYear,parent.FacultyOrgUnitId,null,date,new(new Dictionary<string,string>(),[],[],data));
        ProcessReviewRules.ValidateSave(save,configuration);
        var previous=new ActivatePreviousReviewContext(ProcessLink(parent),configuration,source?.SkillsScanScores??new Dictionary<string,decimal?>(),
            source?.MeetingMinutes,source?.Strengths,source?.Development,scopes,participants);
        await using var connection=await OpenConnectionAsync(ct);
        await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        await using var current=new SqlCommand("""
            SELECT p.row_version,link.child_record_id FROM quality.process_reviews p WITH(UPDLOCK,HOLDLOCK)
            LEFT JOIN quality.process_review_follow_ups link ON link.parent_record_id=p.record_id
            JOIN core.records record ON record.id=p.record_id AND record.archived_at IS NULL
            WHERE p.record_id=@parent AND p.process_key=N'activate_growth_review';
            """,connection,transaction);
        current.Parameters.AddWithValue("@parent",parentRecordId);
        Guid? existingId=null;string? currentVersion=null;
        await using(var reader=await current.ExecuteReaderAsync(ct))
        {
            if(await reader.ReadAsync(ct)){currentVersion=Convert.ToBase64String((byte[])reader[0]);existingId=GetGuidOrNull(reader,1);}
        }
        if(currentVersion is null)throw new UnauthorizedAccessException("The source review is no longer available.");
        if(existingId.HasValue)
        {
            await transaction.CommitAsync(ct);
            return await GetProcessReviewAsync(existingId.Value,user,ct)
                ??throw new UnauthorizedAccessException("An existing follow-up is outside your review access.");
        }
        if(currentVersion!=parent.RowVersion||request.RowVersion is not null&&request.RowVersion!=currentVersion)
            throw new DBConcurrencyException("The review changed. Reload it before adding its follow-up.");
        var id=Guid.NewGuid();
        await using var insert=new SqlCommand("""
            INSERT INTO core.records(id,module_id,record_type,title,owner_staff_id,org_unit_id,record_date,created_by_user_account_id,academic_year_key)
            SELECT @id,module.id,@key,@title,@owner,@faculty,@date,@user,@year
            FROM core.modules module WHERE module.module_key=@key AND module.is_enabled=1;
            IF @@ROWCOUNT=0 THROW 51000,'This review process is not installed or is disabled.',1;
            INSERT INTO quality.process_reviews(record_id,process_key,configuration_json,data_json,faculty_org_unit_id,status)
            VALUES(@id,@key,@configuration,@data,@faculty,N'draft');
            INSERT INTO quality.process_review_follow_ups(child_record_id,parent_record_id,previous_context_json,created_by_user_account_id)
            VALUES(@id,@parent,@previous,@user);
            """,connection,transaction);
        AddProcessSaveParameters(insert,id,ProcessReviewRules.Activate,title,save,user,configuration,"draft");
        insert.Parameters.AddWithValue("@parent",parentRecordId);insert.Parameters.AddWithValue("@previous",JsonSerializer.Serialize(previous,ProcessJson));
        await insert.ExecuteNonQueryAsync(ct);
        await SaveActivateReviewContextAsync(connection,transaction,id,scopes,selected,ct);
        await WriteAuditAsync(connection,transaction,user.UserAccountId,id,"process_review",id,"process_review.follow_up_created",
            $"A follow-up to {parent.Title} was created by {user.DisplayName}.",null,JsonSerializer.Serialize(new{ParentRecordId=parentRecordId,ChildRecordId=id},ProcessJson),ct);
        await transaction.CommitAsync(ct);
        return await GetProcessReviewAsync(id,user,ct)??throw new InvalidOperationException("The linked follow-up could not be read.");
    }

    private static IReadOnlyList<ProcessReviewParticipant> ActivateFollowUpParticipants(IReadOnlyList<ProcessReviewParticipant> source,CurrentUser user,string? facultyName)
    {
        var people=source.ToDictionary(x=>x.StaffId,x=>
        {
            var roles=x.Roles.Where(role=>role!="Review owner").ToArray();
            return x with{Roles=roles.Length>0?roles:["Additional participant"],IsLocked=roles.Contains("Head of faculty")};
        });
        if(people.TryGetValue(user.StaffId!.Value,out var creator))people[user.StaffId.Value]=creator with{Roles=creator.Roles.Where(role=>role!="Additional participant").Prepend("Review owner").Distinct().ToArray(),IsLocked=true};
        else people[user.StaffId.Value]=new(user.StaffId.Value,user.DisplayName,["Review owner"],true,string.IsNullOrWhiteSpace(facultyName)?[]:[facultyName]);
        return people.Values.OrderByDescending(x=>x.IsLocked).ThenBy(x=>x.DisplayName).ToArray();
    }

    private static void ValidateActivateFollowUpScope(SaveProcessReviewRequest request,ProcessReviewDetail existing)
    {
        var prior=existing.Data.Activate;var proposed=request.Data.Activate;
        if(prior is null||proposed is null||request.FacultyOrgUnitId!=existing.FacultyOrgUnitId||request.TeamOrgUnitId.HasValue
            ||prior.AllSubTeams!=proposed.AllSubTeams||!prior.SubTeamOrgUnitIds.Order().SequenceEqual((proposed.SubTeamOrgUnitIds??[]).Order()))
            throw new WorkflowValidationException("A follow-up keeps the original review's team scope. Start a separate review to change that scope.");
    }

    private static ProcessReviewLink ProcessLink(ProcessReviewDetail review)=>new(review.RecordId,review.Title,review.AcademicYear,review.RecordDate,review.Status,review.CanEdit);
    private static ProcessReviewLink ProcessLink(ProcessRow review,CurrentUser user)=>new(review.RecordId,review.Title,review.AcademicYear,review.RecordDate,review.Status,
        ProcessReviewRules.CanEdit(user,review.ProcessKey,review.OwnerId,review.InScope));

    private async Task<IReadOnlyList<(Guid ReviewId,Guid SourceId)>> ReadActivateAncestryAsync(IReadOnlyCollection<Guid> recordIds,CancellationToken ct)
    {
        if(recordIds.Count==0)return[];
        return await QueryAsync("""
            WITH ancestry AS(
                SELECT TRY_CONVERT(uniqueidentifier,value) AS review_id,TRY_CONVERT(uniqueidentifier,value) AS source_id,0 AS depth FROM OPENJSON(@ids)
                UNION ALL SELECT ancestry.review_id,link.parent_record_id,ancestry.depth+1
                FROM ancestry JOIN quality.process_review_follow_ups link ON link.child_record_id=ancestry.source_id WHERE ancestry.depth<1000)
            SELECT review_id,source_id FROM ancestry OPTION(MAXRECURSION 1000);
            """,command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(recordIds)),reader=>(reader.GetGuid(0),reader.GetGuid(1)),ct);
    }

    private async Task<IReadOnlyList<ProcessReviewAction>> ReadActivateFollowUpActionsAsync(Guid recordId,CurrentUser user,CancellationToken ct)
    {
        var ancestry=await ReadActivateAncestryAsync([recordId],ct);
        var actions=await ReadProcessActionsAsync(ProcessReviewRules.Activate,null,null,null,user,true,ct,ancestry.Select(x=>x.SourceId).Distinct().ToArray());
        return actions.Select(action=>action with{AssociatedReviewIds=[recordId]}).ToArray();
    }

    private async Task<IReadOnlyList<ProcessRow>> HydrateActivateFollowUpRowsAsync(IReadOnlyList<ProcessRow> rows,CurrentUser user,CancellationToken ct)
    {
        var ids=rows.Where(x=>x.ProcessKey==ProcessReviewRules.Activate).Select(x=>x.RecordId).ToArray();
        if(ids.Length==0)return rows;
        var links=await QueryAsync("""
            SELECT child_record_id,parent_record_id,previous_context_json FROM quality.process_review_follow_ups
            WHERE child_record_id IN(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@ids))
                OR parent_record_id IN(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@ids));
            """,command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(ids)),reader=>new
            {Child=reader.GetGuid(0),Parent=reader.GetGuid(1),Context=JsonSerializer.Deserialize<ActivatePreviousReviewContext>(reader.GetString(2),ProcessJson)!},ct);
        if(links.Count==0)return rows;
        var ancestry=await ReadActivateAncestryAsync(ids,ct);
        var candidates=links.SelectMany(x=>new[]{x.Child,x.Parent}).Concat(ancestry.Select(x=>x.SourceId)).Distinct().Except(ids).ToArray();
        var counterparts=candidates.Length==0?[]:await ReadProcessRowsAsync(ProcessReviewRules.Activate,null,null,user,ct,candidates,false);
        var visible=rows.Concat(counterparts).ToDictionary(x=>x.RecordId);
        var actions=await ReadProcessActionsAsync(ProcessReviewRules.Activate,null,null,null,user,false,ct,ancestry.Select(x=>x.SourceId).Distinct().ToArray());
        var byAncestry=ancestry.ToLookup(x=>x.ReviewId,x=>x.SourceId);
        return rows.Select(row=>
        {
            if(row.ProcessKey!=ProcessReviewRules.Activate)return row;
            var parentLink=links.FirstOrDefault(x=>x.Child==row.RecordId);
            var parent=parentLink is not null?visible.GetValueOrDefault(parentLink.Parent):null;
            var sourceIds=byAncestry[row.RecordId].ToHashSet();
            return row with{IsFollowUp=parentLink is not null,ParentReview=parent is null?null:ProcessLink(parent,user),
                FollowUpReviews=links.Where(x=>x.Parent==row.RecordId&&visible.ContainsKey(x.Child)).Select(x=>ProcessLink(visible[x.Child],user)).ToArray(),
                ParentReviewContext=parent is null?null:parentLink!.Context with{Review=parentLink.Context.Review with{CanEdit=ProcessReviewRules.CanEdit(user,parent.ProcessKey,parent.OwnerId,parent.InScope)}},
                // Kept internal for action joins; each returned action still passes its independent source/assignee access checks.
                AncestorReviewIds=sourceIds.Where(id=>id!=row.RecordId).ToArray(),
                OpenActions=parentLink is null?row.OpenActions:actions.Count(action=>sourceIds.Contains(action.RecordId)&&action.Progress is not ("complete" or "cancelled"))};
        }).ToArray();
    }
}
