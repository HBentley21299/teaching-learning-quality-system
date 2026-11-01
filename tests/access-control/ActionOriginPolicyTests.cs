using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ActionOriginPolicyTests
{
    [Fact]
    public void Creation_requires_a_nonempty_record_reference()
    {
        Assert.Throws<WorkflowValidationException>(() => ActionOriginPolicy.RequireSourceRecord(null));
        Assert.Throws<WorkflowValidationException>(() => ActionOriginPolicy.RequireSourceRecord(Guid.Empty));
        var id = Guid.NewGuid(); Assert.Equal(id, ActionOriginPolicy.RequireSourceRecord(id));
    }

    [Theory]
    [InlineData("learning_walk", null, "learning_walk")]
    [InlineData("als_learning_walk", " ALS_LEARNING_WALK ", "als_learning_walk")]
    [InlineData("probation_case", "probation_observation", "probation_observation")]
    [InlineData("cpd_event", "cpd", "cpd_event")]
    [InlineData("work_scrutiny", "", "work_scrutiny")]
    [InlineData("liv", "liv", "liv")]
    public void Generic_actions_use_the_stored_process_including_supported_aliases(string recordType, string? claimed, string expected) =>
        Assert.Equal(expected, ActionOriginPolicy.ResolveForGenericCreation(recordType, claimed));

    [Theory]
    [InlineData("learning_walk", "standalone")]
    [InlineData("liv", "probation_observation")]
    [InlineData("cpd_event", "manual")]
    [InlineData("", null)]
    [InlineData("unrecognised", null)]
    [InlineData("standalone", "standalone")]
    [InlineData("uco_tla_review", "learning_walk")]
    [InlineData("qa_review", null)]
    [InlineData("coaching_session", "coaching_mentoring")]
    [InlineData("elevate_practice_assessment", "elevate_practice")]
    [InlineData("digital_learning_walk", null)]
    [InlineData("activate_growth_review", "manual")]
    public void Forged_and_native_workflow_origins_cannot_use_generic_creation(string recordType, string? claimed) =>
        Assert.Throws<WorkflowValidationException>(() => ActionOriginPolicy.ResolveForGenericCreation(recordType, claimed));

    [Fact]
    public void A_source_subject_cannot_be_replaced_by_an_unrelated_person()
    {
        var subject = Guid.NewGuid();
        Assert.Equal(subject, ActionOriginPolicy.ResolveSubject(subject, null));
        Assert.Equal(subject, ActionOriginPolicy.ResolveSubject(subject, subject));
        Assert.Throws<WorkflowValidationException>(() => ActionOriginPolicy.ResolveSubject(subject, Guid.NewGuid()));
        Assert.Throws<WorkflowValidationException>(() => ActionOriginPolicy.ResolveSubject(null, Guid.Empty));
    }

    [Fact]
    public void Subrecord_metadata_cannot_change_the_origin_process_or_claim_two_different_visits()
    {
        var visit = Guid.NewGuid(); var cycle = Guid.NewGuid();
        ActionOriginPolicy.ValidateSubRecord("liv", "liv_visit", visit, visit, cycle, "visit_1");
        ActionOriginPolicy.ValidateSubRecord("als_liv", "liv_cycle", cycle, null, cycle, null);
        ActionOriginPolicy.ValidateSubRecord("probation_observation", "probation_observation", visit, null, null, "observation_1");
        ActionOriginPolicy.ValidateSubRecord("cpd_event", null, null, null, null, null);
        Assert.Throws<WorkflowValidationException>(() => ActionOriginPolicy.ValidateSubRecord("cpd_event", "liv_visit", visit, null, null, null));
        Assert.Throws<WorkflowValidationException>(() => ActionOriginPolicy.ValidateSubRecord("liv", "probation_observation", visit, null, null, null));
        Assert.Throws<WorkflowValidationException>(() => ActionOriginPolicy.ValidateSubRecord("liv", "liv_visit", visit, Guid.NewGuid(), null, null));
        Assert.Throws<WorkflowValidationException>(() => ActionOriginPolicy.ValidateSubRecord("liv", "liv_cycle", cycle, null, Guid.NewGuid(), null));
        Assert.Throws<WorkflowValidationException>(() => ActionOriginPolicy.ValidateSubRecord("liv", "liv_visit", null, null, null, null));
        Assert.Throws<WorkflowValidationException>(() => ActionOriginPolicy.ValidateSubRecord("liv", null, visit, null, null, null));
    }
}
