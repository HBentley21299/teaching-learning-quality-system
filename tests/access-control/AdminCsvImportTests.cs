using Microsoft.AspNetCore.DataProtection;
using System.Text.Json;
using TLQS.Api.Data;
using TLQS.Api.Security;
using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class AdminCsvImportTests
{
    [Fact]
    public void Quoted_fields_bom_commas_quotes_and_multiline_answers_remain_complete()
    {
        var table = AdminCsvReader.Parse("\uFEFFreference,answer\r\nA1,\"Modelling, then \"\"practice\"\"\r\nwith feedback\"\r\n");
        Assert.Equal(2, Assert.Single(table.Rows).Number);
        Assert.Equal("Modelling, then \"practice\"\r\nwith feedback", table.Rows[0].Values["ANSWER"]);
        Assert.Equal("A1", AdminCsvReader.Get(table.Rows[0], "reference"));
    }

    [Theory]
    [InlineData("a,A\nx,y")]
    [InlineData("a,\nx,y")]
    [InlineData("a,b\nx")]
    [InlineData("a\n\"unfinished")]
    [InlineData("a\n\"closed\"junk")]
    [InlineData("a\nbad\"quote")]
    [InlineData("a\nx\0")]
    [InlineData("a\nx\uFFFD")]
    [InlineData("a\n")]
    public void Malformed_or_unreadable_files_are_rejected(string csv) => Assert.Throws<WorkflowValidationException>(() => AdminCsvReader.Parse(csv));

    [Fact]
    public void Resource_limits_are_enforced_without_truncation()
    {
        Assert.Throws<WorkflowValidationException>(() => AdminCsvReader.Parse("x\n" + new string('é', AdminCsvReader.MaximumBytes)));
        Assert.Throws<WorkflowValidationException>(() => AdminCsvReader.Parse("x\n" + string.Join('\n', Enumerable.Repeat("answer", 1001))));
        Assert.Equal(1000, AdminCsvReader.Parse("x\n" + string.Join('\n', Enumerable.Repeat("answer", 1000))).Rows.Count);
    }

    [Fact]
    public void Trailing_empty_cells_and_case_insensitive_headers_are_retained()
    {
        var table = AdminCsvReader.Parse("A,b,c\nx,,\r\n");
        Assert.Equal("x", table.Rows[0].Values["a"]);
        Assert.Equal("", table.Rows[0].Values["c"]);
        Assert.Empty(AdminCsvReader.ValidateHeaders(table, ["a"], ["B", "C"]));
        Assert.Equal(2, AdminCsvReader.ValidateHeaders(table, ["missing"], ["a", "b"]).Count);
    }

    [Fact]
    public void Blank_rows_are_ignored_without_changing_reported_row_positions()
    {
        var table = AdminCsvReader.Parse("reference,answer\n\nA1,\"First line\nSecond line\"\n\nA2,Final");
        Assert.Equal(new[] { 3, 5 }, table.Rows.Select(row => row.Number));
        Assert.Equal("First line\nSecond line", table.Rows[0].Values["answer"]);
    }

    private static CurrentUser User(bool administrator = true, params string[] permissions) => new(Guid.NewGuid(), Guid.NewGuid(), "Admin", "admin@example.org", permissions.ToHashSet(), []) { IsAdministrator = administrator };

    [Theory]
    [InlineData("qa-questions", "qa_reviews.manage")]
    [InlineData("cpd-events", "cpd.manage")]
    [InlineData("cpd-events", "cpd.mandatory_log")]
    [InlineData("managed-list-values", "lists.manage")]
    public void Administrative_permissions_alone_do_not_grant_import(string kind, string permission)
    {
        Assert.False(AdminCsvAccess.CanUse(User(false, permission), kind));
        Assert.False(AdminCsvAccess.CanUse(User(true), kind));
        Assert.True(AdminCsvAccess.CanUse(User(true, permission), kind));
        Assert.False(AdminCsvAccess.CanUse(User(true, permission) with { UserAccountId = null }, kind));
    }

    [Fact]
    public void Preview_token_is_bound_to_exact_file_kind_actor_and_integrity()
    {
        var protection = new EphemeralDataProtectionProvider();
        var user = User(true, "qa_reviews.manage");
        var token = AdminCsvPreviewTokens.Create(protection, user, "qa-questions", "first file", "fingerprint");
        Assert.Equal("fingerprint", AdminCsvPreviewTokens.Read(protection, user, "qa-questions", "first file", token));
        Assert.Throws<WorkflowValidationException>(() => AdminCsvPreviewTokens.Read(protection, user, "qa-questions", "changed file", token));
        Assert.Throws<WorkflowValidationException>(() => AdminCsvPreviewTokens.Read(protection, user, "cpd-events", "first file", token));
        Assert.Throws<WorkflowValidationException>(() => AdminCsvPreviewTokens.Read(protection, user with { UserAccountId = Guid.NewGuid() }, "qa-questions", "first file", token));
        Assert.Throws<WorkflowValidationException>(() => AdminCsvPreviewTokens.Read(protection, user, "qa-questions", "first file", token + "tampered"));
    }

    [Fact]
    public void Expired_previews_require_a_new_preview()
    {
        var provider = new EphemeralDataProtectionProvider();
        var user = User(true, "qa_reviews.manage");
        var payload = JsonSerializer.Serialize(new { UserId = user.UserAccountId, Kind = "qa-questions", CsvHash = AdminCsvReader.Hash("file"), Fingerprint = "hash", ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1) });
        var token = provider.CreateProtector("TLQS.AdminCsvPreview.v1").Protect(payload);
        Assert.Throws<WorkflowValidationException>(() => AdminCsvPreviewTokens.Read(provider, user, "qa-questions", "file", token));
    }

    private static readonly ManagedCsvList Themes = new(Guid.NewGuid(), "cpd_theme", "CPD themes");

    [Fact]
    public void List_import_is_add_only_rejects_system_lists_and_never_reactivates_conflicts()
    {
        var existing = new[] { new ManagedCsvValue(Guid.NewGuid(), Themes.Id, "old", "Existing theme", 10, false) };
        var table = AdminCsvReader.Parse("lookup_key,value_key,display_name\ncpd_theme,new,New theme\ncpd_theme,old,Existing theme\naction_status,override,Workflow override");
        var plan = ManagedListCsvPlanner.Validate(table, [Themes], existing, new Dictionary<string, string>());
        Assert.Single(plan.Candidates);
        Assert.Equal(2, plan.Issues.Count);
        Assert.Equal(["create", "error", "error"], plan.Rows.Select(row => row.Operation));
        Assert.Equal("New theme", plan.Rows[0].Values["display_name"]);
    }

    [Fact]
    public void Reimporting_identical_implicit_order_keeps_the_same_key_and_payload_hash()
    {
        var table = AdminCsvReader.Parse("lookup_key,display_name\ncpd_theme,Retrieval practice");
        var initial = ManagedListCsvPlanner.Validate(table, [Themes], [], new Dictionary<string, string>());
        var candidate = Assert.Single(initial.Candidates);
        Assert.Equal("retrieval_practice", candidate.ValueKey);
        var existing = new[] { new ManagedCsvValue(Guid.NewGuid(), Themes.Id, candidate.ValueKey, candidate.DisplayName, 500, true) };
        var replay = ManagedListCsvPlanner.Validate(table, [Themes], existing, new Dictionary<string, string> { [candidate.Reference] = candidate.PayloadHash });
        Assert.Empty(replay.Candidates);
        Assert.Empty(replay.Issues);
        Assert.Equal("skip", Assert.Single(replay.Rows).Operation);
        var changed = ManagedListCsvPlanner.Validate(AdminCsvReader.Parse("lookup_key,value_key,display_name\ncpd_theme,retrieval_practice,Changed wording"), [Themes], existing, new Dictionary<string, string> { [candidate.Reference] = candidate.PayloadHash });
        Assert.Single(changed.Issues);
        Assert.Empty(changed.Candidates);
    }
}
