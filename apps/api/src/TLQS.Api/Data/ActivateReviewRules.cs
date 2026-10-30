using TLQS.Api.V1;

namespace TLQS.Api.Data;

public static partial class ProcessReviewRules
{
    public static string? SkillAreaLabel(ProcessReviewConfiguration configuration,string? key)=>key is null?null:
        configuration.SkillsScanPillars?.SelectMany(x=>x.SubAreas).FirstOrDefault(x=>x.Key==key)?.Title??key;
    public static ProcessReviewConfiguration ModernActivateConfiguration(ProcessReviewConfiguration original) => original with
    {
        Version=Math.Max(2,original.Version),SkillsScanPillars=DefaultSkillsScanPillars(),
        ActionThemes=original.Standards.Select(x=>new ProcessReviewActionTheme(x.Key,x.Title)).ToArray(),
        FieldLabels=new Dictionary<string,string>
        {
            ["meetingMinutes"]="Meeting minutes",["strengths"]="Strengths",["development"]="Areas for development",
            ["recordDate"]="Review conducted",["followUpDate"]="Follow-up review date"
        },Settings=new Dictionary<string,string>{{"formJourney","activate_growth_v2"}}
    };
    public static IReadOnlyList<ProcessReviewSkillsPillar> DefaultSkillsScanPillars()=>[
        new("digital_proficiency_productivity","Digital proficiency and productivity",[
            new("digital_proficiency","Digital proficiency"),new("digital_productivity","Digital productivity")]),
        new("information_data_media_literacies","Information, data and media literacies",[
            new("information_literacy","Information literacy"),new("data_literacy","Data literacy"),new("media_literacy","Media literacy")]),
        new("digital_creation_problem_solving_innovation","Digital creation, problem solving and innovation",[
            new("digital_creation","Digital creation"),new("problem_solving","Problem solving"),new("digital_innovation","Digital innovation")]),
        new("digital_communication_collaboration_participation","Digital communication, collaboration and participation",[
            new("digital_communication","Digital communication"),new("digital_collaboration","Digital collaboration"),new("digital_participation","Digital participation")]),
        new("digital_learning_development","Digital learning and development",[
            new("digital_learning","Digital learning"),new("digital_teaching","Digital teaching")]),
        new("digital_identity_wellbeing","Digital identity and wellbeing",[
            new("digital_identity_management","Digital identity management"),new("digital_wellbeing","Digital wellbeing")])
    ];

    private static void ValidateActivateConfiguration(ProcessReviewConfiguration configuration)
    {
        if(configuration.ProcessKey!=Activate)return;
        if(configuration.SkillsScanPillars is null&&configuration.ActionThemes is null)return; // Saved legacy version.
        var pillars=configuration.SkillsScanPillars;
        if(pillars is null||pillars.Count!=6||pillars.Any(x=>x is null||x.SubAreas is null||x.SubAreas.Any(a=>a is null)))Fail("Provide all six Skills Scan pillars and their sub-areas.");
        var expected=DefaultSkillsScanPillars();
        if(!pillars.Select(x=>x.Key).SequenceEqual(expected.Select(x=>x.Key)))Fail("Keep the six Skills Scan pillar identities unchanged.");
        for(var i=0;i<pillars.Count;i++)
        {
            Required(pillars[i].Title,300,"Enter a name for every pillar.");
            if(!pillars[i].SubAreas.Select(x=>x.Key).SequenceEqual(expected[i].SubAreas.Select(x=>x.Key)))Fail("Keep the 15 Skills Scan sub-area identities and pillar grouping unchanged.");
            foreach(var area in pillars[i].SubAreas)Required(area.Title,300,"Enter a label for every Skills Scan sub-area.");
        }
        if(configuration.ActionThemes is null||configuration.ActionThemes.Count!=5||configuration.ActionThemes.Any(x=>x is null))Fail("Provide the five specialist action themes.");
        if(configuration.ActionThemes.Select(x=>x.Key).Distinct(StringComparer.Ordinal).Count()!=5)Fail("Each specialist action theme needs a unique key.");
        foreach(var theme in configuration.ActionThemes){Key(theme.Key);Required(theme.Title,300,"Enter every specialist action theme label.");}
    }

