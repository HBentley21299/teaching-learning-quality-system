using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<ExportWorkbookData> GetProcessReviewExportAsync(string processKey,string? academicYear,CurrentUser user,CancellationToken ct,string? applicationUrl=null)
    {
        var reviews=await ReadProcessRowsAsync(processKey,academicYear,null,user,ct);
        var config=await GetProcessReviewConfigurationAsync(processKey,ct);
        var ids=reviews.Select(x=>x.RecordId).ToHashSet();
        var actionSources=ids.Concat(reviews.SelectMany(x=>x.AncestorReviewIds??[])).ToHashSet();
        var actions=(await ReadProcessActionsAsync(processKey,processKey==ProcessReviewRules.Activate?null:academicYear,null,null,user,true,ct,sourceRecordIds:actionSources.ToArray()))
            .Where(x=>actionSources.Contains(x.RecordId)).ToArray();
        var staffIds=reviews.SelectMany(x=>x.Data.Samples.SelectMany(s=>s.StaffIds))
            .Concat(reviews.SelectMany(x=>x.Data.Fields.Values.SelectMany(ProcessExportStaffIds))).Distinct().ToArray();
        var staff=staffIds.Length==0?new Dictionary<Guid,string>():
            (await QueryAsync("SELECT id,display_name FROM people.staff WHERE id IN (SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@ids));",
                command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(staffIds)),reader=>new{Id=reader.GetGuid(0),Name=reader.GetString(1)},ct)).ToDictionary(x=>x.Id,x=>x.Name);
        var fields=reviews.SelectMany(x=>x.Configuration.FieldLabels.Keys.Concat(x.Data.Fields.Keys)).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
        var labels=fields.Select(key=>ProcessExportFieldLabel(key,reviews.Select(x=>x.Configuration))).ToArray();
        var primaryRows=reviews.Select(row=>(IReadOnlyList<string?>)new string?[]{row.RecordId.ToString(),row.Title,row.AcademicYear,row.FacultyName,row.TeamName,row.OwnerName,
            row.RecordDate?.ToString("yyyy-MM-dd"),row.Status,row.Configuration.Version.ToString(),row.SnapshotAsOf?.ToString("yyyy-MM-dd")}
            .Concat(fields.Select(key=>ProcessExportField(row.Data.Fields.GetValueOrDefault(key),row.Configuration,staff))).ToArray()).ToArray();
        var sheets=new List<ExportSheet>{new("Form entries",new[]{"Record ID","Title","Academic year","Faculty","Team / area","Review owner","Review date","Status","Form version","Latest snapshot as of"}.Concat(labels).ToArray(),primaryRows,false)};
        if(processKey==ProcessReviewRules.Activate)
        {
            sheets.Clear();
            var configurations=reviews.Select(x=>x.Configuration).Append(config).ToArray();
            var pillars=configurations.SelectMany(x=>x.SkillsScanPillars??[]).DistinctBy(x=>x.Key).ToArray();
            var subAreas=pillars.SelectMany(pillar=>configurations.SelectMany(x=>x.SkillsScanPillars??[]).Where(x=>x.Key==pillar.Key)
                .SelectMany(x=>x.SubAreas).DistinctBy(x=>x.Key).Select(area=>(Pillar:pillar,Area:area))).ToArray();
            string PillarLabel(string key)=>string.Join(" / ",configurations.SelectMany(x=>x.SkillsScanPillars??[]).Where(x=>x.Key==key).Select(x=>x.Title).Distinct());
            string AreaLabel(string key)=>string.Join(" / ",configurations.SelectMany(x=>x.SkillsScanPillars??[]).SelectMany(x=>x.SubAreas).Where(x=>x.Key==key).Select(x=>x.Title).Distinct());
            var hasEarlierFollowUpDate=reviews.Any(x=>x.Data.Activate?.FollowUpDate is not null);
            sheets.Add(new("Form entries",new[]{"Record ID","Title","Academic year","Faculty","Selected sub-teams","Scope selection","Review owner","Conducted date","Review type","Previous review","Previous review conducted","Linked follow-up reviews",
                    "Head of faculty","Programme leaders participating","Participants","Meeting minutes","Areas of strength","Areas for development","Status","Form version"}
                .Concat(hasEarlierFollowUpDate?["Earlier planned follow-up date"]:Array.Empty<string>())
                .Concat(subAreas.Select(x=>AreaLabel(x.Area.Key)+" — entered average (1–5)"))
                .Concat(pillars.Select(x=>PillarLabel(x.Key)+" — pillar mean (complete submitted results only)")).ToArray(),
                reviews.Select(row=>(IReadOnlyList<string?>)new string?[]{row.RecordId.ToString(),row.Title,row.AcademicYear,row.FacultyName,
                    string.Join("; ",(row.SelectedSubTeams??[]).Select(ProcessExportScopeName)),row.Data.Activate is null?"Historical record":row.Data.Activate.AllSubTeams?"All sub-teams at review setup":"Selected sub-teams",
                    row.OwnerName,row.RecordDate?.ToString("yyyy-MM-dd"),row.IsFollowUp?"Follow-up":"Initial review",row.ParentReview?.Title,row.ParentReview?.RecordDate?.ToString("yyyy-MM-dd"),
                    string.Join("; ",(row.FollowUpReviews??[]).Select(link=>$"{link.Title} ({link.AcademicYear}, {link.Status})")),
                    ProcessExportParticipants(row.Participants,"Head of faculty"),ProcessExportParticipants(row.Participants,"Programme leader"),ProcessExportParticipants(row.Participants),
                    row.Data.Activate?.MeetingMinutes,row.Data.Activate?.Strengths,row.Data.Activate?.Development,row.Status,row.Configuration.Version.ToString()}
                    .Concat(hasEarlierFollowUpDate?[row.Data.Activate?.FollowUpDate?.ToString("yyyy-MM-dd")]:Array.Empty<string?>())
                    .Concat(subAreas.Select(x=>ProcessExportScore(row.Data.Activate?.SkillsScanScores.GetValueOrDefault(x.Area.Key))))
                    .Concat(pillars.Select(x=>ProcessExportScore(row.Status=="submitted"?ProcessExportPillarMean(row.Configuration.SkillsScanPillars?.FirstOrDefault(p=>p.Key==x.Key),row.Data.Activate?.SkillsScanScores):null))).ToArray()).ToArray(),false,
                new[]{"text","text","text","text","text","text","text","date","text","text","date","text","text","text","text","text","text","text","text","number"}
                    .Concat(hasEarlierFollowUpDate?["date"]:Array.Empty<string>())
                    .Concat(Enumerable.Repeat("number",subAreas.Length+pillars.Length)).ToArray()));
            sheets.Add(new("Skills Scan",["Record ID","Pillar","Sub-area","Entered average (1–5)","Result status","Pillar mean (complete submitted results only)"],
                reviews.SelectMany(row=>(row.Configuration.SkillsScanPillars??[]).SelectMany(pillar=>pillar.SubAreas.Select(area=>
                {
                    var score=row.Data.Activate?.SkillsScanScores.GetValueOrDefault(area.Key);
                    return (IReadOnlyList<string?>)new string?[]{row.RecordId.ToString(),pillar.Title,area.Title,ProcessExportScore(score),
                        score.HasValue?"Entered":"Not entered",ProcessExportScore(row.Status=="submitted"?ProcessExportPillarMean(pillar,row.Data.Activate?.SkillsScanScores):null)};
                }))).ToArray(),false,["text","text","text","number","text","number"]));
            sheets.Add(new("Review links",["Record ID","Relationship","Linked review","Academic year","Conducted date","Status"],
                reviews.SelectMany(row=>(row.ParentReview is {} parent?new[]{(Link:parent,Relationship:"Follow-up to")}:[])
                    .Concat((row.FollowUpReviews??[]).Select(link=>(Link:link,Relationship:"Follow-up review")))
                    .Select(link=>(IReadOnlyList<string?>)new string?[]{row.RecordId.ToString(),link.Relationship,link.Link.Title,link.Link.AcademicYear,link.Link.RecordDate?.ToString("yyyy-MM-dd"),link.Link.Status})).ToArray(),false,
                ["text","text","text","text","date","text"]));
            var previousContexts=reviews.Where(row=>row.ParentReviewContext is not null).ToArray();
            if(previousContexts.Length>0)
            {
                sheets.Add(new("Previous review",["Record ID","Previous review","Academic year","Conducted date","Status when linked","Previous meeting minutes","Previous strengths","Previous areas for development"],
                    previousContexts.Select(row=>(IReadOnlyList<string?>)new string?[]{row.RecordId.ToString(),row.ParentReviewContext!.Review.Title,row.ParentReviewContext.Review.AcademicYear,
                        row.ParentReviewContext.Review.RecordDate?.ToString("yyyy-MM-dd"),row.ParentReviewContext.Review.Status,row.ParentReviewContext.MeetingMinutes,row.ParentReviewContext.Strengths,row.ParentReviewContext.Development}).ToArray(),false,
                    ["text","text","text","date","text","text","text","text"]));
                sheets.Add(new("Previous Skills Scan",["Record ID","Previous review","Pillar","Sub-area","Previous entered average (1–5)","Previous result status","Previous pillar mean (complete submitted results only)"],
                    previousContexts.SelectMany(row=>(row.ParentReviewContext!.Configuration.SkillsScanPillars??[]).SelectMany(pillar=>pillar.SubAreas.Select(area=>
                    {
                        var previous=row.ParentReviewContext!;var score=previous.SkillsScanScores.GetValueOrDefault(area.Key);
                        return (IReadOnlyList<string?>)new string?[]{row.RecordId.ToString(),previous.Review.Title,pillar.Title,area.Title,ProcessExportScore(score),score.HasValue?"Previously entered":"Not entered",
                            ProcessExportScore(previous.Review.Status=="submitted"?ProcessExportPillarMean(pillar,previous.SkillsScanScores):null)};
                    }))).ToArray(),false,["text","text","text","text","number","text","number"]));
            }
            sheets.Add(new("Review scope",["Record ID","Faculty","Area","Sub-team"],reviews.SelectMany(row=>(row.SelectedSubTeams??[]).Select(scope=>(IReadOnlyList<string?>)new string?[]{
                row.RecordId.ToString(),row.FacultyName,scope.ParentName,scope.Name})).ToArray(),false));
            sheets.Add(new("Participants",["Record ID","Participant","Role","Associated teams / areas"],reviews.SelectMany(row=>(row.Participants??[]).Select(person=>(IReadOnlyList<string?>)new string?[]{
                row.RecordId.ToString(),person.DisplayName,string.Join("; ",person.Roles),string.Join("; ",person.OrgUnitNames)})).ToArray(),false));
            var legacy=reviews.Where(x=>x.Data.Fields.Count>0).ToArray();
            if(legacy.Length>0)
            {
                var historicalFields=legacy.SelectMany(x=>x.Data.Fields.Keys).Distinct().Order(StringComparer.Ordinal).ToArray();
                sheets.Add(new("Historical form",new[]{"Record ID","Title"}.Concat(historicalFields.Select(key=>ProcessExportFieldLabel(key,legacy.Select(x=>x.LegacyConfiguration??x.Configuration)))).ToArray(),
                    legacy.Select(row=>(IReadOnlyList<string?>)new string?[]{row.RecordId.ToString(),row.Title}.Concat(historicalFields.Select(key=>ProcessExportField(row.Data.Fields.GetValueOrDefault(key),row.LegacyConfiguration??row.Configuration,staff))).ToArray()).ToArray(),false));
            }
        }
        if(processKey==ProcessReviewRules.Digital)
        {
            sheets.Add(new("Samples",["Record ID","Sample reference","Sample","Type","Date","Course / group","Associated staff","Evidence link","Evidence notes"],
                reviews.SelectMany(row=>row.Data.Samples.Select(sample=>(IReadOnlyList<string?>)new string?[]{row.RecordId.ToString(),sample.Id,sample.Title,sample.SampleType,
                    sample.SampleDate?.ToString("yyyy-MM-dd"),sample.Course,string.Join("; ",sample.StaffIds.Select(id=>staff.GetValueOrDefault(id,"Staff member no longer available"))),sample.EvidenceLink,sample.Notes})).ToArray(),false));
            sheets.Add(new("Responses",["Record ID","Standard","Statement","Overall rating","Evidence and rationale"],
                reviews.SelectMany(row=>row.Configuration.Standards.SelectMany(standard=>standard.Statements.Select(statement=>
                {
                    var response=row.Data.Responses.FirstOrDefault(x=>x.StatementKey==statement.Key);
                    return (IReadOnlyList<string?>)new string?[]{row.RecordId.ToString(),standard.Title,statement.Text,
                        row.Configuration.RatingOptions.FirstOrDefault(x=>x.Key==response?.RatingKey)?.Label,response?.Rationale};
                }))).ToArray(),false));
            sheets.Add(new("Sample links",["Record ID","Statement","Sample reference","Sample"],
                reviews.SelectMany(row=>row.Data.Responses.SelectMany(response=>response.SampleIds.Select(sampleId=>(IReadOnlyList<string?>)new string?[]{row.RecordId.ToString(),
                    row.Configuration.Standards.SelectMany(x=>x.Statements).FirstOrDefault(x=>x.Key==response.StatementKey)?.Text,sampleId,row.Data.Samples.FirstOrDefault(x=>x.Id==sampleId)?.Title}))).ToArray(),false));
        }
        else
        {
            var snapshots=await QueryAsync("""
                SELECT snapshot.record_id,snapshot.as_of_date,snapshot.source_meeting,snapshot.teams_link,snapshot.recorded_at,
                    staff.display_name,snapshot.data_json FROM quality.process_review_snapshots snapshot
                JOIN OPENJSON(@ids) selected ON snapshot.record_id=TRY_CONVERT(uniqueidentifier,selected.value)
                JOIN auth.user_accounts account ON account.id=snapshot.recorded_by_user_account_id JOIN people.staff staff ON staff.id=account.staff_id
                ORDER BY snapshot.recorded_at DESC;
                """,command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(ids)),reader=>new
                {RecordId=reader.GetGuid(0),AsOf=DateOnly.FromDateTime(reader.GetDateTime(1)),Meeting=reader.GetString(2),Teams=reader.GetString(3),RecordedAt=reader.GetFieldValue<DateTimeOffset>(4),
                    By=reader.GetString(5),Data=JsonSerializer.Deserialize<ProcessReviewData>(reader.GetString(6),ProcessJson)!},ct);
            var historicalStaffIds=snapshots.SelectMany(x=>x.Data.Fields.Values.SelectMany(ProcessExportStaffIds)).Distinct().Where(id=>!staff.ContainsKey(id)).ToArray();
            if(historicalStaffIds.Length>0)
            {
                var historicalStaff=await QueryAsync("SELECT id,display_name FROM people.staff WHERE id IN (SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@ids));",
                    command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(historicalStaffIds)),reader=>new{Id=reader.GetGuid(0),Name=reader.GetString(1)},ct);
                foreach(var person in historicalStaff)staff[person.Id]=person.Name;
            }
            var snapshotFields=fields.Union(snapshots.SelectMany(x=>x.Data.Fields.Keys)).Order(StringComparer.Ordinal).ToArray();
            if(snapshots.Count>0)sheets.Add(new("Snapshots",new[]{"Record ID","Snapshot as of","Source meeting","Historical Teams proforma link","Recorded at (UTC)","Recorded by"}
                .Concat(snapshotFields.Select(key=>ProcessExportFieldLabel(key,reviews.Select(x=>x.LegacyConfiguration??x.Configuration)))).ToArray(),snapshots.Select(snapshot=>(IReadOnlyList<string?>)new string?[]{snapshot.RecordId.ToString(),snapshot.AsOf.ToString("yyyy-MM-dd"),snapshot.Meeting,snapshot.Teams,snapshot.RecordedAt.ToString("O"),snapshot.By}
                .Concat(snapshotFields.Select(key=>ProcessExportField(snapshot.Data.Fields.GetValueOrDefault(key),reviews.First(x=>x.RecordId==snapshot.RecordId).LegacyConfiguration??reviews.First(x=>x.RecordId==snapshot.RecordId).Configuration,staff))).ToArray()).ToArray(),false));
        }
        if(processKey==ProcessReviewRules.Activate)
        {
            sheets.Add(new("Actions",["Record ID","Source review","Source academic year","Associated reviews in this export","Action theme","Area of impact","Action detail","Impact measures","Responsible","Review date","Progress","Action link"],
                actions.Select(action=>(IReadOnlyList<string?>)new string?[]{ProcessExportActionRecordId(action,reviews),action.RecordTitle,action.AcademicYear,
                    string.Join("; ",reviews.Where(row=>row.RecordId==action.RecordId||row.AncestorReviewIds?.Contains(action.RecordId)==true).Select(row=>$"{row.Title} ({row.AcademicYear})")),
                    action.ThemeLabel,action.ImpactAreaLabel,action.Detail??action.Title,action.SuccessEvidence,
                    action.ResponsibleStaff is {Count:>0}?string.Join("; ",action.ResponsibleStaff.Select(x=>x.DisplayName)):action.OwnerName,
                    (action.ReviewDate??action.DueDate).ToString("yyyy-MM-dd"),ProcessExportLabel(action.Progress),ProcessExportActionLink(applicationUrl,action.ActionId)}).ToArray(),false,
                ["text","text","text","text","text","text","text","text","text","date","text","text"]));
            sheets.Add(new("Updates",["Record ID","Action","Update date (UTC)","Updated by","Progress","Progress note","Evidence link","Barriers","Next step","Review date","Review date change reason"],
                actions.SelectMany(action=>action.Updates.Select(update=>(IReadOnlyList<string?>)new string?[]{ProcessExportActionRecordId(action,reviews),action.Detail??action.Title,update.UpdatedAt.ToString("O"),update.UpdatedByName,ProcessExportLabel(update.Progress),
                    update.ProgressNote,update.EvidenceLink,update.Barriers,update.NextStep,update.DueDate.ToString("yyyy-MM-dd"),update.DeadlineChangeReason})).ToArray(),false,
                ["text","text","datetime","text","text","text","text","text","text","date","text"]));
            var historicalActions=actions.Where(x=>!string.IsNullOrWhiteSpace(x.SupportRequired)||x.ImpactStatus!="awaiting_evidence"||!string.IsNullOrWhiteSpace(x.ImpactEvidence)||!string.IsNullOrWhiteSpace(x.ImpactEvidenceLink)).ToArray();
            if(historicalActions.Length>0)sheets.Add(new("Historical action detail",["Record ID","Action","Support required","Impact assessment","Impact evidence","Impact evidence link"],
                historicalActions.Select(action=>(IReadOnlyList<string?>)new string?[]{ProcessExportActionRecordId(action,reviews),action.Title,action.SupportRequired,ProcessExportLabel(action.ImpactStatus),action.ImpactEvidence,action.ImpactEvidenceLink}).ToArray(),false));
            var historicalImpactUpdates=actions.SelectMany(action=>action.Updates.Where(update=>update.ImpactStatus!="awaiting_evidence"||!string.IsNullOrWhiteSpace(update.ImpactEvidence)||!string.IsNullOrWhiteSpace(update.ImpactEvidenceLink))
                .Select(update=>(IReadOnlyList<string?>)new string?[]{ProcessExportActionRecordId(action,reviews),action.Title,update.UpdatedAt.ToString("O"),update.UpdatedByName,
                    ProcessExportLabel(update.ImpactStatus),update.ImpactEvidence,update.ImpactEvidenceLink})).ToArray();
            if(historicalImpactUpdates.Length>0)sheets.Add(new("Historical impact updates",["Record ID","Action","Update date (UTC)","Updated by","Impact assessment","Impact evidence","Impact evidence link"],
                historicalImpactUpdates,false,["text","text","datetime","text","text","text","text"]));
        }
        else
        {
        sheets.Add(new("Actions",["Record ID","Action","Relevant standard / specialist area","Owner","Completion date","Support required","Success evidence","Progress","Impact assessment","Impact evidence","Impact evidence link","Action link"],
            actions.Select(action=>(IReadOnlyList<string?>)new string?[]{action.RecordId.ToString(),action.Title,
                action.ThemeLabel??reviews.First(x=>x.RecordId==action.RecordId).Configuration.Standards.FirstOrDefault(x=>x.Key==action.ThemeKey)?.Title,action.OwnerName,
                action.DueDate.ToString("yyyy-MM-dd"),action.SupportRequired,action.SuccessEvidence,ProcessExportLabel(action.Progress),ProcessExportLabel(action.ImpactStatus),action.ImpactEvidence,action.ImpactEvidenceLink,ProcessExportActionLink(applicationUrl,action.ActionId)}).ToArray(),false));
        sheets.Add(new("Updates",["Record ID","Action","Update date (UTC)","Updated by","Progress","Progress note","Evidence link","Barriers","Next step","Completion date","Deadline change reason","Impact assessment","Impact evidence","Impact evidence link"],
            actions.SelectMany(action=>action.Updates.Select(update=>(IReadOnlyList<string?>)new string?[]{action.RecordId.ToString(),action.Title,update.UpdatedAt.ToString("O"),update.UpdatedByName,ProcessExportLabel(update.Progress),
                update.ProgressNote,update.EvidenceLink,update.Barriers,update.NextStep,update.DueDate.ToString("yyyy-MM-dd"),update.DeadlineChangeReason,ProcessExportLabel(update.ImpactStatus),update.ImpactEvidence,update.ImpactEvidenceLink})).ToArray(),false));
        }
        return new ExportWorkbookData(processKey,config.Title,new ExportFilter(academicYear,null,null,null,null,null,null,null,processKey),user.DisplayName,DateTimeOffset.UtcNow,sheets);
    }

    private static string ProcessExportActionRecordId(ProcessReviewAction action,IReadOnlyList<ProcessRow> reviews)=>
        (reviews.FirstOrDefault(row=>row.RecordId==action.RecordId)??reviews.First(row=>row.AncestorReviewIds?.Contains(action.RecordId)==true)).RecordId.ToString();
    private static string ProcessExportScopeName(ProcessReviewOrgScope scope)=>string.IsNullOrWhiteSpace(scope.ParentName)?scope.Name:$"{scope.ParentName} / {scope.Name}";
    private static string ProcessExportParticipants(IReadOnlyList<ProcessReviewParticipant>? participants,string? role=null)=>string.Join("; ",(participants??[]).Where(x=>role is null||x.Roles.Contains(role)).DistinctBy(x=>x.StaffId).Select(x=>x.DisplayName));
    private static string? ProcessExportScore(decimal? score)=>score?.ToString("0.############################",CultureInfo.InvariantCulture);
    // This is a mean of the supplied sub-area averages, not a reconstruction of individual answers.
    private static decimal? ProcessExportPillarMean(ProcessReviewSkillsPillar? pillar,IReadOnlyDictionary<string,decimal?>? scores)
    {
        if(pillar is null||pillar.SubAreas.Count==0||scores is null)return null;
        var values=pillar.SubAreas.Select(x=>scores.GetValueOrDefault(x.Key)).ToArray();
        return values.All(x=>x is >=1 and <=5)?decimal.Round(values.Average(x=>x!.Value),2,MidpointRounding.AwayFromZero):null;
    }

    private static IEnumerable<Guid> ProcessExportStaffIds(string value)
    {
        if(Guid.TryParse(value,out var id))return[id];
        if(!value.TrimStart().StartsWith('['))return[];
        try {return JsonSerializer.Deserialize<string[]>(value)?.Select(x=>Guid.TryParse(x,out var candidate)?candidate:Guid.Empty).Where(x=>x!=Guid.Empty).ToArray()??[];}
        catch(JsonException){return[];}
    }
    private static string? ProcessExportField(string? value,ProcessReviewConfiguration configuration,IReadOnlyDictionary<Guid,string> staff)
    {
        if(string.IsNullOrWhiteSpace(value))return value;
        if(Guid.TryParse(value,out var id))return staff.GetValueOrDefault(id,"Staff member no longer available");
        if(value.TrimStart().StartsWith('['))
        {
            try {return string.Join("; ",JsonSerializer.Deserialize<string[]>(value)?.Select(x=>Guid.TryParse(x,out var candidate)?staff.GetValueOrDefault(candidate,"Staff member no longer available"):
                configuration.Standards.FirstOrDefault(area=>area.Key==x)?.Title??x)??[]);}
            catch(JsonException){return value;}
        }
        return value;
    }
    private static string ProcessExportLabel(string key)=>Regex.Replace(Regex.Replace(key,"([a-z])([A-Z])","$1 $2"),"[_-]+"," ").Trim() is {Length:>0} label
        ? char.ToUpperInvariant(label[0])+label[1..]:key;
    private static string ProcessExportFieldLabel(string key,IEnumerable<ProcessReviewConfiguration> configurations)
    {
        foreach(var configuration in configurations)
        {
            if(configuration.FieldLabels.TryGetValue(key,out var label)&&!string.IsNullOrWhiteSpace(label))return label;
            if(configuration.Standards.FirstOrDefault(x=>key==x.Key+"_summary") is {} area)return area.Title+" summary";
        }
        return ProcessExportLabel(key);
    }
    private static string ProcessExportActionLink(string? applicationUrl,Guid id)=>Uri.TryCreate(applicationUrl,UriKind.Absolute,out var origin)
        && origin.Scheme is "https" or "http" && string.IsNullOrEmpty(origin.UserInfo)
        ? applicationUrl!.TrimEnd('/')+$"/actions/{id}":$"/actions/{id}";
}
