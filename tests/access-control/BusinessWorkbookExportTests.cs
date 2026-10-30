using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using DocumentFormat.OpenXml.Validation;
using TLQS.Api.Exports;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class BusinessWorkbookExportTests
{
    [Theory]
    [InlineData("learning-walks", "Actions")]
    [InlineData("als-learning-walks", "Actions")]
    [InlineData("work-scrutiny", "Actions")]
    [InlineData("elevate-environments", "Pillar Ratings")]
    [InlineData("cpd", "Attendance")]
    [InlineData("coaching", "Session Actions")]
    [InlineData("coaching", "Action Reviews")]
    [InlineData("liv", "Stages")]
    [InlineData("als-liv", "Practice Ratings")]
    [InlineData("probation", "Practice Rubric")]
    [InlineData("uco-tla-reviews", "Development Actions")]
    [InlineData("elevate-status", "Elevate Status Awards")]
    [InlineData("actions", "Extensions")]
    [InlineData("activate_growth_review", "Skills Scan")]
    [InlineData("activate_growth_review", "Review links")]
    [InlineData("activate_growth_review", "Previous review")]
    [InlineData("activate_growth_review", "Previous Skills Scan")]
    [InlineData("activate_growth_review", "Review scope")]
    [InlineData("activate_growth_review", "Participants")]
    [InlineData("activate_growth_review", "Historical form")]
    [InlineData("activate_growth_review", "Historical action detail")]
    [InlineData("activate_growth_review", "Historical impact updates")]
    public void Process_workbooks_keep_business_form_rows_and_only_genuine_repeat_detail(string module, string detailName)
    {
        var primary = Sheet("Form entries", ["Record ID", "Title", "Staff member", "Form version", "Evidence [saved/question]"],
            ["record-1", "Review", "Alex", "2026 v2", "First line\nSecond line"]);
        var detail = Sheet(detailName,["Record ID","Item","Due date"],["record-1","Follow up","2026-11-01"]);
        var data=BusinessWorkbookExportBuilder.Build(Workbook(module,primary,detail,
            Sheet("Form Answers",["Record ID","Question key","Response"],["record-1","internal-key","First line\nSecond line"]),
            Sheet("Field definitions",["Question identity"],["internal-key"]),
            Sheet("Dashboard record data",["Source Record ID","Can Edit"],["record-1","true"]),
            primary with {Name="Duplicate source"}));
        Assert.Equal(new[] {"Form entries",detailName},data.Sheets.Select(sheet => sheet.Name));
        Assert.Equal(new[] {"Entry reference","Staff member","Title","Form version","Evidence [saved/question]"},data.Sheets[0].Columns);
        Assert.Equal("First line\nSecond line",data.Sheets[0].Rows[0][4]);
        Assert.Equal("Entry 0001",data.Sheets[1].Rows[0][0]);
        Assert.Contains("Alex",data.Sheets[1].Rows[0]);
        Assert.Contains("Review",data.Sheets[1].Rows[0]);
        Assert.All(data.Sheets, sheet => Assert.All(sheet.Rows,row => Assert.Equal(sheet.Columns.Count,row.Count)));
    }

    [Fact]
    public void Same_named_staff_entries_link_by_identity_and_outside_filter_children_are_removed()
    {
        var source=Workbook("liv",Sheet("Form entries",["Record ID","LIV case ID","Staff member","Title"],
            ["r1","case1","Alex","First case"],["r2","case2","Alex","Second case"]),
            Sheet("Visits",["LIV case ID","Visit number","Course"],["case2","1","Maths"],["outside","1","Outside scope"],["case1","2","English"]));
        var visits=BusinessWorkbookExportBuilder.Build(source).Sheets[1];
        Assert.Equal(2,visits.Rows.Count);
        Assert.Equal("Entry 0002",visits.Rows[0][0]);
        Assert.Equal("Entry 0001",visits.Rows[1][0]);
        Assert.DoesNotContain(visits.Rows.SelectMany(row => row),value => value=="Outside scope");
        Assert.DoesNotContain(visits.Rows.SelectMany(row => row),value => value is "case1" or "case2" or "r1" or "r2");
    }

    [Fact]
    public void Overview_bridges_record_case_cycle_and_visit_without_publishing_ids_or_duplicate_sources()
    {
        var source=Workbook("dashboard-overview",Sheet("Form entries",["Record ID","Staff member","Title"],["record","Alex","LIV"]),
            Sheet("LIV",["Record ID","LIV case ID","Primary focus"],["record","case","Feedback"]),
            Sheet("liv-1-LIV Cases",["Record ID","LIV case ID"],["record","case"]),
            Sheet("liv-2-Cycles",["LIV case ID","Cycle ID","Cycle"],["case","cycle","2"]),
            Sheet("liv-3-Visits",["Cycle ID","Visit ID","Course"],["cycle","visit","English"]),
            Sheet("liv-4-Practice Ratings",["Visit ID","Judgement"],["visit","N/A"]));
        var result=BusinessWorkbookExportBuilder.Build(source);
        Assert.DoesNotContain(result.Sheets,sheet => sheet.Name=="liv-1-LIV Cases");
        Assert.Equal(5,result.Sheets.Count);
        Assert.All(result.Sheets, sheet => Assert.Equal("Entry 0001",sheet.Rows[0][0]));
        Assert.Contains("N/A",result.Sheets[^1].Rows[0]);
        Assert.DoesNotContain(result.Sheets.SelectMany(sheet=>sheet.Columns),column => column.EndsWith(" ID",StringComparison.Ordinal));
    }

    [Fact]
    public void System_controls_are_removed_but_actual_question_with_ID_wording_and_form_version_remain()
    {
        var data=BusinessWorkbookExportBuilder.Build(Workbook("learning-walks",Sheet("Form entries",
            ["Record ID","Submitted by","Visible to staff","Row version","Visibility status","Staff ID [form/learner-code]","Form version","Completion note"],
            [Guid.NewGuid().ToString(),"Sam","true","AQID","private","00123","September 2026","N/A"]))).Sheets[0];
        Assert.DoesNotContain("Visible to staff",data.Columns);
        Assert.DoesNotContain("Row version",data.Columns);
        Assert.DoesNotContain("Visibility status",data.Columns);
        Assert.Contains("Staff ID [form/learner-code]",data.Columns);
        Assert.Contains("00123",data.Rows[0]);
        Assert.Contains("September 2026",data.Rows[0]);
        Assert.Contains("Sam",data.Rows[0]);
    }

    [Fact]
    public void Structured_answers_retain_all_meaningful_values_without_json_or_control_identifiers()
    {
        const string answer="""[{"focusId":"00000000-0000-0000-0000-000000000001","focusName":"Feedback","rating":"N/A","notes":"First line\nSecond line","visibleToStaff":true},{"focusName":"Inclusion","rating":"Not seen","notes":"No opportunity"}]""";
        var text=BusinessWorkbookExportBuilder.DisplayValue(answer)!;
        Assert.Contains("Feedback",text);
        Assert.Contains("N/A",text);
        Assert.Contains("Not seen",text);
        Assert.Contains("First line\nSecond line",text);
        Assert.Contains("No opportunity",text);
        Assert.DoesNotContain("00000000",text);
        Assert.DoesNotContain("visibleToStaff",text);
        Assert.DoesNotContain("{",text);
        var answers=FormEntryExportBuilder.ExpandAnswers(Sheet("Form Answers",["Record ID","Question key","Question","Response type","Response"],
            ["record","walk/focus","Themes","text",answer]));
        Assert.DoesNotContain(answers.Rows,row => row[1]?.EndsWith("/focusId")==true);
        Assert.DoesNotContain(answers.Rows.Select(row=>row[4]),value => value?.Contains("00000000")==true);
    }

    [Fact]
    public void Qa_workbook_retains_each_criterion_and_review_context_and_linked_actions()
    {
        var source=Workbook("qa-review-report",Sheet("Form entries",["Record ID","Activity","Reviewer","Criterion - Outcome [qa/question/outcome]","Criterion - Comment [qa/question/comment]"],
            ["evidence","Learning walk","Sam","Not seen","No opportunity"]),
            Sheet("Review Summary",["Property","Value"],["Title","Autumn QA"],["Academic year","2026/27"],["Owner","Pat"],["Theme","Feedback"]),
            Sheet("Linked Actions",["Action","Assigned to"],["Discuss evidence","Sam"]),
            Sheet("Expanded Criteria",["Criterion","Count"],["Criterion","1"]));
        var result=BusinessWorkbookExportBuilder.Build(source);
        Assert.Equal(new[] {"Form entries","Linked Actions"},result.Sheets.Select(sheet=>sheet.Name));
        Assert.Contains("Autumn QA",result.Sheets[0].Rows[0]);
        Assert.Contains("Pat",result.Sheets[0].Rows[0]);
        Assert.Contains("Not seen",result.Sheets[0].Rows[0]);
        using var document=SpreadsheetDocument.Open(new MemoryStream(new ExcelExportService().CreateWorkbook(source).Content),false);
        Assert.Empty(new OpenXmlValidator().Validate(document));
        Assert.Equal(3,document.WorkbookPart!.Workbook.Sheets!.Count());
        Assert.DoesNotContain(document.WorkbookPart.WorksheetParts.SelectMany(part=>part.Worksheet.Descendants<Cell>()),cell=>cell.InnerText=="evidence");
    }

    [Fact]
    public void Projection_preserves_numbers_dates_blanks_and_literal_formula_looking_answers()
    {
        var source=Workbook("cpd",new ExportSheet("Form entries",["Record ID","Staff member","Learners","Date","Comment","Unanswered"],
            [new string?[] {"record","Alex","12","2026-10-29","=HYPERLINK(\"https://example.com\")",null}],false,["text","text","number","date","text","text"]));
        using var document=SpreadsheetDocument.Open(new MemoryStream(new ExcelExportService().CreateWorkbook(source).Content),false);
        var sheet=document.WorkbookPart!.WorksheetParts.First(part=>part.Worksheet.Descendants<Cell>().Any(cell=>cell.InnerText=="Entry 0001"));
        var row=sheet.Worksheet.Descendants<Row>().Skip(1).Single().Elements<Cell>().ToArray();
        Assert.Equal(CellValues.Number,row[2].DataType!.Value);
        Assert.Equal(CellValues.Number,row[3].DataType!.Value);
        Assert.Equal("",row[5].InnerText);
        Assert.StartsWith("=HYPERLINK",row[4].InnerText);
        Assert.Empty(sheet.Worksheet.Descendants<CellFormula>());
    }

    [Fact]
    public void Linked_probation_liv_details_keep_the_parent_reference_through_observation_relationships()
    {
        var source=Workbook("probation",Sheet("Form entries",["Record ID","Staff member"],["probation","Alex"]),
            Sheet("Observations",["Record ID","Observation number","Linked LIV case ID"],["probation","2","liv-case"]),
            Sheet("Linked LIV Cases",["Record ID","LIV case ID","Primary focus"],["liv-record","liv-case","Feedback"]),
            Sheet("Linked LIV Stages",["LIV case ID","Cycle","Reflection"],["liv-case","2","Clear progress"]));
        var safe=BusinessWorkbookExportBuilder.Build(source);
        Assert.Equal(4,safe.Sheets.Count);
        Assert.All(safe.Sheets,sheet=>Assert.Equal("Entry 0001",sheet.Rows[0][0]));
        Assert.Contains("Clear progress",safe.Sheets[^1].Rows[0]);
        Assert.DoesNotContain(safe.Sheets.SelectMany(sheet=>sheet.Rows).SelectMany(row=>row),value=>value is "liv-case" or "liv-record" or "probation");
    }

    [Fact]
    public void Overview_retains_long_named_linked_forms_and_children_using_source_metadata()
    {
        var source=Workbook("dashboard-overview",Sheet("Form entries",["Record ID","Staff member"],["probation","Alex"]),
            Sheet("probation-1-Observations",["Record ID","Linked UCO record ID"],["probation","uco"]),
            Sheet("probation-7-Linked UCO Reviews",["Record ID","Lecturer","Signatory"],["uco","Alex","Sam"]) with {SourceModuleKey="probation",SourceSheetName="Linked UCO Reviews"},
            Sheet("probation-8-Linked UCO Developme",["Record ID","Target"],["uco","Develop inclusive assessment"]) with {SourceModuleKey="probation",SourceSheetName="Linked UCO Development Actions"},
            Sheet("elevate-environments-3-Pillar Ra",["Record ID","Judgement"],["probation","Secure"]) with {SourceModuleKey="elevate-environments",SourceSheetName="Pillar Ratings"});
        var safe=BusinessWorkbookExportBuilder.Build(source);
        Assert.Equal(5,safe.Sheets.Count);
        Assert.All(safe.Sheets,sheet=>Assert.Equal("Entry 0001",sheet.Rows[0][0]));
        Assert.Contains("Sam",safe.Sheets[2].Rows[0]);
        Assert.Contains("Develop inclusive assessment",safe.Sheets[3].Rows[0]);
        Assert.Contains("Secure",safe.Sheets[4].Rows[0]);
    }

    [Theory]
    [InlineData("row_version")]
    [InlineData("RowVersion")]
    [InlineData("visibilityStatus")]
    [InlineData("visible_to_staff")]
    [InlineData("canRemove")]
    public void Nested_control_properties_never_become_saved_form_columns(string property)
    {
        var answers=FormEntryExportBuilder.ExpandAnswers(Sheet("Form Answers",["Record ID","Question key","Question","Response type","Response"],
            ["record","form/context","Context","text",$"{{\"{property}\":\"internal-control\",\"notes\":\"Useful evidence\"}}"]));
        Assert.DoesNotContain(answers.Rows,row=>row[1]?.EndsWith("/"+property)==true);
        Assert.DoesNotContain(answers.Rows.Select(row=>row[4]),value=>value?.Contains("internal-control")==true);
        Assert.Contains(answers.Rows,row=>row[4]=="Useful evidence");
    }

    private static ExportSheet Sheet(string name,string[] columns,params string?[][] rows) => new(name,columns,rows,false);
    private static ExportWorkbookData Workbook(string module,params ExportSheet[] sheets) => new(module,"Dashboard",
        new("2026/27",null,null,null,null,null,null,null,null),"Test reviewer",DateTimeOffset.Parse("2026-10-29T12:00:00Z"),sheets);
}
