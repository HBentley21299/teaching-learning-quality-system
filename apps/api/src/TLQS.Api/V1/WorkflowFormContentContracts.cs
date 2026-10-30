namespace TLQS.Api.V1;

public sealed record WorkflowFormContent(string FormKey, string Title, IReadOnlyList<WorkflowFormContentField> Fields, string? RowVersion = null);
public sealed record WorkflowFormContentField(string Key, string Label, string? HelpText = null);
public sealed record SaveWorkflowFormContentRequest(IReadOnlyList<WorkflowFormContentField> Fields, string? RowVersion);
