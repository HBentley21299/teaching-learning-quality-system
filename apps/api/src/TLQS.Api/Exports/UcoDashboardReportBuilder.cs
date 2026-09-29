using TLQS.Api.V1;

namespace TLQS.Api.Exports;

public static class UcoDashboardReportBuilder
{
    public static DashboardReportData Build(UcoTlaDashboardSummary dashboard, DateTimeOffset now)
    {
        var reviews = dashboard.Reviews;
        DashboardReportMetric Metric(string label, int value) => new(label, value.ToString(System.Globalization.CultureInfo.InvariantCulture));
        DashboardReportItem Review(UcoTlaReviewSummary row) => new(row.LecturerName,
            [new("Course", row.CourseTitle), new("Module", row.ModuleTitle), new("Observer", row.ObserverName),
             new("Workflow", row.WorkflowStatus.Replace('_', ' ')), new("Observation", row.ObservationAt?.ToString("dd MMM yyyy HH:mm")),
             new("Sections marked", $"{row.CompletedSectionCount}/7"), new("Open actions", row.OpenActionCount.ToString()),
             new("Overdue actions", row.OverdueActionCount.ToString()), new("Follow-up", row.FollowUpAt?.ToString("dd MMM yyyy HH:mm")),
             new("Follow-up status", row.FollowUpStatus)]);
        bool NeedsAttention(UcoTlaReviewSummary row) => row.OverdueActionCount > 0
            || row.FollowUpStatus == "scheduled" && row.FollowUpAt <= now.AddDays(14)
            || row.WorkflowStatus is "awaiting_finalisation" or "awaiting_lecturer"
            || row.WorkflowStatus == "observer_draft" && (row.ObservationAt is null || row.ObservationAt < now);
        return new(
            [Metric("Reviews this year", dashboard.ReviewsThisYear), Metric("Completed reviews", dashboard.CompletedReviews),
             Metric("In progress", reviews.Count(row => row.WorkflowStatus != "completed")), Metric("Active UCO staff", dashboard.ActiveUcoStaff),
             Metric("Staff covered", dashboard.CoveredUcoStaff), new("Staff coverage", $"{dashboard.CoveragePercent}%"),
             Metric("Awaiting lecturer", dashboard.AwaitingLecturer), Metric("Follow-ups due", dashboard.FollowUpsDue),
             Metric("Open actions", dashboard.OpenActions), Metric("Overdue actions", dashboard.OverdueActions),
             new("Sections marked", $"{(reviews.Count == 0 ? 0 : Math.Round(reviews.Sum(row => row.CompletedSectionCount) * 100m / (reviews.Count * 7), MidpointRounding.AwayFromZero))}%"),
             Metric("Observations in next 30 days", reviews.Count(row => row.ObservationAt >= now && row.ObservationAt <= now.AddDays(30)))],
            [new("Where reviews are now", "All workflow stages.", [new("Workflow", [],
                new[] { "observer_draft", "awaiting_lecturer", "awaiting_finalisation", "completed" }.Select(status =>
                    new DashboardReportDistribution(status.Replace('_', ' '), reviews.Count(row => row.WorkflowStatus == status))).ToArray())]),
             new("What needs progressing", "Every review needing attention; expanded beyond the dashboard preview.", reviews.Where(NeedsAttention).Select(Review).ToArray()),
             new("Practice highlights", "Qualitative evidence, shown as written without a teaching rating.", dashboard.PracticeHighlights.Select(row =>
                new DashboardReportItem($"{row.LecturerName} - {row.Category}", [new("Course", row.CourseTitle), new("Module", row.ModuleTitle), new("Observation", row.ObservationAt.ToString("dd MMM yyyy")), new("Narrative", row.Narrative)])).ToArray()),
             new("UCO review register", "Every review in the authorised dashboard scope.", reviews.Select(Review).ToArray())]);
    }
}
