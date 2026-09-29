using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class RoomCatalogueRulesTests
{
    [Theory]
    [InlineData(null, "Main building")]
    [InlineData("   ", "Main building")]
    [InlineData("A1", null)]
    [InlineData("A1", "   ")]
    public void RequiredValuesRejectMissingInput(string? code, string? building) =>
        Assert.Throws<WorkflowValidationException>(() => RoomCatalogueRules.Validate(code, building));

    [Fact]
    public void ValuesRespectExistingDatabaseColumnLimits()
    {
        Assert.Throws<WorkflowValidationException>(() => RoomCatalogueRules.Validate(new string('A', 51), "Building"));
        Assert.Throws<WorkflowValidationException>(() => RoomCatalogueRules.Validate("A1", new string('B', 201)));
        Assert.Equal(("A1", "Main building"), RoomCatalogueRules.Validate(" A1 ", " Main building "));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not-base64")]
    [InlineData("AQID")]
    public void UpdateRequiresAValidConcurrencyToken(string? version) =>
        Assert.Throws<WorkflowValidationException>(() => RoomCatalogueRules.ReadRowVersion(version));

    [Fact]
    public void StaleEditIsRejectedEvenWhenTheCodeIsUnchanged() =>
        Assert.Throws<RoomCatalogueConflictException>(() => RoomCatalogueRules.EnsureUpdateSafe([1], [2], "A1", "A1", 0));

    [Fact]
    public void ReferencedRoomCannotBeReassignedToAnotherCode() =>
        Assert.Throws<RoomCatalogueConflictException>(() => RoomCatalogueRules.EnsureUpdateSafe([1], [1], "A1", "A2", 1));

    [Fact]
    public void ReferencedRoomStillAllowsBuildingAndAvailabilityChanges() =>
        RoomCatalogueRules.EnsureUpdateSafe([1], [1], "A1", "A1", 3);

    [Fact]
    public void UnusedRoomAllowsCodeCorrection() =>
        RoomCatalogueRules.EnsureUpdateSafe([1], [1], "A1", "A2", 0);
}
