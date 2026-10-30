using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class FormCustomisationRulesTests
{
    [Fact]
    public void Additional_questions_stay_editable_inside_reserved_Work_Scrutiny_sections()
    {
        foreach (var key in new[] { "context", "sample", "actions" })
        {
            Assert.True(FormAdministrationRules.IsProtected("work_scrutiny", key, "legacy_core"));
            Assert.False(FormAdministrationRules.IsProtected("work_scrutiny", key, "custom_followup"));
            var core = new AdminFormField(Guid.NewGuid(), "legacy_core", "Core prompt", "short_text", false, 1, null, [], true);
            var additional = new AdminFormField(Guid.NewGuid(), "custom_followup", "Follow up", "long_text", false, 2, null, [], false);
            var baseline = new[] { new AdminFormSection(Guid.NewGuid(), key, "Section", 1, [core, additional]) };
            var keepCore = new FormStructureFieldRequest(core.FieldKey, core.Label, core.FieldType, core.IsRequired, 1, null, []);
            FormAdministrationRules.Validate("work_scrutiny", baseline, new("Form", null, "token", [new(key, "Section", 1, [keepCore])]));
            FormAdministrationRules.Validate("work_scrutiny", baseline, new("Form", null, "token", [new(key, "Section", 1,
                [keepCore, new(additional.FieldKey, additional.Label, "number", true, 2, null, [])])]));
        }
    }

    [Fact]
    public void Only_Work_Scrutiny_can_prepare_an_empty_draft_and_existing_core_fields_stay_protected()
    {
        var empty = new SaveFormVersionRequest("New scrutiny", null, "token", []);
        FormAdministrationRules.Validate("work_scrutiny", [], empty);
        Assert.Throws<WorkflowValidationException>(() => FormAdministrationRules.Validate("cpd", [], empty));
        var core = new AdminFormField(Guid.NewGuid(), "qualification_level", "Course level", "single_select", true, 10, null, ["Level 1", "Level 2"], true);
        Assert.Throws<WorkflowValidationException>(() => FormAdministrationRules.Validate("work_scrutiny", [new(Guid.NewGuid(), "workflow_context", "Context", 0, [core])], empty));
    }

    [Fact]
    public void Editors_can_change_wording_and_add_questions_without_removing_controlled_fields()
    {
        var core = new AdminFormField(Guid.NewGuid(), "session_date", "Session date", "date", true, 10, null, [], true);
        var baseline = new[] { new AdminFormSection(Guid.NewGuid(), "context", "Context", 1, [core]) };
        var request = new SaveFormVersionRequest("Updated form", null, "token", [new("context", "Before the session", 1,
            [new(core.FieldKey, "Date of the session", "date", true, 10, "Use the actual date.", []), new("custom_follow_up", "What happens next?", "long_text", false, 20, null, [])])]);
        FormAdministrationRules.Validate("cpd", baseline, request);
        foreach (var changed in new[]
        {
            request with { Sections = [request.Sections[0] with { Fields = request.Sections[0].Fields.Skip(1).ToArray() }] },
            request with { Sections = [request.Sections[0] with { Fields = [request.Sections[0].Fields[0] with { IsRequired = false }] }] },
            request with { Sections = [request.Sections[0] with { Fields = [request.Sections[0].Fields[0] with { FieldType = "short_text" }] }] }
        }) Assert.Throws<WorkflowValidationException>(() => FormAdministrationRules.Validate("cpd", baseline, changed));
    }

    [Theory]
    [InlineData("[]", "checkbox_group", false)]
    [InlineData("[\"A\"]", "multi_select", true)]
    [InlineData("not JSON", "multi_select", false)]
    [InlineData(" ", "long_text", false)]
    [InlineData("0", "number", true)]
    public void Required_answers_use_actual_content(string answer, string type, bool expected) => Assert.Equal(expected, FormAnswerRules.IsAnswered(answer, type));

    [Theory]
    [InlineData("number", "12.25", true)]
    [InlineData("number", "NaN", false)]
    [InlineData("number", "1,000", false)]
    [InlineData("date", "2026-02-28", true)]
    [InlineData("date", "2026-02-30", false)]
    [InlineData("single_select", "A", true)]
    [InlineData("single_select", "Retired", false)]
    [InlineData("multi_select", "[\"A\",\"B\"]", true)]
    [InlineData("multi_select", "[\"A\",\"A\"]", false)]
    [InlineData("multi_select", "[\"Unknown\"]", false)]
    [InlineData("checkbox_group", "[5]", false)]
    [InlineData("yes_no_partial", "Partially", true)]
    public void Custom_answer_types_and_options_are_enforced_on_the_server(string type, string value, bool valid)
    {
        void Validate() => FormAnswerRules.ValidateCustomAnswer("custom_followup", type, "Follow up", ["A", "B"], value);
        if (valid) Validate(); else Assert.Throws<WorkflowValidationException>(Validate);
    }

    [Fact]
    public void Workflow_content_catalogue_covers_all_prompts_and_rejects_unknown_or_missing_answer_keys()
    {
        Assert.Equal(6, WorkflowFormContentCatalog.Forms.Count);
        Assert.Equal(47, WorkflowFormContentCatalog.Forms.Sum(form => form.Fields.Count));
        foreach (var form in WorkflowFormContentCatalog.Forms)
        {
            Assert.Equal(form.Fields.Count, form.Fields.Select(field => field.Key).Distinct().Count());
            var valid = new SaveWorkflowFormContentRequest(form.Fields.Select(field => field with { Label = $"Updated {field.Label}" }).ToArray(), null);
            Assert.Equal(form.Fields.Count, WorkflowFormContentCatalog.Validate(form.FormKey, valid).Fields.Count);
            Assert.Throws<WorkflowValidationException>(() => WorkflowFormContentCatalog.Validate(form.FormKey, valid with { Fields = valid.Fields.Skip(1).ToArray() }));
            Assert.Throws<WorkflowValidationException>(() => WorkflowFormContentCatalog.Validate(form.FormKey, valid with { Fields = valid.Fields.Select((field, index) => index == 0 ? field with { Key = "unknown" } : field).ToArray() }));
            Assert.Throws<WorkflowValidationException>(() => WorkflowFormContentCatalog.Validate(form.FormKey, valid with { Fields = valid.Fields.Select((field, index) => index == 0 ? field with { Label = " " } : field).ToArray() }));
        }
    }
}
