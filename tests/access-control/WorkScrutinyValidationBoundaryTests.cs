using System.Collections;
using System.Reflection;
using System.Runtime.ExceptionServices;
using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class WorkScrutinyValidationBoundaryTests
{
    [Theory]
    [InlineData("multi_select", "[\"Digital | practical\",\"Feedback\"]", true)]
    [InlineData("checkbox_group", "[\"Digital | practical\"]", true)]
    [InlineData("multi_select", "[]", false)]
    [InlineData("checkbox_group", "[]", false)]
    public async Task Both_api_validation_layers_accept_the_consumers_custom_choice_payload(string type, string value, bool required) =>
        await ValidateAsync(type, value, required);

    [Theory]
    [InlineData("multi_select", "[]")]
    [InlineData("checkbox_group", "[]")]
    [InlineData("multi_select", null)]
    public async Task The_shared_required_validator_rejects_an_empty_custom_selection_after_domain_validation(string type, string? value)
    {
        var failure = await Assert.ThrowsAsync<WorkflowValidationException>(() => ValidateAsync(type, value, true));
        Assert.Contains("Complete the required fields", failure.Message);
    }

    [Theory]
    [InlineData("multi_select", "Feedback|Digital | practical")]
    [InlineData("checkbox_group", "[\"Unknown\"]")]
    [InlineData("multi_select", "[\"Feedback\",\"Feedback\"]")]
    [InlineData("checkbox_group", "[5]")]
    public async Task The_api_domain_boundary_rejects_invalid_custom_answers_before_the_shared_validator(string type, string value)
    {
        var failure = await Assert.ThrowsAsync<WorkflowValidationException>(() => ValidateAsync(type, value, false));
        Assert.Contains("Choose a configured response", failure.Message);
    }

    private static async Task ValidateAsync(string type, string? value, bool required)
    {
        var store = typeof(SqlFoundationDataStore);
        var fieldType = store.GetNestedType("FormFieldInfo", BindingFlags.NonPublic)!;
        var fields = (IDictionary)Activator.CreateInstance(typeof(Dictionary<,>).MakeGenericType(typeof(Guid), fieldType))!;
        var fieldId = Guid.NewGuid();
        fields.Add(fieldId, Activator.CreateInstance(fieldType,
            [type, "custom_evidence", required, "Evidence", new[] { "Digital | practical", "Feedback" }, "additional"]));
        var responses = new[] { new SubmitFormResponseRequest(fieldId, value) };
        Invoke("ValidateWorkScrutinyResponses", [fields, responses]);
        // Work Scrutiny validation makes no SQL calls. Invoke the real shared validator with the same fields and answers.
        await (Task)Invoke("ValidateFormAnswersAsync", [null, null, fields, responses, "work_scrutiny", true, CancellationToken.None])!;

        object? Invoke(string method, object?[] arguments)
        {
            try { return store.GetMethod(method, BindingFlags.Static | BindingFlags.NonPublic)!.Invoke(null, arguments); }
            catch (TargetInvocationException exception) when (exception.InnerException is not null)
            { ExceptionDispatchInfo.Capture(exception.InnerException).Throw(); throw; }
        }
    }
}
