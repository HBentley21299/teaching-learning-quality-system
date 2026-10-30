using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<ActivateReviewContext> ResolveActivateReviewContextAsync(ResolveActivateReviewContextRequest request,CurrentUser user,CancellationToken ct)
    {
        if(!ProcessReviewRules.CanCreate(user,ProcessReviewRules.Activate)&&!request.RecordId.HasValue)throw new UnauthorizedAccessException("You cannot prepare an Activate+ review.");
        if(request.SubTeamOrgUnitIds is null||request.SubTeamOrgUnitIds.Count>250||request.SubTeamOrgUnitIds.Contains(Guid.Empty))throw new WorkflowValidationException("Select valid sub-teams.");
        ProcessReviewDetail? existing=null;
        if(request.RecordId.HasValue)
        {
            existing=await GetProcessReviewAsync(request.RecordId.Value,user,ct);
            if(existing is null||existing.ProcessKey!=ProcessReviewRules.Activate||!existing.CanEdit)throw new UnauthorizedAccessException("You cannot amend this review’s scope.");
        }
        var units=await QueryAsync("""
            WITH descendants AS(
                SELECT id,parent_org_unit_id,name,org_unit_type,0 AS depth FROM org.org_units
                WHERE id=@faculty AND org_unit_type=N'faculty' AND is_active=1 AND archived_at IS NULL
                UNION ALL SELECT child.id,child.parent_org_unit_id,child.name,child.org_unit_type,parent.depth+1
                FROM org.org_units child JOIN descendants parent ON child.parent_org_unit_id=parent.id
                WHERE child.is_active=1 AND child.archived_at IS NULL AND parent.depth<32)
            SELECT node.id,node.parent_org_unit_id,node.name,node.org_unit_type,parent.name,
                CONVERT(bit,CASE WHEN @all=1 OR EXISTS(SELECT 1 FROM org.fn_visible_org_units(@user) scope WHERE scope.org_unit_id=node.id) THEN 1 ELSE 0 END)
            FROM descendants node LEFT JOIN org.org_units parent ON parent.id=node.parent_org_unit_id ORDER BY node.name OPTION(MAXRECURSION 32);
            """,command=>{command.Parameters.AddWithValue("@faculty",request.FacultyOrgUnitId);command.Parameters.AddWithValue("@all",user.IsAdministrator||ProcessReviewRules.CanManageConfiguration(user));command.Parameters.AddWithValue("@user",ToDbValue(user.UserAccountId));},
            reader=>new{Scope=new ProcessReviewOrgScope(reader.GetGuid(0),reader.GetString(2),GetGuidOrNull(reader,1),GetStringOrNull(reader,4),reader.GetString(3)),Visible=reader.GetBoolean(5)},ct);
        var faculty=units.FirstOrDefault(x=>x.Scope.OrgUnitId==request.FacultyOrgUnitId);
        if(faculty is null)throw new WorkflowValidationException("Select an active faculty or review area.");
        var available=units.Where(x=>x.Scope.OrgUnitId!=request.FacultyOrgUnitId&&x.Visible).Select(x=>x.Scope).ToArray();
        if(existing?.Data.Activate is {} saved&&existing.FacultyOrgUnitId==request.FacultyOrgUnitId&&(existing.IsFollowUp||existing.RecordDate==request.RecordDate)
            &&saved.AllSubTeams==request.AllSubTeams&&saved.SubTeamOrgUnitIds.Order().SequenceEqual(request.SubTeamOrgUnitIds.Order())
            &&existing.Participants is not null&&existing.SelectedSubTeams is not null)
        {
            var frozen=(saved.AutomaticParticipants??existing.Participants).Where(x=>x.IsLocked||x.Roles.Contains("Programme leader")).ToArray();
            var known=available.Concat(existing.SelectedSubTeams).DistinctBy(x=>x.OrgUnitId).OrderBy(x=>x.Name).ToArray();
            return new(request.FacultyOrgUnitId,faculty.Scope.Name,known,saved.SubTeamOrgUnitIds,frozen,
                frozen.Any(x=>x.Roles.Contains("Head of faculty"))?[]:["No head of faculty was assigned when this review’s participant list was recorded."]);
        }
        var leaves=units.Where(x=>x.Scope.OrgUnitId!=request.FacultyOrgUnitId&&!units.Any(child=>child.Scope.ParentOrgUnitId==x.Scope.OrgUnitId)).ToArray();
        var chosen=new HashSet<Guid>();
        if(request.AllSubTeams)
        {
            if(!faculty.Visible||leaves.Any(x=>!x.Visible))throw new UnauthorizedAccessException("You do not have access to every sub-team in this faculty. Choose your authorised sub-teams instead.");
            chosen.UnionWith(leaves.Select(x=>x.Scope.OrgUnitId));
        }
        else
        {
            foreach(var selected in request.SubTeamOrgUnitIds.Distinct())
            {
                if(!available.Any(x=>x.OrgUnitId==selected))throw new UnauthorizedAccessException("A selected sub-team is outside this faculty or your scope.");
                foreach(var leaf in leaves.Where(x=>IsActivateDescendant(x.Scope.OrgUnitId,selected,units.Select(x=>x.Scope).ToArray())))
                {if(!leaf.Visible)throw new UnauthorizedAccessException("That area includes sub-teams outside your access scope.");chosen.Add(leaf.Scope.OrgUnitId);}
            }
        }
        var ownerId=existing?.OwnerStaffId??user.StaffId??throw new UnauthorizedAccessException("Complete your staff account before creating a review.");
        var when=request.RecordDate??DateOnly.FromDateTime(DateTime.UtcNow);
        var leaders=await QueryAsync("""
            SELECT leadership.org_unit_id,staff.id,staff.display_name
            FROM org.org_unit_leaderships leadership JOIN people.staff staff ON staff.id=leadership.leader_staff_id
            WHERE leadership.org_unit_id IN(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@units))
                AND leadership.leadership_role=N'manager' AND leadership.archived_at IS NULL
                AND leadership.active_from<=@when AND (leadership.active_to IS NULL OR leadership.active_to>=@when)
                AND staff.archived_at IS NULL AND staff.account_status=N'active';
            """,command=>{command.Parameters.AddWithValue("@units",JsonSerializer.Serialize(units.Select(x=>x.Scope.OrgUnitId)));command.Parameters.AddWithValue("@when",when.ToDateTime(TimeOnly.MinValue));},
            reader=>new{UnitId=reader.GetGuid(0),StaffId=reader.GetGuid(1),Name=reader.GetString(2)},ct);
        var people=new Dictionary<Guid,ProcessReviewParticipant>();
        void Add(Guid id,string name,string role,bool locked,string unit)
        {
            if(people.TryGetValue(id,out var old))people[id]=old with{Roles=old.Roles.Append(role).Distinct().ToArray(),IsLocked=old.IsLocked||locked,OrgUnitNames=old.OrgUnitNames.Append(unit).Distinct().ToArray()};
            else people[id]=new(id,name,[role],locked,[unit]);
        }
        var ownerNames=await QueryAsync("SELECT display_name FROM people.staff WHERE id=@id;",command=>command.Parameters.AddWithValue("@id",ownerId),reader=>reader.GetString(0),ct);
        Add(ownerId,ownerNames.Single(),"Review owner",true,faculty.Scope.Name);
        var warnings=new List<string>();
        var heads=leaders.Where(x=>x.UnitId==request.FacultyOrgUnitId).ToArray();
        foreach(var head in heads)Add(head.StaffId,head.Name,"Head of faculty",true,faculty.Scope.Name);
        if(heads.Length==0)warnings.Add("No effective head of faculty is configured for the review date. Organisation leadership can be updated in Admin.");
        foreach(var id in chosen)
        {
            var unit=units.Single(x=>x.Scope.OrgUnitId==id).Scope;var cursor=unit;
            while(true)
            {
                var assigned=leaders.Where(x=>x.UnitId==cursor.OrgUnitId).ToArray();
                if(assigned.Length>0){foreach(var leader in assigned)Add(leader.StaffId,leader.Name,"Programme leader",false,unit.Name);break;}
                if(!cursor.ParentOrgUnitId.HasValue||cursor.ParentOrgUnitId==request.FacultyOrgUnitId)
                {warnings.Add($"No effective programme leader is configured for {unit.Name} on the review date.");break;}
                cursor=units.Single(x=>x.Scope.OrgUnitId==cursor.ParentOrgUnitId).Scope;
            }
        }
        return new(request.FacultyOrgUnitId,faculty.Scope.Name,available,chosen.Order().ToArray(),people.Values.OrderByDescending(x=>x.IsLocked).ThenBy(x=>x.DisplayName).ToArray(),warnings);
    }

    private static bool IsActivateDescendant(Guid child,Guid parent,IReadOnlyList<ProcessReviewOrgScope> units)
    {
        var cursor=units.FirstOrDefault(x=>x.OrgUnitId==child);
        for(var depth=0;cursor is not null&&depth<34;depth++)
        {if(cursor.OrgUnitId==parent)return true;cursor=cursor.ParentOrgUnitId.HasValue?units.FirstOrDefault(x=>x.OrgUnitId==cursor.ParentOrgUnitId):null;}
        return false;
    }

    private async Task<(SaveProcessReviewRequest Request,IReadOnlyList<ProcessReviewOrgScope> Scopes,IReadOnlyList<ProcessReviewParticipant> Participants)> NormalizeActivateReviewAsync(
        SaveProcessReviewRequest request,ProcessReviewDetail? existing,CurrentUser user,CancellationToken ct)
    {
        var data=request.Data.Activate!;
        IReadOnlyList<ProcessReviewOrgScope> scopes;IReadOnlyList<ProcessReviewParticipant> defaults;
        if(!request.FacultyOrgUnitId.HasValue)
        {
            if(request.Submit)throw new WorkflowValidationException("Select the faculty or area for this review.");
            scopes=[];defaults=[new(existing?.OwnerStaffId??user.StaffId!.Value,existing?.OwnerName??user.DisplayName,["Review owner"],true,[])];
        }
        else
        {
            var same=existing?.Data.Activate is {} prior&&existing.FacultyOrgUnitId==request.FacultyOrgUnitId&&(existing.IsFollowUp||existing.RecordDate==request.RecordDate)
                &&prior.AllSubTeams==data.AllSubTeams&&prior.SubTeamOrgUnitIds.Order().SequenceEqual(data.SubTeamOrgUnitIds.Order());
            if(same&&existing!.Participants is not null&&existing.SelectedSubTeams is not null){scopes=existing.SelectedSubTeams;defaults=existing.Data.Activate!.AutomaticParticipants??existing.Participants;}
            else
            {
                var context=await ResolveActivateReviewContextAsync(new(request.FacultyOrgUnitId.Value,data.AllSubTeams,data.SubTeamOrgUnitIds,existing?.RecordId,request.RecordDate),user,ct);
                scopes=context.AvailableSubTeams.Where(x=>context.SelectedSubTeamOrgUnitIds.Contains(x.OrgUnitId)).ToArray();defaults=context.Participants;
            }
        }
        var removed=data.RemovedProgrammeLeaderStaffIds.ToHashSet();
        if(defaults.Any(x=>x.IsLocked&&removed.Contains(x.StaffId)))throw new WorkflowValidationException("The review owner and head of faculty must remain participants.");
        var chosen=defaults.Where(x=>x.IsLocked||!removed.Contains(x.StaffId)&&(x.Roles.Contains("Programme leader")||data.ParticipantStaffIds.Contains(x.StaffId))).ToDictionary(x=>x.StaffId);
        var extras=data.ParticipantStaffIds.Where(id=>!chosen.ContainsKey(id)&&!removed.Contains(id)).Distinct().ToArray();
        if(extras.Length>0)
        {
            await using var connection=await OpenConnectionAsync(ct);await using var transaction=(SqlTransaction)await connection.BeginTransactionAsync(ct);
            await ValidateProcessSampleStaffAsync(connection,transaction,[new("participants","Participants","staff",null,null,extras,null,null)],user,ct);
            await transaction.CommitAsync(ct);
            var names=await QueryAsync("SELECT id,display_name FROM people.staff WHERE id IN(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@ids));",
                command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(extras)),reader=>new{Id=reader.GetGuid(0),Name=reader.GetString(1)},ct);
            foreach(var person in names)chosen[person.Id]=new(person.Id,person.Name,["Additional participant"],false,[]);
        }
        var participants=chosen.Values.OrderByDescending(x=>x.IsLocked).ThenBy(x=>x.DisplayName).ToArray();
        data=data with{SubTeamOrgUnitIds=scopes.Select(x=>x.OrgUnitId).ToArray(),ParticipantStaffIds=participants.Select(x=>x.StaffId).ToArray(),
            HeadOfFacultyStaffIds=participants.Where(x=>x.Roles.Contains("Head of faculty")).Select(x=>x.StaffId).ToArray(),
            ProgrammeLeaderStaffIds=participants.Where(x=>x.Roles.Contains("Programme leader")).Select(x=>x.StaffId).ToArray(),
            AutomaticParticipants=defaults.Where(x=>x.IsLocked||x.Roles.Contains("Programme leader")).ToArray()};
        return(request with{TeamOrgUnitId=null,Data=request.Data with{Activate=data}},scopes,participants);
    }

    private static async Task SaveActivateReviewContextAsync(SqlConnection connection,SqlTransaction transaction,Guid recordId,
        IReadOnlyList<ProcessReviewOrgScope> scopes,IReadOnlyList<ProcessReviewParticipant> participants,CancellationToken ct)
    {
        await using var command=new SqlCommand("""
            DELETE quality.process_review_scopes WHERE record_id=@id;
            INSERT quality.process_review_scopes(record_id,org_unit_id,name_snapshot,parent_org_unit_id_snapshot,parent_name_snapshot,org_unit_type_snapshot)
            SELECT @id,orgUnitId,name,parentOrgUnitId,parentName,orgUnitType FROM OPENJSON(@scopes)
                WITH(orgUnitId uniqueidentifier,name nvarchar(300),parentOrgUnitId uniqueidentifier,parentName nvarchar(300),orgUnitType nvarchar(100));
            DELETE quality.process_review_participants WHERE record_id=@id;
            INSERT quality.process_review_participants(record_id,staff_id,display_name_snapshot,roles_json,is_locked,org_unit_names_json)
            SELECT @id,staffId,displayName,roles,isLocked,orgUnitNames FROM OPENJSON(@participants)
                WITH(staffId uniqueidentifier,displayName nvarchar(300),roles nvarchar(max) AS JSON,isLocked bit,orgUnitNames nvarchar(max) AS JSON);
            """,connection,transaction);
        command.Parameters.AddWithValue("@id",recordId);command.Parameters.AddWithValue("@scopes",JsonSerializer.Serialize(scopes,ProcessJson));command.Parameters.AddWithValue("@participants",JsonSerializer.Serialize(participants,ProcessJson));
        await command.ExecuteNonQueryAsync(ct);
    }

    private async Task<IReadOnlyList<ProcessRow>> HydrateActivateReviewRowsAsync(IReadOnlyList<ProcessRow> rows,CancellationToken ct)
    {
        var ids=rows.Where(x=>x.ProcessKey==ProcessReviewRules.Activate&&x.Data.Activate is not null).Select(x=>x.RecordId).ToArray();
        if(ids.Length==0)return rows;
        var scopes=await QueryAsync("""
            SELECT scope.record_id,scope.org_unit_id,scope.name_snapshot,scope.parent_org_unit_id_snapshot,scope.parent_name_snapshot,scope.org_unit_type_snapshot
            FROM quality.process_review_scopes scope
            WHERE scope.record_id IN(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@ids));
            """,command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(ids)),reader=>new
            {Id=reader.GetGuid(0),Scope=new ProcessReviewOrgScope(reader.GetGuid(1),reader.GetString(2),GetGuidOrNull(reader,3),GetStringOrNull(reader,4),GetStringOrNull(reader,5))},ct);
        var participants=await QueryAsync("""
            SELECT record_id,staff_id,display_name_snapshot,roles_json,is_locked,org_unit_names_json
            FROM quality.process_review_participants WHERE record_id IN(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@ids));
            """,command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(ids)),reader=>new
            {Id=reader.GetGuid(0),Person=new ProcessReviewParticipant(reader.GetGuid(1),reader.GetString(2),JsonSerializer.Deserialize<string[]>(reader.GetString(3))!,reader.GetBoolean(4),JsonSerializer.Deserialize<string[]>(reader.GetString(5))!)},ct);
        var byScope=scopes.ToLookup(x=>x.Id,x=>x.Scope);var byPerson=participants.ToLookup(x=>x.Id,x=>x.Person);
        return rows.Select(row=>row.ProcessKey!=ProcessReviewRules.Activate||row.Data.Activate is null?row:row with
            {SelectedSubTeams=byScope[row.RecordId].OrderBy(x=>x.Name).ToArray(),Participants=byPerson[row.RecordId].OrderByDescending(x=>x.IsLocked).ThenBy(x=>x.DisplayName).ToArray()}).ToArray();
    }
}
