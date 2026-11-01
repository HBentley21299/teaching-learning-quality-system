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

    [Fact]
    public void Digital_focus_selection_validates_only_selected_criteria_and_does_not_mutate_the_input()
    {
        var config=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital) with{RatingOptions=[new("a","College A"),new("b","College B")]};
        var selected=new[]{config.Standards[0].Statements[0].Key,config.Standards[1].Statements[0].Key};
        var excluded=config.Standards[2].Statements[0].Key;
        var data=Empty with{Digital=new(selected,[]),Samples=[new("sample","Evidence","learner_work",null,null,[],null,null)],
            Responses=[new(selected[0],"a",["sample"],null),new(excluded,"old-unselected-rating",["old-unselected-sample"],"Hidden prior input"),new(selected[1],"b",["sample"],null)]};
        var formal=new SaveProcessReviewRequest("Digital Learning Walk","2026/27",Guid.NewGuid(),Guid.NewGuid(),new DateOnly(2026,10,30),data,true);
        ProcessReviewRules.ValidateSave(formal,config);
        var normalized=ProcessReviewRules.NormalizeDigitalData(data,config);
        Assert.Equal(2,normalized.Responses.Count);Assert.Equal(3,data.Responses.Count);
        Assert.Equal(selected,ProcessReviewRules.SelectedDigitalStatements(config,normalized).Select(statement=>statement.Key));
        Assert.DoesNotContain(normalized.Responses,response=>response.StatementKey==excluded);
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(formal with{Data=normalized with{Digital=new([],[])}},config));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(formal with{Data=normalized with{Digital=new([selected[0],selected[0]],[])}},config));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(formal with{Data=normalized with{Digital=new(["unknown-criterion"],[])}},config));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(formal with{Data=normalized with{Digital=null}},config));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(data with{Activate=new(false,[],[],[],new Dictionary<string,decimal?>())}),config));
    }

    [Theory]
    [InlineData("criterion_notes")]
    [InlineData("ratings_only")]
    public void Digital_ratings_do_not_require_rationale_even_when_an_earlier_configuration_required_it(string evidenceMode)
    {
        var config=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital) with
        {
            RatingOptions=[new("level_1","1 – Emerging")],
            Settings=new Dictionary<string,string>{{"evidenceMode",evidenceMode},{"requireSamplePerRating","true"},{"requireRationale","true"}}
        };
        var standard=config.Standards[0];
        var data=Empty with{Digital=new(standard.Statements.Select(statement=>statement.Key).ToArray(),[],[standard.Key]),
            Responses=standard.Statements.Select(statement=>new ProcessReviewResponse(statement.Key,"level_1",[],null)).ToArray()};
        var formal=new SaveProcessReviewRequest("Walk","2026/27",Guid.NewGuid(),Guid.NewGuid(),new DateOnly(2026,10,30),data,true);
        ProcessReviewRules.ValidateSave(formal,config);
        var earlier=data with{Responses=data.Responses.Select((response,index)=>index==0?response with{Rationale="Earlier saved reasoning"}:response).ToArray()};
        var normalized=ProcessReviewRules.NormalizeDigitalData(earlier,config);
        Assert.Equal("Earlier saved reasoning",normalized.Responses[0].Rationale);
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(formal with{Data=data with{Responses=data.Responses.Skip(1).ToArray()}},config));
        // Earlier clients without typed focus metadata can also submit a complete ratings-only form.
        ProcessReviewRules.ValidateSave(formal with{Data=Empty with{Responses=config.Standards.SelectMany(category=>category.Statements)
            .Select(statement=>new ProcessReviewResponse(statement.Key,"level_1",[],null)).ToArray()}},config);
    }

    [Fact]
    public void Digital_category_selection_expands_every_child_and_cannot_submit_a_partial_statement_payload()
    {
        var config=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital) with{RatingOptions=[new("level_1","1 – Emerging")]};
        var categories=new[]{config.Standards[0].Key,config.Standards[1].Key};
        var statements=config.Standards.Take(2).SelectMany(standard=>standard.Statements).Select(statement=>statement.Key).ToArray();
        var data=Empty with{Digital=new([statements[0]],[],categories),Responses=[new(statements[0],"level_1",[],"Evidence")]};
        var normalized=ProcessReviewRules.NormalizeDigitalData(data,config);
        Assert.Equal(statements,normalized.Digital!.SelectedStatementKeys);Assert.Single(data.Digital!.SelectedStatementKeys);
        Assert.Equal(statements,ProcessReviewRules.SelectedDigitalStatements(config,data).Select(statement=>statement.Key));
        Assert.Equal(new[]{3,4},ProcessReviewRules.SelectedDigitalStandards(config,data).Select(standard=>standard.SelectedStatementCount));
        var formal=new SaveProcessReviewRequest("Walk","2026/27",Guid.NewGuid(),Guid.NewGuid(),new DateOnly(2026,10,30),data,true);
        var failure=Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(formal,config));
        Assert.Contains("every statement in the selected categories",failure.Message);
        // Complete responses succeed even if an old client sends a stale flattened key list.
        ProcessReviewRules.ValidateSave(formal with{Data=data with{Responses=statements.Select(key=>new ProcessReviewResponse(key,"level_1",[],null)).ToArray()}},config);
        var outside=config.Standards[2].Statements[0].Key;
        normalized=ProcessReviewRules.NormalizeDigitalData(data with{Responses=[..data.Responses,new(outside,"retired",[],"Historical input")]},config);
        Assert.Single(normalized.Responses);Assert.Equal(categories,normalized.Digital!.SelectedStandardKeys);
    }

    [Fact]
    public void Digital_category_selection_rejects_invalid_categories_and_explicit_empty_does_not_fall_back_to_old_keys()
    {
        var config=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital) with{RatingOptions=[new("level_1","1 – Emerging")]};
        var standard=config.Standards[0];var statement=standard.Statements[0].Key;
        foreach(var categories in new[]{new[]{"unknown"},new[]{standard.Key,standard.Key},new[]{""},new[]{" "}})
            Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(Empty with{Digital=new([statement],[],categories)}),config));
        var empty=Empty with{Digital=new([statement],[],[]),Responses=[new(statement,"level_1",[],null)]};
        ProcessReviewRules.ValidateSave(Draft(empty),config);
        var normalized=ProcessReviewRules.NormalizeDigitalData(empty,config);
        Assert.Empty(normalized.Digital!.SelectedStatementKeys);Assert.Empty(normalized.Responses);
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(new("Walk","2026/27",Guid.NewGuid(),Guid.NewGuid(),new DateOnly(2026,10,30),empty,true),config));
    }

    [Fact]
    public void Earlier_partial_digital_focus_remains_exact_until_categories_are_explicitly_selected()
    {
        var config=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital) with{RatingOptions=[new("old","Earlier scale")]};
        var key=config.Standards[0].Statements[0].Key;
        var json="""{"fields":{},"samples":[],"responses":[{"statementKey":"$statement","ratingKey":"old","sampleIds":[],"rationale":"Original evidence"}],"digital":{"selectedStatementKeys":["$statement"],"draftActions":[]}}""".Replace("$statement",key,StringComparison.Ordinal);
        var data=System.Text.Json.JsonSerializer.Deserialize<ProcessReviewData>(json,new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!;
        var normalized=ProcessReviewRules.NormalizeDigitalData(data,config);
        Assert.Null(normalized.Digital!.SelectedStandardKeys);Assert.Equal(new[]{key},normalized.Digital.SelectedStatementKeys);
        Assert.Equal(data.Responses,normalized.Responses);Assert.Single(ProcessReviewRules.SelectedDigitalStatements(config,normalized));
        var category=Assert.Single(ProcessReviewRules.SelectedDigitalStandards(config,normalized));Assert.Equal(3,category.StatementCount);Assert.Equal(1,category.SelectedStatementCount);
        ProcessReviewRules.ValidateSave(new("Earlier walk","2026/27",Guid.NewGuid(),Guid.NewGuid(),new DateOnly(2026,10,30),normalized,true),config);
        normalized=ProcessReviewRules.NormalizeDigitalData(data with{Digital=data.Digital! with{SelectedStandardKeys=[config.Standards[0].Key]}},config);
        Assert.Equal(3,normalized.Digital!.SelectedStatementKeys.Count);Assert.Single(normalized.Responses);
    }

    [Fact]
    public void Four_field_digital_actions_can_be_partial_in_a_draft_and_need_no_fabricated_success_evidence()
    {
        var config=ProcessReviewRules.DefaultConfiguration(ProcessReviewRules.Digital) with{RatingOptions=[new("a","College category")]};
        var selected=config.Standards[0].Statements[0].Key;
        var partial=new DigitalLearningWalkDraftAction(Guid.NewGuid(),"","");
        var data=Empty with{Digital=new([selected],[partial]),Samples=[new("sample","Evidence","learner_work",null,null,[],null,null)],Responses=[new(selected,"a",["sample"],null)]};
        ProcessReviewRules.ValidateSave(Draft(data),config);
        var formal=new SaveProcessReviewRequest("Walk","2026/27",Guid.NewGuid(),Guid.NewGuid(),new DateOnly(2026,10,30),data,true);
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(formal,config));
        var complete=partial with{Title="Improve the resources",ThemeKey=config.Standards[0].Key,OwnerStaffId=Staff,DueDate=new DateOnly(2026,12,1)};
        ProcessReviewRules.ValidateSave(formal with{Data=data with{Digital=new([selected],[complete])}},config);
        var earlier=complete with{DueDate=formal.RecordDate!.Value.AddDays(-1)};
        ProcessReviewRules.ValidateSave(Draft(data with{Digital=new([selected],[earlier])}),config);
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(formal with{Data=data with{Digital=new([selected],[earlier])}},config));
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateSave(Draft(data with{Digital=new([selected],[partial,partial])}),config));
        var native=new SaveProcessReviewActionRequest(complete.Title,complete.ThemeKey,Staff,complete.DueDate!.Value,"","");
        ProcessReviewRules.ValidateAction(native with{Progress="complete"},config);
        Assert.Throws<WorkflowValidationException>(()=>ProcessReviewRules.ValidateAction(native with{ImpactStatus="demonstrated"},config));
    }
}
