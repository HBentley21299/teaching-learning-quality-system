using TLQS.Api.Data;
using TLQS.Application.Security;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class QaQuestionCsvPlannerTests
{
    private static readonly QaQuestionCsvActivity Lesson=new(Guid.NewGuid(),"lesson_visit","Lesson Visit",true,70);
    private static readonly QaQuestionCsvActivity Voice=new(Guid.NewGuid(),"student_voice","Student Voice",true,20);
    private static readonly IReadOnlyDictionary<string,QaQuestionCsvPreviousImport> NoImports=new Dictionary<string,QaQuestionCsvPreviousImport>();

    [Fact]
    public void New_criteria_default_to_draft_with_required_response_and_next_activity_order()
    {
        var result=Plan("question_reference,activity_key,question_text\nright-start-01,lesson_visit,A welcoming start");
        Assert.Empty(result.Issues);
        var candidate=Assert.Single(result.Candidates);
        Assert.Equal(Lesson.Id,candidate.ActivityTypeId);
        Assert.Equal("draft",candidate.Payload.SourceStatus);
        Assert.Equal("general",candidate.Payload.QuestionTag);
        Assert.True(candidate.Payload.IsRequired);
        Assert.False(candidate.Payload.AllowsNotApplicable);
        Assert.False(candidate.Payload.CommentRequiredAtExpected);
        Assert.Null(candidate.Payload.RequestedDisplayOrder);
        Assert.Equal(80,candidate.DisplayOrder);
        Assert.Equal("create",Assert.Single(result.Rows).Operation);
        Assert.Equal("80",result.Rows[0].Values["display_order"]);
    }

    [Fact]
    public void Explicit_flags_active_status_tags_and_multiline_guidance_are_preserved()
    {
        var result=Plan("QUESTION_REFERENCE,ACTIVITY_KEY,QUESTION_TEXT,QUESTION_TAG,THEME_OR_WEEK,GUIDANCE,DISPLAY_ORDER,IS_REQUIRED,ALLOWS_NOT_APPLICABLE,COMMENT_REQUIRED_AT_EXPECTED,SOURCE_STATUS\n"+
            " qa-02 ,lesson_visit,\"Do learners use feedback, including \"\"next steps\"\"?\", WEEK_2 ,Week 2,\"First line\nSecond line\",0,FALSE,TRUE,true,ACTIVE");
        var candidate=Assert.Single(result.Candidates);
        var warning=Assert.Single(result.Issues);
        Assert.Equal("warning",warning.Severity);
        Assert.Equal("comment_required_at_expected",warning.Column);
        Assert.Contains("optional",warning.Message);
        Assert.Equal("qa-02",candidate.Reference);
        Assert.Equal("Do learners use feedback, including \"next steps\"?",candidate.Payload.QuestionText);
        Assert.Equal("week_2",candidate.Payload.QuestionTag);
        Assert.Equal("First line\nSecond line",candidate.Payload.Guidance);
        Assert.Equal(0,candidate.DisplayOrder);
        Assert.False(candidate.Payload.IsRequired);
        Assert.True(candidate.Payload.AllowsNotApplicable);
        Assert.True(candidate.Payload.CommentRequiredAtExpected);
        Assert.Equal("active",candidate.Payload.SourceStatus);
    }

    [Theory]
    [InlineData("Lesson Visit")]
    [InlineData("unknown_activity")]
    [InlineData("")]
    public void Unknown_activity_names_and_keys_cannot_create_activity_definitions(string activity)
    {
        var result=Plan($"question_reference,activity_key,question_text\nqa-01,{activity},Evidence criterion");
        Assert.Empty(result.Candidates);
        Assert.Contains(result.Issues,issue=>issue.Column=="activity_key");
    }

    [Fact]
    public void Inactive_activities_are_rejected()
    {
        var table=AdminCsvReader.Parse("question_reference,activity_key,question_text\nqa-01,lesson_visit,Evidence criterion");
        var result=QaQuestionCsvPlanner.Validate(table,[Lesson with {IsActive=false}],[],NoImports);
        Assert.Empty(result.Candidates);
        Assert.Contains(result.Issues,issue=>issue.Column=="activity_key");
    }

    [Theory]
    [InlineData("question_id")]
    [InlineData("template_key")]
    [InlineData("allows_not_seen")]
    public void Unrelated_template_or_update_columns_are_rejected(string column)
    {
        var result=Plan($"question_reference,activity_key,question_text,{column}\nqa-01,lesson_visit,Evidence criterion,value");
        Assert.Empty(result.Candidates);
        Assert.Contains(result.Issues,issue=>issue.RowNumber==1 && issue.Column==column);
    }

    [Theory]
    [InlineData("is_required","yes")]
    [InlineData("allows_not_applicable","1")]
    [InlineData("comment_required_at_expected","no")]
    [InlineData("display_order","-1")]
    [InlineData("display_order","1.5")]
    [InlineData("display_order","2147483648")]
    [InlineData("source_status","inactive")]
    public void Ambiguous_flags_invalid_order_and_archive_requests_fail_before_any_creation(string column,string value)
    {
        var result=Plan($"question_reference,activity_key,question_text,{column}\nqa-01,lesson_visit,Evidence criterion,{value}");
        Assert.Empty(result.Candidates);
        Assert.Contains(result.Issues,issue=>issue.Column==column);
        Assert.Equal("error",result.Rows.Single().Operation);
    }

    [Theory]
    [InlineData("question_reference",201)]
    [InlineData("question_text",1001)]
    [InlineData("theme_or_week",201)]
    [InlineData("guidance",2001)]
    [InlineData("question_tag",81)]
    public void Database_field_lengths_are_validated_with_row_and_column_feedback(string column,int length)
    {
        var cells=new Dictionary<string,string> { ["question_reference"]="qa-01",["activity_key"]="lesson_visit",["question_text"]="Criterion" };
        cells[column]=new('x',length);
        var table=new AdminCsvTable(cells.Keys.ToArray(),[new AdminCsvRow(8,cells)]);
        var result=QaQuestionCsvPlanner.Validate(table,[Lesson],[],NoImports);
        Assert.Empty(result.Candidates);
        Assert.Contains(result.Issues,issue=>issue.RowNumber==8 && issue.Column==column);
    }

    [Fact]
    public void Identical_reimport_skips_even_when_database_order_changed_after_the_first_import()
    {
        const string csv="question_reference,activity_key,question_text\nqa-01,lesson_visit,Evidence criterion";
        var original=Plan(csv).Candidates.Single();
        var ledger=new Dictionary<string,QaQuestionCsvPreviousImport>(StringComparer.OrdinalIgnoreCase) { ["QA-01"]=new(original.PayloadHash,Guid.NewGuid()) };
        var bank=new QaQuestionCsvExistingQuestion(Guid.NewGuid(),"lesson_visit",1,80,"general",null,"Evidence criterion");
        var result=QaQuestionCsvPlanner.Validate(AdminCsvReader.Parse(csv),[Lesson with {MaximumDisplayOrder=200}],[bank],ledger);
        Assert.Empty(result.Issues);
        Assert.Empty(result.Candidates);
        Assert.Equal("skip",result.Rows.Single().Operation);
    }

    [Fact]
    public void Reused_reference_with_changed_data_is_an_error_and_never_updates_a_question()
    {
        var original=Plan("question_reference,activity_key,question_text\nqa-01,lesson_visit,Original criterion").Candidates.Single();
        var ledger=new Dictionary<string,QaQuestionCsvPreviousImport> { ["qa-01"]=new(original.PayloadHash,Guid.NewGuid()) };
        var result=QaQuestionCsvPlanner.Validate(AdminCsvReader.Parse("question_reference,activity_key,question_text\nqa-01,lesson_visit,Changed criterion"),[Lesson],[],ledger);
        Assert.Empty(result.Candidates);
        Assert.Equal("error",result.Rows.Single().Operation);
        Assert.Contains(result.Issues,issue=>issue.Column=="question_reference" && issue.Message.Contains("Edit the existing question"));
    }

    [Fact]
    public void Existing_bank_content_is_detected_despite_wording_case_and_whitespace()
    {
        var existing=new QaQuestionCsvExistingQuestion(Guid.NewGuid(),"lesson_visit",4,10,"week_1","Week 1: Right Start","A welcoming start");
        var result=QaQuestionCsvPlanner.Validate(AdminCsvReader.Parse("question_reference,activity_key,question_text,question_tag,theme_or_week\nqa-01,lesson_visit,A   WELCOMING start,week_1,week 1: right start"),[Lesson],[existing],NoImports);
        Assert.Empty(result.Candidates);
        Assert.Contains(result.Issues,issue=>issue.Column=="question_text" && issue.Message.Contains("already exists"));
    }

    [Fact]
    public void Duplicate_file_references_skip_identical_rows_but_reject_conflicting_payloads_and_different_reference_duplicates()
    {
        var same=Plan("question_reference,activity_key,question_text\nqa-01,lesson_visit,Criterion\nQA-01,lesson_visit,Criterion");
        Assert.Empty(same.Issues);
        Assert.Single(same.Candidates);
        Assert.Equal(new[] {"create","skip"},same.Rows.Select(row=>row.Operation));
        var conflict=Plan("question_reference,activity_key,question_text\nqa-01,lesson_visit,Criterion\nqa-01,lesson_visit,Different criterion");
        Assert.Single(conflict.Candidates);
        Assert.Contains(conflict.Issues,issue=>issue.RowNumber==3 && issue.Column=="question_reference");
        var duplicate=Plan("question_reference,activity_key,question_text\nqa-01,lesson_visit,Criterion\nqa-02,lesson_visit,Criterion");
        Assert.Single(duplicate.Candidates);
        Assert.Contains(duplicate.Issues,issue=>issue.RowNumber==3 && issue.Column=="question_text");
    }

    [Fact]
    public void Repeated_wording_can_belong_to_distinct_question_tags_and_activities()
    {
        var result=Plan("question_reference,activity_key,question_text,question_tag\na,lesson_visit,Criterion,week_1\nb,lesson_visit,Criterion,week_2\nc,student_voice,Criterion,week_1");
        Assert.Empty(result.Issues);
        Assert.Equal(3,result.Candidates.Count);
        Assert.Equal(new[] {80,90,30},result.Candidates.Select(row=>row.DisplayOrder));
    }

    [Fact]
    public void Canonical_hash_uses_normalized_source_fields_including_null_automatic_order()
    {
        var minimal=Plan("question_reference,activity_key,question_text\nqa-01,lesson_visit,Criterion").Candidates.Single();
        var explicitDefaults=Plan("question_reference,activity_key,question_text,question_tag,is_required,allows_not_applicable,comment_required_at_expected,source_status,display_order\nqa-01,LESSON_VISIT, Criterion ,GENERAL,TRUE,false,FALSE,DRAFT,").Candidates.Single();
        Assert.Equal(minimal.PayloadHash,explicitDefaults.PayloadHash);
        var order=Plan("question_reference,activity_key,question_text,display_order\nqa-01,lesson_visit,Criterion,80").Candidates.Single();
        Assert.NotEqual(minimal.PayloadHash,order.PayloadHash);
    }

    [Fact]
    public void Automatic_order_overflow_is_reported_but_explicit_valid_order_remains_available()
    {
        var automatic=QaQuestionCsvPlanner.Validate(AdminCsvReader.Parse("question_reference,activity_key,question_text\na,lesson_visit,Criterion"),[Lesson with {MaximumDisplayOrder=int.MaxValue}],[],NoImports);
        Assert.Empty(automatic.Candidates);
        Assert.Contains(automatic.Issues,issue=>issue.Column=="display_order");
        var explicitOrder=QaQuestionCsvPlanner.Validate(AdminCsvReader.Parse("question_reference,activity_key,question_text,display_order\na,lesson_visit,Criterion,10"),[Lesson with {MaximumDisplayOrder=int.MaxValue}],[],NoImports);
        Assert.Single(explicitOrder.Candidates);
    }

    [Fact]
    public void Import_permission_requires_a_linked_administrator_with_QA_management()
    {
        CurrentUser User(bool admin,bool qa,bool linked=true)=>new(linked ? Guid.NewGuid() : null,null,"Test","test@example.com",
            qa ? new HashSet<string> {PermissionKeys.QaReviewsManage} : new HashSet<string>(),[]) {IsAdministrator=admin};
        Assert.True(QaQuestionCsvPlanner.CanImport(User(true,true)));
        Assert.False(QaQuestionCsvPlanner.CanImport(User(false,true)));
        Assert.False(QaQuestionCsvPlanner.CanImport(User(true,false)));
        Assert.False(QaQuestionCsvPlanner.CanImport(User(true,true,false)));
    }

    private static QaQuestionCsvValidation Plan(string csv)=>QaQuestionCsvPlanner.Validate(AdminCsvReader.Parse(csv),[Lesson,Voice],[],NoImports);
}
