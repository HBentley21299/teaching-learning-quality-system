using TLQS.Api.Exports;
using TLQS.Api.V1;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class QaFormEntryExportTests
{
    [Fact]
    public void Evidence_has_one_row_with_separate_dynamic_criteria_and_neutral_outcomes()
    {
        var question = Guid.NewGuid();
        var first = Detail("not_seen", "No opportunity", question);
        var second = Detail("at", "Evidence of secure work", question);
        var sheets = QaFormEntryExportBuilder.Build([first, second], new("Developing", "Secure", "Strong", "Not relevant"));
        var entries = sheets[0];
        Assert.Equal(2, entries.Rows.Count);
        var outcome = entries.Columns.ToList().FindIndex(column => column.EndsWith($"[qa/{question}/outcome]"));
        var comment = entries.Columns.ToList().FindIndex(column => column.EndsWith($"[qa/{question}/comment]"));
        Assert.Equal("Not seen", entries.Rows[0][outcome]);
        Assert.Equal("Secure", entries.Rows[1][outcome]);
        Assert.Equal("No opportunity", entries.Rows[0][comment]);
        Assert.Contains("Feedback", entries.Columns[outcome]);
        Assert.Equal("Course evidence", entries.Rows[0][14]);
    }

    [Fact]
    public void Omitting_editor_capabilities_and_revision_history_preserves_every_export_cell()
    {
        var original = Detail("not_applicable", "No course evidence in scope", Guid.NewGuid());
        original = original with
        {
            Evidence = original.Evidence with { CanEdit = true, CanRemove = true, VersionNumber = 6 },
            TeamNames = ["Digital", "Computing"],
            Revisions = [new QaEvidenceRevisionSummary(6, "Correction", "Reviewer", DateTimeOffset.UtcNow)],
            Responses = [original.Responses[0] with { NotApplicableReason = "Outside this review" },
                new QaEvidenceResponseSummary(Guid.NewGuid(), "Practice", "Was practical work observed?", null, 2, true, false, false, "not_seen", "No opportunity", null, true)]
        };
        var exportOnly = original with { Evidence = original.Evidence with { CanEdit = false, CanRemove = false }, Revisions = [] };
        var expected = QaFormEntryExportBuilder.Build([original], QaOutcomeLabels.Default);
        var actual = QaFormEntryExportBuilder.Build([exportOnly], QaOutcomeLabels.Default);
        Assert.Equal(expected.Count, actual.Count);
        for (var index = 0; index < expected.Count; index++)
        {
            Assert.Equal(expected[index].Name, actual[index].Name);
            Assert.Equal(expected[index].Columns.ToArray(), actual[index].Columns.ToArray());
            Assert.Equal(expected[index].Rows.Count, actual[index].Rows.Count);
            for (var row = 0; row < expected[index].Rows.Count; row++)
                Assert.Equal(expected[index].Rows[row].ToArray(), actual[index].Rows[row].ToArray());
        }
        Assert.Equal("6", actual[0].Rows[0][13]);
        Assert.Contains("Outside this review", actual[0].Rows[0]);
        Assert.Contains("Not seen", actual[0].Rows[0]);
    }

    private static QaEvidenceDetail Detail(string outcome, string comment, Guid question) => new(
        new QaEvidenceSummary(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "Learning walk", "submitted", Guid.NewGuid(), "Faculty", "Team", "Programme", "Level 3", null, Guid.NewGuid(), "Reviewer", DateTimeOffset.UtcNow, 5, 1, DateTimeOffset.UtcNow, 1, [], false, false),
        [], ["Team"], "Course evidence", [], "Strengths", "Improvements", "Actions", null, null,
        [new QaEvidenceResponseSummary(question, "Feedback", "Do learners use feedback?", null, 1, true, true, false, outcome, comment, null, true)], []);
}
