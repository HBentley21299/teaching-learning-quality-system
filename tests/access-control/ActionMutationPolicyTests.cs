using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ActionMutationPolicyTests
{
    [Theory]
    [InlineData("qa_review")]
    [InlineData("uco_tla_review")]
    [InlineData("coaching_mentoring")]
    [InlineData("coaching_session")]
    [InlineData("elevate_practice")]
    [InlineData("elevate_practice_assessment")]
    public void Linked_native_structure_and_removal_use_the_source_while_central_progress_remains_available(string type)
    {
        var record=Guid.NewGuid();
        Assert.Throws<WorkflowValidationException>(()=>ActionMutationPolicy.ValidateGenericMutation(record,type,GenericActionMutation.Update,true));
        Assert.Throws<WorkflowValidationException>(()=>ActionMutationPolicy.ValidateGenericMutation(record,type,GenericActionMutation.Delete));
        Assert.Throws<WorkflowValidationException>(()=>ActionMutationPolicy.ValidateGenericMutation(record,type,GenericActionMutation.Restore));
        ActionMutationPolicy.ValidateGenericMutation(record,type,GenericActionMutation.Update);
        ActionMutationPolicy.ValidateGenericMutation(record,type,GenericActionMutation.Extend);
        ActionMutationPolicy.ValidateGenericMutation(null,type,GenericActionMutation.Update,true);
        ActionMutationPolicy.ValidateGenericMutation(null,type,GenericActionMutation.Delete);
        ActionMutationPolicy.ValidateGenericMutation(null,type,GenericActionMutation.Restore);
    }

    [Fact]
    public void Qa_action_work_can_continue_after_review_closure_but_not_group_closure_or_archival()
    {
        ActionMutationPolicy.ValidateQaProgress("open","closed",false);
        ActionMutationPolicy.ValidateQaProgress("reviewed","closed",false);
        Assert.Throws<WorkflowValidationException>(()=>ActionMutationPolicy.ValidateQaProgress("closed","closed",false));
        Assert.Throws<WorkflowValidationException>(()=>ActionMutationPolicy.ValidateQaProgress("archived","closed",false));
        Assert.Throws<WorkflowValidationException>(()=>ActionMutationPolicy.ValidateQaProgress("open","archived",false));
        Assert.Throws<WorkflowValidationException>(()=>ActionMutationPolicy.ValidateQaProgress("open","closed",true));
    }
}
