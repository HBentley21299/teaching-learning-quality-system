using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ProcessReviewRulesTests
{
    private static readonly Guid Staff=Guid.NewGuid();
    private static CurrentUser User(params string[] permissions)=>new(Guid.NewGuid(),Staff,"Review author","review@example.invalid",permissions.ToHashSet(),[]);
    private static ProcessReviewData Empty=>new(new Dictionary<string,string>(),[],[]);
    private static SaveProcessReviewRequest Draft(ProcessReviewData? data=null)=>new("","2026/27",null,null,null,data??Empty);

    [Fact]
    public void Supplied_framework_has_24_exact_statements_and_no_invented_scale()
    {
        var configuration=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital);
        Assert.Equal(new[]{3,4,4,4,4,5},configuration.Standards.Select(x=>x.Statements.Count));
        Assert.Empty(configuration.RatingOptions);
        Assert.Equal("Learners’ use of AI follows college and assessment expectations, including checking outputs and acknowledging permitted assistance.",configuration.Standards[^1].Statements[^1].Text);
        ProcessReviewRules.ValidateConfiguration(configuration.ProcessKey,configuration);
        var activate=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Activate);
        Assert.Equal(5,activate.Standards.Count);Assert.Empty(activate.RatingOptions);Assert.All(activate.Standards,x=>Assert.Empty(x.Statements));
    }

    [Fact]
    public void Partial_drafts_preserve_unfinished_fields_but_digital_submission_waits_for_scale()
    {
        var config=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital);
        var data=Empty with{Samples=[new("sample_1","","",null,null,[],"https:","Unfinished evidence")]};
        ProcessReviewRules.ValidateSave(Draft(data),config);
        var error=Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(data) with{Submit=true,Title="Review",FacultyOrgUnitId=Guid.NewGuid()},config));
        Assert.Contains("name",error.Message,StringComparison.OrdinalIgnoreCase);
        error=Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft() with{Submit=true,Title="Review",FacultyOrgUnitId=Guid.NewGuid()},config));
        Assert.Contains("scale",error.Message,StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Ratings_have_one_answer_per_statement_and_link_only_own_samples()
    {
        var config=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital) with{RatingOptions=[new("college_a","College category A")]};
        var statement=config.Standards[0].Statements[0].Key;
        var response=new ProcessReviewResponse(statement,"college_a",[],null);
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(Empty with{Responses=[response,response]}),config));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(Empty with{Responses=[response with{SampleIds=["other_review_sample"]}]}),config));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(Empty with{Responses=[response with{RatingKey="invented"}]}),config));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(Empty with{Responses=[response with{StatementKey="different_framework"}]}),config));
    }

    [Fact]
    public void Config_admin_and_global_reporting_do_not_imply_access_to_other_review_narratives()
    {
        var editor=User(PermissionKeys.FormsManage);
        Assert.True(ProcessReviewRules.CanManageConfiguration(editor));Assert.True(ProcessReviewRules.CanCreate(editor,ProcessReviewRules.Digital));
        Assert.False(ProcessReviewRules.CanViewAll(editor,ProcessReviewRules.Digital));Assert.False(ProcessReviewRules.CanEdit(editor,ProcessReviewRules.Digital,Guid.NewGuid(),true));
        Assert.False(ProcessReviewRules.CanViewAll(User(PermissionKeys.ReportsViewAll),ProcessReviewRules.Digital));
        var coordinator=User(ProcessReviewRules.Digital+".manage");
        Assert.True(ProcessReviewRules.CanEdit(coordinator,ProcessReviewRules.Digital,Guid.NewGuid(),true));
        Assert.False(ProcessReviewRules.CanEdit(coordinator,ProcessReviewRules.Digital,Guid.NewGuid(),false));
        Assert.False(ProcessReviewRules.CanEdit(coordinator,ProcessReviewRules.Activate,Guid.NewGuid(),true));
        Assert.True(ProcessReviewRules.CanViewAll(editor with{IsAdministrator=true},ProcessReviewRules.Activate));
    }

    [Fact]
    public void Draft_scale_refresh_cannot_change_questions_or_reinterpret_saved_ratings()
    {
        var old=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital);var latest=old with{Version=2,RatingOptions=[new("a","College category")]};
        Assert.True(ProcessReviewRules.CanRefreshUnratedDraft(old,latest,Empty));
        Assert.False(ProcessReviewRules.CanRefreshUnratedDraft(old,latest,Empty with{Responses=[new(old.Standards[0].Statements[0].Key,"a",[],null)]}));
        Assert.False(ProcessReviewRules.CanRefreshUnratedDraft(old,latest with{Standards=[latest.Standards[0] with{Statements=[new("changed","Changed wording")]}]},Empty));
    }

    [Fact]
    public void Snapshot_requires_dated_source_and_no_automatic_skills_scan_coverage()
    {
        var config=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Activate);
        ProcessReviewRules.ValidateSave(Draft(),config);
        var request=Draft() with{Title="Faculty review",FacultyOrgUnitId=Guid.NewGuid(),Submit=true};
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(request,config));
        request=request with{Data=Empty with{Fields=new Dictionary<string,string>{{"teamsUrl","https://college.sharepoint.com/review"},{"snapshotDate","2026-11-24"},{"sourceMeeting","Initial review"}}}};
        ProcessReviewRules.ValidateSave(request,config);
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(request with{Data=Empty with{Fields=new Dictionary<string,string>(request.Data.Fields){{"responsesReceived","20"},{"eligibleStaff","10"}}}},config));
    }

    [Fact]
    public void Native_actions_require_real_success_evidence_and_separate_completion_from_impact()
    {
        var config=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Activate) with{SkillsScanPillars=null,ActionThemes=null};
        var action=new SaveProcessReviewActionRequest("Improve accessibility",config.Standards[0].Key,Staff,new DateOnly(2027,1,15),"Specialist help","Learner evidence");
        ProcessReviewRules.ValidateAction(action with{Progress="complete"},config);
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateAction(action with{ImpactStatus="demonstrated"},config));
        ProcessReviewRules.ValidateAction(action with{ImpactStatus="demonstrated",ImpactEvidence="Evidence shows improved learner access"},config);
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateAction(action,config,new DateOnly(2027,1,1)));
        ProcessReviewRules.ValidateAction(action with{DeadlineChangeReason="Further specialist support required"},config,new DateOnly(2027,1,1));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateAction(action with{ThemeKey="digital_standard"},config));
    }

    [Theory]
    [InlineData("contributors")]
    [InlineData("ownerStaffId")]
    [InlineData("ownerName")]
    public void Creator_identity_and_removed_contributors_are_never_custom_answer_fields(string key)
    {
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(Empty with{Fields=new Dictionary<string,string>{{key,"spoofed"}}}),ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital)));
    }

    [Fact]
    public void Null_array_items_are_validation_failures_rather_than_server_errors()
    {
        var config=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital);
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(Empty with{Samples=[null!]}),config));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(Empty with{Responses=[null!]}),config));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateConfiguration(config.ProcessKey,config with{Standards=[null!]}));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateConfiguration(config.ProcessKey,config with{Standards=[config.Standards[0] with{Statements=[null!]}]}));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateConfiguration(config.ProcessKey,config with{RatingOptions=[null!]}));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(Empty with{Fields=new Dictionary<string,string>{{"attendeeStaffIds","not a staff list"}}}),config));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(Empty with{Fields=new Dictionary<string,string>{{"headOfFacultyStaffId","invalid"}}}),config));
    }

    [Fact]
    public void Activate_has_fifteen_decimal_averages_and_five_independent_action_themes()
    {
        var config=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Activate);
        Assert.Equal(6,config.SkillsScanPillars!.Count);Assert.Equal(15,config.SkillsScanPillars.Sum(x=>x.SubAreas.Count));Assert.Equal(5,config.ActionThemes!.Count);
        Assert.Empty(config.RatingOptions);Assert.Empty(ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital).RatingOptions);
        var activate=new ActivateGrowthReviewData(false,[Guid.NewGuid()],[],[],new Dictionary<string,decimal?>{{"digital_proficiency",1m},{"digital_productivity",4.25m},{"digital_creation",null}});
        var request=Draft() with{Title="Review",FacultyOrgUnitId=Guid.NewGuid(),RecordDate=new DateOnly(2026,10,30),Submit=true,Data=Empty with{Activate=activate}};
        ProcessReviewRules.ValidateSave(request,config);
        foreach(var bad in new[]{0m,0.99m,5.01m,6m})Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(request with{Data=Empty with{Activate=activate with{SkillsScanScores=new Dictionary<string,decimal?>{{"digital_proficiency",bad}}}}},config));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(request with{Data=Empty with{Activate=activate with{SkillsScanScores=new Dictionary<string,decimal?>{{"question_36",3m}}}}},config));
        var action=new SaveProcessReviewActionRequest("Improve sources",config.ActionThemes[0].Key,Staff,new DateOnly(2027,1,15),"","Learners select reliable sources",ResponsibleStaffIds:[Staff],ImpactAreaKey:"information_literacy",Detail:"Teach source evaluation with vocational examples",ReviewDate:new DateOnly(2027,1,15));
        ProcessReviewRules.ValidateAction(action,config);
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateAction(action with{ImpactAreaKey=config.ActionThemes[0].Key},config));
    }
}
