using TLQS.Api.V1;
using TLQS.Application.Workflows;

namespace TLQS.Api.Exports;

public static class QaFormEntryExportBuilder
{
    public static IReadOnlyList<ExportSheet> Build(IReadOnlyList<QaEvidenceDetail> entries, QaOutcomeLabels labels)
    {
        var primary = new ExportSheet("Submissions", ["Record ID", "Activity", "Status", "Faculty", "Teams", "Course or programme", "Course level", "Delivery area", "Staff member", "Reviewer", "Activity date", "Sample size", "Submitted at", "Version", "Contextual notes", "Evidence links", "Key strengths", "Areas for improvement", "Recommended actions", "Additional context"],
            entries.Select(detail => { var entry = detail.Evidence; return (IReadOnlyList<string?>)new string?[] {
                entry.Id.ToString(), entry.ActivityName, entry.Status, entry.FacultyName, string.Join("\n", detail.TeamNames), entry.CourseProgramme, entry.CourseLevel, entry.DeliveryAreaName,
                entry.SubjectStaffName, entry.ReviewerName, entry.ActivityAt.ToString("O"), entry.SampleSize?.ToString(), entry.SubmittedAt?.ToString("O"), entry.VersionNumber.ToString(),
                detail.ContextualNotes, string.Join("\n", detail.EvidenceLinks), detail.KeyStrengths, detail.AreasForImprovement, detail.RecommendedActions, detail.AdditionalContext }; }).ToArray(), false);
        var responses = new List<IReadOnlyList<string?>>();
        foreach (var detail in entries)
        foreach (var response in detail.Responses.OrderBy(item => item.DisplayOrder))
        {
            var outcome = response.Outcome switch { "below" => labels.Below, "at" => labels.At, "above" => labels.Above, "not_applicable" => labels.NotApplicable, "not_seen" => "Not seen", _ => response.Outcome };
            Add("outcome", "Outcome", outcome);
            Add("comment", "Evidence or comment", response.Comment);
            Add("not_applicable_reason", "Not applicable reason", response.NotApplicableReason);
            void Add(string suffix, string label, string? value) => responses.Add([detail.Evidence.Id.ToString(), detail.Evidence.ActivityName, detail.Evidence.VersionNumber.ToString(), response.ThemeOrWeek,
                $"qa/{response.ReviewQuestionId}/{suffix}", $"{response.QuestionText} - {label}", "text", value]);
        }
        var answers = new ExportSheet("Form Answers", ["Record ID", "Form template", "Form version", "Section", "Question key", "Question", "Response type", "Response"], responses, false);
        return [FormEntryExportBuilder.Flatten("Form entries", primary, "Record ID", answers), answers, FormEntryExportBuilder.Definitions(answers)];
    }
}
