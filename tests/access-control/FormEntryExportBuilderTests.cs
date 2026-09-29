using TLQS.Api.Exports;
using TLQS.Api.V1;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class FormEntryExportBuilderTests
{
    [Fact]
    public void Equivalent_work_scrutiny_faculty_copies_share_columns_but_custom_definitions_stay_distinct()
    {
        string[] columns = ["Record ID", "Form template", "Question key", "Section", "Question", "Response type", "Field configuration", "Options lookup", "Response"];
        string[] Row(string record, string template, string label = "Evidence", string config = "{\"options\":[\"Secure\"]}", string type = "rubric_scale", string section = "Practice") =>
            [record, template, $"{template}/practice/evidence", section, label, type, config, "lookup-a", record];
        var first = "work_scrutiny_quality_20000000-0000-0000-0000-000000000021";
        var second = "work_scrutiny_quality_20000000-0000-0000-0000-000000000022";
        var rows = new IReadOnlyList<string?>[] {
            Row("one", first), Row("two", second), Row("label", second, label: "Different evidence"),
            Row("config", second, config: "{\"options\":[\"Strong\"]}"), Row("type", second, type: "long_text"),
            Row("section", second, section: "Different section"), Row("custom", "work_scrutiny_custom") };
        var aligned = FormEntryExportBuilder.AlignWorkScrutinyClones(new ExportSheet("Form Answers", columns, rows, false));
        Assert.Equal(aligned.Rows[0][2], aligned.Rows[1][2]);
        Assert.Equal(6, aligned.Rows.Select(row => row[2]).Distinct().Count());
        Assert.Equal(first, aligned.Rows[0][1]);
        Assert.Equal(second, aligned.Rows[1][1]);
        Assert.Equal("work_scrutiny_custom/practice/evidence", aligned.Rows[6][2]);
        var flat = FormEntryExportBuilder.Flatten("Form entries", Entries("one", "two"), "Record ID", aligned);
        var questionColumn = flat.Columns.ToList().FindIndex(column => column.Contains(aligned.Rows[0][2]!));
        Assert.Equal("one", flat.Rows[0][questionColumn]);
        Assert.Equal("two", flat.Rows[1][questionColumn]);
    }

    private static readonly string[] AnswerColumns = ["Record ID", "Question key", "Question", "Response", "Response type", "Form version"];

    [Fact]
    public void Selected_theme_order_and_renamed_wording_do_not_move_answers_to_different_columns()
    {
        var answers = Answers(
            Answer("one", "walk/focuses", "Selected themes", """[{"focusId":"feedback","focusName":"Feedback","rating":"Secure"},{"focusId":"inclusion","focusName":"Inclusion","rating":"N/A"}]""", "long_text", "v1"),
            Answer("two", "walk/focuses", "Selected themes", """[{"focusId":"inclusion","focusName":"Inclusive practice","rating":"Strong"},{"focusId":"feedback","focusName":"Useful feedback","rating":"Developing"}]""", "long_text", "v2"));
        var expanded = FormEntryExportBuilder.ExpandAnswers(answers);
        var result = FormEntryExportBuilder.Flatten("Form entries", Entries("one", "two"), "Record ID", expanded);
        Assert.Equal(2, result.Rows.Count);
        Assert.Equal("Secure", Value(result, "one", "walk/focuses/feedback/rating"));
        Assert.Equal("Developing", Value(result, "two", "walk/focuses/feedback/rating"));
        Assert.Equal("N/A", Value(result, "one", "walk/focuses/inclusion/rating"));
        Assert.Equal("Strong", Value(result, "two", "walk/focuses/inclusion/rating"));
        Assert.Single(result.Columns, column => column.EndsWith("[walk/focuses/feedback/rating]"));
        var definition = FormEntryExportBuilder.Definitions(expanded).Rows.Single(row => row[0] == "walk/focuses/feedback/rating");
        Assert.Contains("Feedback", definition[1]);
        Assert.Contains("Useful feedback", definition[1]);
        Assert.Contains("v1", definition[2]);
        Assert.Contains("v2", definition[2]);
    }

    [Fact]
    public void Missing_not_applicable_and_unselected_questions_stay_distinct_without_cross_entry_leakage()
    {
        var result = FormEntryExportBuilder.Flatten("Form entries", Entries("one", "two", "three"), "Record ID", Answers(
            Answer("two", "sample/count", "Learners sampled", "7", "number"),
            Answer("one", "sample/count", "Learners sampled", null, "number"),
            Answer("one", "sample/rating", "Rating", "N/A"),
            Answer("two", "sample/rating", "Rating", "Secure"),
            Answer("outside", "sample/rating", "Rating", "Outside permission scope")));
        Assert.Null(Value(result, "one", "sample/count"));
        Assert.Equal("7", Value(result, "two", "sample/count"));
        Assert.Equal("N/A", Value(result, "one", "sample/rating"));
        Assert.Null(Value(result, "three", "sample/rating"));
        Assert.DoesNotContain(result.Rows.SelectMany(row => row), value => value?.Contains("Outside permission scope") == true);
        Assert.Equal("number", result.ColumnTypes![ColumnIndex(result, "sample/count")]);
    }

    [Fact]
    public void Versions_share_stable_questions_and_retain_retired_or_new_questions()
    {
        var source = Answers(
            Answer("one", "scrutiny/sample/size", "Sample count", "4", "number", "2025"),
            Answer("two", "scrutiny/sample/size", "Number of learners", "9", "number", "2026"),
            Answer("one", "scrutiny/old/question", "Retired question", "Historical answer", "text", "2025"),
            Answer("two", "scrutiny/new/question", "New question", "Current answer", "text", "2026"));
        var result = FormEntryExportBuilder.Flatten("Form entries", Entries("one", "two"), "Record ID", source);
        Assert.Equal(5, result.Columns.Count);
        Assert.Equal("2025", result.Rows[0][result.Columns.ToList().IndexOf("Form version")]);
        Assert.Equal("2026", result.Rows[1][result.Columns.ToList().IndexOf("Form version")]);
        Assert.Equal("4", Value(result, "one", "scrutiny/sample/size"));
        Assert.Equal("9", Value(result, "two", "scrutiny/sample/size"));
        Assert.Null(Value(result, "one", "scrutiny/new/question"));
        Assert.Null(Value(result, "two", "scrutiny/old/question"));
        var definition = FormEntryExportBuilder.Definitions(source).Rows.Single(row => row[0] == "scrutiny/sample/size");
        Assert.Equal("Sample count\nNumber of learners", definition[1]);
        Assert.Equal("2025\n2026", definition[2]);
    }

    [Fact]
    public void Multi_select_and_nested_json_keep_all_selected_values_and_evidence()
    {
        var source = Answers(
            Answer("one", "sample/evidence", "Evidence", "Digital|Paper|Practical", "multi_select"),
            Answer("two", "sample/evidence", "Evidence", "[\"Digital\",\"Portfolio\"]", "checkbox_group"),
            Answer("one", "sample/context", "Context", """{"attendance":{"present":12,"notes":"First line\nSecond line"},"learners":[{"support":"SEND","count":2},{"support":"English","count":3}]}"""));
        var result = FormEntryExportBuilder.Flatten("Form entries", Entries("one", "two"), "Record ID", FormEntryExportBuilder.ExpandAnswers(source));
        Assert.Equal("Digital\nPaper\nPractical", Value(result, "one", "sample/evidence"));
        Assert.Equal("Digital\nPortfolio", Value(result, "two", "sample/evidence"));
        Assert.Contains("present: 12", Value(result, "one", "sample/context/attendance"));
        Assert.Contains("First line\nSecond line", Value(result, "one", "sample/context/attendance"));
        Assert.Contains("SEND", Value(result, "one", "sample/context/learners"));
        Assert.Contains("English", Value(result, "one", "sample/context/learners"));
        Assert.Contains("count: 2", Value(result, "one", "sample/context/learners"));
        Assert.Contains("count: 3", Value(result, "one", "sample/context/learners"));
        Assert.Null(Value(result, "two", "sample/context/attendance"));
    }

    [Fact]
    public void Different_form_namespaces_do_not_merge_equally_worded_questions()
    {
        var result = FormEntryExportBuilder.Flatten("Form entries", Entries("one", "two"), "Record ID", Answers(
            Answer("one", "learning_walk/context/date", "Date", "2026-09-08", "date"),
            Answer("two", "work_scrutiny/context/date", "Date", "2026-09-09", "date")));
        Assert.Equal(4, result.Columns.Count);
        Assert.Equal("2026-09-08", Value(result, "one", "learning_walk/context/date"));
        Assert.Null(Value(result, "one", "work_scrutiny/context/date"));
    }

    [Fact]
    public void Duplicate_entry_ids_fail_instead_of_publishing_ambiguous_rows()
    {
        Assert.Throws<WorkflowValidationException>(() => FormEntryExportBuilder.Flatten("Form entries", Entries("one", "one"), "Record ID", Answers()));
    }

    [Fact]
    public void Repeat_items_have_separate_typed_columns_and_do_not_shift_when_a_value_is_missing()
    {
        var children = new ExportSheet("Actions", ["Record ID", "Title", "Due date"],
            [new string?[] { "one", "First", null }, new string?[] { "one", "Second", "2026-10-01" }, new string?[] { "two", "Other", "2026-09-01" }], false, ["text", "text", "date"]);
        var result = FormEntryExportBuilder.Flatten("Form entries", Entries("one", "two"), "Record ID", children);
        Assert.Equal(2, result.Rows.Count);
        Assert.Equal(new string?[] { "one", "First", null, "Second", "2026-10-01" }, result.Rows[0]);
        Assert.Equal(new string?[] { "two", "Other", "2026-09-01", null, null }, result.Rows[1]);
        Assert.Equal("Actions 2 - Due date", result.Columns[4]);
        Assert.Equal("date", result.ColumnTypes![4]);
    }

    private static ExportSheet Entries(params string[] ids) => new("Reviews", ["Record ID"], ids.Select(id => (IReadOnlyList<string?>)new[] { id }).ToArray(), false);
    private static ExportSheet Answers(params IReadOnlyList<string?>[] rows) => new("Form Answers", AnswerColumns, rows, false);
    private static IReadOnlyList<string?> Answer(string record, string key, string label, string? value, string type = "text", string version = "v1") => [record, key, label, value, type, version];
    private static int ColumnIndex(ExportSheet sheet, string key) => sheet.Columns.ToList().FindIndex(column => column.EndsWith($"[{key}]"));
    private static string? Value(ExportSheet sheet, string record, string key) => sheet.Rows.Single(row => row[0] == record)[ColumnIndex(sheet, key)];
}