    private static void ValidateActivateData(SaveProcessReviewRequest request,ProcessReviewConfiguration configuration)
    {
        if(configuration.SkillsScanPillars is null)Fail("Refresh the Activate+ form before saving the updated review.");
        var data=request.Data.Activate!;
        if(data.SubTeamOrgUnitIds is null||data.ParticipantStaffIds is null||data.RemovedProgrammeLeaderStaffIds is null||data.SkillsScanScores is null)
            Fail("Provide the selected sub-teams, participants and Skills Scan averages.");
        if(data.SubTeamOrgUnitIds.Count>250||data.SubTeamOrgUnitIds.Contains(Guid.Empty)||data.SubTeamOrgUnitIds.Distinct().Count()!=data.SubTeamOrgUnitIds.Count)
            Fail("Select valid, distinct sub-teams within the review area.");
        if(data.ParticipantStaffIds.Count>250||data.ParticipantStaffIds.Contains(Guid.Empty)||data.RemovedProgrammeLeaderStaffIds.Count>250||data.RemovedProgrammeLeaderStaffIds.Contains(Guid.Empty))
            Fail("Select valid review participants.");
        var keys=configuration.SkillsScanPillars.SelectMany(x=>x.SubAreas).Select(x=>x.Key).ToHashSet(StringComparer.Ordinal);
        if(data.SkillsScanScores.Keys.Any(x=>!keys.Contains(x)))Fail("Enter only the 15 Skills Scan sub-area averages from this form.");
        if(data.SkillsScanScores.Values.Any(x=>x.HasValue&&(x<1m||x>5m)))Fail("Skills Scan averages must be between 1 and 5. Leave missing results blank.");
        Optional(data.MeetingMinutes,10000);Optional(data.Strengths,10000);Optional(data.Development,10000);
        if(request.Submit)
        {
            if(!request.RecordDate.HasValue)Fail("Enter the date the review was conducted.");
            if(data.SubTeamOrgUnitIds.Count==0&&!data.AllSubTeams)Fail("Select the sub-teams or choose all sub-teams in the area.");
        }
        // FollowUpDate is retained as historical data. New follow-ups have their own linked review and conducted date.
        if(request.Data.Samples.Count>0||request.Data.Responses.Count>0)Fail("Activate+ records 15 manual sub-area averages, not Digital Learning Walk responses.");
    }

    private static void ValidateActivateAction(SaveProcessReviewActionRequest request,ProcessReviewConfiguration configuration,DateOnly? previousDueDate)
    {
        if(configuration.ActionThemes?.Any(x=>x.Key==request.ThemeKey)!=true)Fail("Select one of the five specialist action themes.");
        if(configuration.SkillsScanPillars!.SelectMany(x=>x.SubAreas).All(x=>x.Key!=request.ImpactAreaKey))Fail("Select the Skills Scan area this action will improve.");
        if(request.ResponsibleStaffIds is null||request.ResponsibleStaffIds.Count is <1 or >100||request.ResponsibleStaffIds.Contains(Guid.Empty)||request.ResponsibleStaffIds.Distinct().Count()!=request.ResponsibleStaffIds.Count)
            Fail("Select one or more responsible staff members.");
        if(!request.ReviewDate.HasValue||request.ReviewDate==default(DateOnly))Fail("Set an action review date.");
        Required(request.Detail,4000,"Describe what needs to be done.");
        Required(request.SuccessEvidence,4000,"Describe the measures that will show impact.");
        if(request.Progress is not ("open" or "complete" or "extended" or "cancelled"))Fail("Select valid action progress.");
        if(request.ImpactStatus is not ("awaiting_evidence" or "assessing" or "demonstrated" or "further_change"))Fail("Select a valid impact assessment.");
        if(request.ImpactStatus=="demonstrated"&&string.IsNullOrWhiteSpace(request.ImpactEvidence)&&string.IsNullOrWhiteSpace(request.ImpactEvidenceLink))Fail("Add evidence before recording demonstrated impact.");
        if(previousDueDate.HasValue&&previousDueDate!=request.ReviewDate&&string.IsNullOrWhiteSpace(request.DeadlineChangeReason))Fail("Explain why the action review date changed.");
        if(request.Progress=="cancelled"&&string.IsNullOrWhiteSpace(request.ProgressNote))Fail("Explain why the action is being cancelled.");
        foreach(var value in new[]{request.ProgressNote,request.Barriers,request.NextStep,request.ImpactEvidence})Optional(value,4000);
        Optional(request.DeadlineChangeReason,1000);Link(request.EvidenceLink);Link(request.ImpactEvidenceLink);
    }
}
