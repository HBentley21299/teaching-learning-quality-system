using System.Data;
using System.Reflection;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class FormAdministrationDatabaseTheoryAttribute : TheoryAttribute
{
    public FormAdministrationDatabaseTheoryAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("TLQS_TEST_SQL_MASTER")))
            Skip = "Set TLQS_TEST_SQL_MASTER to an isolated local master connection to run database-boundary tests.";
    }
}

[Collection("List query database checks")]
public sealed class FormAdministrationDatabaseTests
{
    private static readonly CancellationToken Token = CancellationToken.None;

    [AccountAdministrationDatabaseFact]
    public async Task Copy_save_publish_history_and_pinned_versions_preserve_published_submissions()
    {
        await using var db = await FormDatabase.CreateAsync();
        var store = db.Store(); var user = db.User();
        var published = (await store.GetFormTemplateAdministrationAsync(db.TemplateId, db.PublishedId, user, Token))!;
        Assert.Equal("Published", published.Status); Assert.Equal(1, published.SubmissionCount);
        var oldCore = Assert.Single(published.Sections.SelectMany(section => section.Fields));
        var draftId = await store.CreateFormVersionDraftAsync(db.TemplateId, published.VersionId, user, Token);
        var draft = (await store.GetFormTemplateAdministrationAsync(db.TemplateId, draftId, user, Token))!;
        Assert.Equal("Draft", draft.Status); Assert.Equal("Original published form", draft.Name);
        Assert.Single(draft.Sections); // Inactive-only historical sections are copied without becoming empty editor sections.
        Assert.NotEqual(published.Sections[0].Id, draft.Sections[0].Id);
        Assert.NotEqual(oldCore.Id, draft.Sections[0].Fields[0].Id);
        Assert.True(draft.Sections[0].Fields[0].IsProtected);
        var request = WithCustomTypes(draft);
        await store.SaveFormVersionAsync(db.TemplateId, draftId, request, user, Token);
        var saved = (await store.GetFormTemplateAdministrationAsync(db.TemplateId, draftId, user, Token))!;
        Assert.NotEqual(draft.RowVersion, saved.RowVersion);
        Assert.Equal("Revised form", saved.Name); Assert.Equal("Revised description", saved.Description);
        Assert.Equal(10, saved.Sections.SelectMany(section => section.Fields).Count());
        Assert.Equal("Reworded review date", saved.Sections[0].Fields[0].Label);
        foreach (var type in FormAdministrationRules.EditableTypes)
        {
            var field = saved.Sections.SelectMany(section => section.Fields).Single(field => field.FieldKey == $"custom_{type}");
            Assert.Equal(type, field.FieldType); Assert.False(field.IsProtected);
            Assert.Equal(IsChoice(type) ? new[] { "First choice", "Other choice" } : [], field.Options);
        }
        Assert.Equal(1, await db.ScalarAsync<int>($"SELECT COUNT(*) FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id WHERE section.form_template_version_id='{draftId}' AND field.is_active=0 AND field.field_key=N'custom_inactive';"));
        Assert.Equal(1, await db.ScalarAsync<int>($"SELECT COUNT(*) FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id WHERE section.form_template_version_id='{draftId}' AND section.archived_at IS NOT NULL AND field.field_key=N'custom_retired';"));
        Assert.Equal("{\"minimum\":1}", await db.ScalarAsync<string>($"SELECT validation_json FROM forms.form_fields WHERE form_section_id='{saved.Sections[0].Id}' AND field_key=N'review_date';"));
        Assert.Equal(db.LookupId, await db.ScalarAsync<Guid>($"SELECT options_lookup_type_id FROM forms.form_fields WHERE form_section_id='{saved.Sections[0].Id}' AND field_key=N'review_date';"));
        await Assert.ThrowsAsync<DBConcurrencyException>(() => store.SaveFormVersionAsync(db.TemplateId, draftId, request, user, Token));
        await Assert.ThrowsAsync<DBConcurrencyException>(() => store.PublishFormVersionAsync(db.TemplateId, draftId, draft.RowVersion, user, Token));
        Assert.Equal("Draft", (await store.GetFormTemplateAdministrationAsync(db.TemplateId, draftId, user, Token))!.Status);
        await store.PublishFormVersionAsync(db.TemplateId, draftId, saved.RowVersion, user, Token);
        var latest = (await store.GetFormTemplateAdministrationAsync(db.TemplateId, draftId, user, Token))!;
        Assert.Equal("Published", latest.Status);
        Assert.Equal("Superseded", latest.Versions.Single(version => version.Id == published.VersionId).Status);
        await Assert.ThrowsAsync<WorkflowValidationException>(() => store.SaveFormVersionAsync(db.TemplateId, draftId, ToRequest(latest), user, Token));
        await Assert.ThrowsAsync<WorkflowValidationException>(() => store.DiscardFormVersionDraftAsync(db.TemplateId, draftId, latest.RowVersion, user, Token));
        var unchanged = (await store.GetFormTemplateAdministrationAsync(db.TemplateId, published.VersionId, user, Token))!;
        Assert.Equal("Original published form", unchanged.Name);
        Assert.Equal("Original review date", Assert.Single(unchanged.Sections.SelectMany(section => section.Fields)).Label);
        Assert.Equal("Historical saved response", await db.ScalarAsync<string>($"SELECT response_text FROM forms.form_responses WHERE form_field_id='{oldCore.Id}';"));
        Assert.Equal(db.PublishedId, await db.ScalarAsync<Guid>($"SELECT form_template_version_id FROM forms.form_submissions WHERE id='{db.SubmissionId}';"));
        Assert.Equal(draftId, await db.ResolveVersionAsync(null));
        Assert.Equal(db.PublishedId, await db.ResolveVersionAsync(db.PublishedId));
        await Assert.ThrowsAsync<WorkflowValidationException>(() => db.ResolveVersionAsync(Guid.NewGuid()));
        Assert.Equal(3, await db.ScalarAsync<int>("SELECT COUNT(*) FROM ops.audit_logs;"));
        var nextId = await store.CreateFormVersionDraftAsync(db.TemplateId, draftId, user, Token);
        var next = (await store.GetFormTemplateAdministrationAsync(db.TemplateId, nextId, user, Token))!;
        await store.DiscardFormVersionDraftAsync(db.TemplateId, nextId, next.RowVersion, user, Token);
        Assert.Null(await store.GetFormTemplateAdministrationAsync(db.TemplateId, nextId, user, Token));
        Assert.Equal(2, (await store.GetFormTemplateAdministrationAsync(db.TemplateId, null, user, Token))!.Versions.Count);
    }

    [AccountAdministrationDatabaseFact]
    public async Task Permissions_core_rules_and_used_drafts_reject_without_partial_writes()
    {
        await using var db = await FormDatabase.CreateAsync(); var store = db.Store(); var user = db.User();
        var denied = user with { Permissions = new HashSet<string>() };
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => store.GetFormTemplateAdministrationAsync(db.TemplateId, null, denied, Token));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => store.CreateFormVersionDraftAsync(db.TemplateId, db.PublishedId, denied, Token));
        var unknownSource = await Assert.ThrowsAsync<WorkflowValidationException>(() => store.CreateFormVersionDraftAsync(db.TemplateId, Guid.NewGuid(), user, Token));
        Assert.Contains("belong", unknownSource.Message, StringComparison.OrdinalIgnoreCase);
        var id = await store.CreateFormVersionDraftAsync(db.TemplateId, db.PublishedId, user, Token);
        var draft = (await store.GetFormTemplateAdministrationAsync(db.TemplateId, id, user, Token))!;
        var good = ToRequest(draft);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => store.SaveFormVersionAsync(db.TemplateId, id, good, denied, Token));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => store.PublishFormVersionAsync(db.TemplateId, id, draft.RowVersion, denied, Token));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => store.DiscardFormVersionDraftAsync(db.TemplateId, id, draft.RowVersion, denied, Token));
        var field = good.Sections[0].Fields[0];
        foreach (var changed in new[] { field with { FieldType = "number" }, field with { IsRequired = false }, field with { Options = ["A", "B"] } })
        {
            var request = good with { Sections = [good.Sections[0] with { Fields = [changed] }] };
            await Assert.ThrowsAsync<WorkflowValidationException>(() => store.SaveFormVersionAsync(db.TemplateId, id, request, user, Token));
        }
        await Assert.ThrowsAsync<WorkflowValidationException>(() => store.SaveFormVersionAsync(db.TemplateId, id,
            good with { Sections = [good.Sections[0] with { SectionKey = "moved_core" }] }, user, Token));
        var choices = await Assert.ThrowsAsync<WorkflowValidationException>(() => store.SaveFormVersionAsync(db.TemplateId, id,
            good with { Sections = [good.Sections[0] with { Fields = [field, new("custom_choice", "New question", "single_select", false, 20, null, ["Duplicate", "duplicate"])] }] }, user, Token));
        Assert.Contains("distinct choices", choices.Message);
        Assert.Equal(draft.RowVersion, (await store.GetFormTemplateAdministrationAsync(db.TemplateId, id, user, Token))!.RowVersion);
        Assert.Equal(1, await db.ScalarAsync<int>("SELECT COUNT(*) FROM ops.audit_logs;"));
        await db.ExecuteAsync($"INSERT forms.form_submissions(id,form_template_version_id) VALUES(NEWID(),'{id}');");
        await Assert.ThrowsAsync<WorkflowValidationException>(() => store.SaveFormVersionAsync(db.TemplateId, id, good, user, Token));
        await Assert.ThrowsAsync<WorkflowValidationException>(() => store.PublishFormVersionAsync(db.TemplateId, id, draft.RowVersion, user, Token));
        await Assert.ThrowsAsync<WorkflowValidationException>(() => store.DiscardFormVersionDraftAsync(db.TemplateId, id, draft.RowVersion, user, Token));
        await Assert.ThrowsAsync<WorkflowValidationException>(() => store.CreateFormVersionDraftAsync(db.TemplateId, Guid.NewGuid(), user, Token));
        Assert.Equal(1, await db.ScalarAsync<int>("SELECT COUNT(*) FROM ops.audit_logs;"));
    }

    [AccountAdministrationDatabaseFact]
    public async Task Concurrent_copy_and_save_requests_have_one_winner_and_preserve_its_draft()
    {
        await using var db = await FormDatabase.CreateAsync(); var store = db.Store(); var user = db.User();
        var copies = await Task.WhenAll(Enumerable.Range(0, 2).Select(async _ =>
        {
            try { return await store.CreateFormVersionDraftAsync(db.TemplateId, db.PublishedId, user, Token); }
            catch (WorkflowValidationException) { return Guid.Empty; }
        }));
        var draftId = Assert.Single(copies, id => id != Guid.Empty);
        var draft = (await store.GetFormTemplateAdministrationAsync(db.TemplateId, draftId, user, Token))!;
        var saves = await Task.WhenAll(new[] { "First writer", "Second writer" }.Select(async name =>
        {
            try { await store.SaveFormVersionAsync(db.TemplateId, draftId, ToRequest(draft) with { Name = name }, user, Token); return name; }
            catch (DBConcurrencyException) { return null; }
        }));
        var winner = Assert.Single(saves, name => name is not null);
        Assert.Equal(winner, (await store.GetFormTemplateAdministrationAsync(db.TemplateId, draftId, user, Token))!.Name);
        Assert.Equal(2, await db.ScalarAsync<int>("SELECT COUNT(*) FROM ops.audit_logs;"));
        Assert.Equal(2, await db.ScalarAsync<int>("SELECT COUNT(*) FROM forms.form_template_versions;"));
    }

    [AccountAdministrationDatabaseFact]
    public async Task Clearing_a_version_description_stays_cleared_after_reload_publish_and_copy()
    {
        await using var db = await FormDatabase.CreateAsync(); var store = db.Store(); var user = db.User();
        var id = await store.CreateFormVersionDraftAsync(db.TemplateId, db.PublishedId, user, Token);
        var draft = (await store.GetFormTemplateAdministrationAsync(db.TemplateId, id, user, Token))!;
        await store.SaveFormVersionAsync(db.TemplateId, id, ToRequest(draft) with { Description = "" }, user, Token);
        var cleared = (await store.GetFormTemplateAdministrationAsync(db.TemplateId, id, user, Token))!;
        Assert.True(string.IsNullOrEmpty(cleared.Description));
        await store.PublishFormVersionAsync(db.TemplateId, id, cleared.RowVersion, user, Token);
        var copiedId = await store.CreateFormVersionDraftAsync(db.TemplateId, id, user, Token);
        Assert.True(string.IsNullOrEmpty((await store.GetFormTemplateAdministrationAsync(db.TemplateId, copiedId, user, Token))!.Description));
        Assert.Equal("Original description", (await store.GetFormTemplateAdministrationAsync(db.TemplateId, db.PublishedId, user, Token))!.Description);
    }

    [AccountAdministrationDatabaseFact]
    public async Task Legacy_initial_Work_Scrutiny_save_refreshes_metadata_and_invalidates_the_version_editor_token()
    {
        await using var db = await FormDatabase.CreateAsync(); var store = db.Store(); var user = db.User();
        var templateId = Guid.NewGuid(); var versionId = Guid.NewGuid(); var sectionId = Guid.NewGuid();
        await db.ExecuteAsync($"""
            DECLARE @module uniqueidentifier=NEWID();
            INSERT core.modules(id,module_key) VALUES(@module,N'work_scrutiny');
            INSERT forms.form_templates(id,module_id,template_key,name,description) VALUES('{templateId}',@module,N'initial_ws',N'Initial scrutiny',N'Initial guidance');
            INSERT forms.form_template_versions(id,form_template_id,version_label,is_published,display_name,description) VALUES('{versionId}','{templateId}',N'0.1',0,N'Initial scrutiny',N'Initial guidance');
            INSERT forms.form_sections(id,form_template_version_id,section_key,title,display_order) VALUES('{sectionId}','{versionId}',N'criteria',N'Criteria',1);
            INSERT forms.form_fields(form_section_id,field_key,label,field_type) VALUES('{sectionId}',N'custom_reflection',N'Initial question',N'long_text');
            INSERT forms.form_template_org_units(form_template_id,org_unit_id) VALUES('{templateId}','{db.TeamId}');
            """);
        var opened = (await store.GetFormTemplateAdministrationAsync(templateId, versionId, user, Token))!;
        SaveFormVersionRequest modern(FormTemplateAdministration form, string name) => ToRequest(form) with
        { Name = name, Sections = ToRequest(form).Sections.Select(section => section with { Fields = section.Fields.Select(field => field.FieldKey == "custom_reflection" ? field with { Label = $"{name} question" } : field).ToArray() }).ToArray() };
        UpdateFormTemplateStructureRequest legacy(string name, FormTemplateAdministration form) => new(name, "Legacy guidance", db.TeamId, modern(form, name).Sections, form.RowVersion);
        string question(FormTemplateAdministration form) => form.Sections.SelectMany(section => section.Fields).Single(field => field.FieldKey == "custom_reflection").Label;
        await Assert.ThrowsAsync<DBConcurrencyException>(() => store.UpdateFormTemplateStructureAsync(templateId, legacy("Missing token", opened) with { RowVersion = null }, user, Token));
        Assert.Equal(0, await db.ScalarAsync<int>("SELECT COUNT(*) FROM ops.audit_logs;"));
        Assert.Equal(FormSubmissionUpdateResult.Saved, await store.UpdateFormTemplateStructureAsync(templateId, legacy("Legacy saved", opened), user, Token));
        var refreshed = (await store.GetFormTemplateAdministrationAsync(templateId, versionId, user, Token))!;
        Assert.NotEqual(opened.RowVersion, refreshed.RowVersion);
        Assert.Equal("Legacy saved", refreshed.Name); Assert.Equal("Legacy guidance", refreshed.Description);
        await Assert.ThrowsAsync<DBConcurrencyException>(() => store.SaveFormVersionAsync(templateId, versionId, ToRequest(opened), user, Token));
        Assert.Equal("Legacy saved question", question((await store.GetFormTemplateAdministrationAsync(templateId, versionId, user, Token))!));
        Assert.Equal(1, await db.ScalarAsync<int>("SELECT COUNT(*) FROM ops.audit_logs;"));

        await store.SaveFormVersionAsync(templateId, versionId, modern(refreshed, "Modern saved"), user, Token);
        await Assert.ThrowsAsync<DBConcurrencyException>(() => store.UpdateFormTemplateStructureAsync(templateId, legacy("Stale legacy", refreshed), user, Token));
        var current = (await store.GetFormTemplateAdministrationAsync(templateId, versionId, user, Token))!;
        Assert.Equal("Modern saved", current.Name); Assert.Equal("Modern saved question", question(current));

        // Both editors load the same token. The shared parent lock and version check permit exactly one write.
        var modernSave = Task.Run(async () =>
        {
            try { await store.SaveFormVersionAsync(templateId, versionId, modern(current, "Concurrent modern"), user, Token); return true; }
            catch (DBConcurrencyException) { return false; }
        });
        var legacySave = Task.Run(async () =>
        {
            try { Assert.Equal(FormSubmissionUpdateResult.Saved, await store.UpdateFormTemplateStructureAsync(templateId, legacy("Concurrent legacy", current), user, Token)); return true; }
            catch (DBConcurrencyException) { return false; }
        });
        await Task.WhenAll(modernSave, legacySave);
        Assert.NotEqual(await modernSave, await legacySave);
        var final = (await store.GetFormTemplateAdministrationAsync(templateId, versionId, user, Token))!;
        var winner = await modernSave ? "Concurrent modern" : "Concurrent legacy";
        Assert.Equal(winner, final.Name); Assert.Equal($"{winner} question", question(final));
        Assert.Equal(3, await db.ScalarAsync<int>("SELECT COUNT(*) FROM ops.audit_logs;"));
    }

    [AccountAdministrationDatabaseFact]
    public async Task Workflow_wording_defaults_saved_prompts_permissions_and_stale_writes_remain_consistent()
    {
        await using var db = await FormDatabase.CreateAsync(); var store = db.Store(); var user = db.User();
        var denied = user with { Permissions = new HashSet<string>() };
        var defaults = await store.GetWorkflowFormContentAdministrationAsync(user, Token);
        Assert.Equal(47, defaults.Sum(form => form.Fields.Count));
        Assert.All(defaults, form => Assert.Null(form.RowVersion));
        Assert.Null(await store.GetWorkflowFormContentAsync("unknown_form", Token));
        var original = defaults.First();
        var edited = original.Fields.Select((field, index) => index == 0 ? field with { Label = " Updated prompt ", HelpText = "Updated guidance" } : field).ToArray();
        var request = new SaveWorkflowFormContentRequest(edited, null);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => store.GetWorkflowFormContentAdministrationAsync(denied, Token));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => store.SaveWorkflowFormContentAsync(original.FormKey, request, denied, Token));
        await store.SaveWorkflowFormContentAsync(original.FormKey, request, user, Token);
        var saved = (await store.GetWorkflowFormContentAsync(original.FormKey, Token))!;
        Assert.NotNull(saved.RowVersion);
        Assert.Equal("Updated prompt", saved.Fields[0].Label); Assert.Equal("Updated guidance", saved.Fields[0].HelpText);
        Assert.Equal(original.Fields.Select(field => field.Key), saved.Fields.Select(field => field.Key));
        Assert.Equal(original.Fields.Skip(1), saved.Fields.Skip(1));
        await Assert.ThrowsAsync<DBConcurrencyException>(() => store.SaveWorkflowFormContentAsync(original.FormKey, request, user, Token));
        await Assert.ThrowsAsync<WorkflowValidationException>(() => store.SaveWorkflowFormContentAsync(original.FormKey,
            new(saved.Fields.Skip(1).ToArray(), saved.RowVersion), user, Token));
        Assert.Equal(saved.RowVersion, (await store.GetWorkflowFormContentAsync(original.FormKey, Token))!.RowVersion);
        Assert.Equal(1, await db.ScalarAsync<int>("SELECT COUNT(*) FROM ops.audit_logs;"));

        // Saved JSON from an earlier release can omit new prompts; each missing key receives its current default.
        await db.ExecuteAsync($"UPDATE forms.workflow_content SET content_json=N'[]' WHERE form_key=N'{original.FormKey}';");
        var fallback = (await store.GetWorkflowFormContentAsync(original.FormKey, Token))!;
        Assert.Equal(original.Fields, fallback.Fields);
        Assert.NotEqual(saved.RowVersion, fallback.RowVersion);
        await store.SaveWorkflowFormContentAsync(original.FormKey, new(original.Fields, fallback.RowVersion), user, Token);
        Assert.Equal(2, await db.ScalarAsync<int>("SELECT COUNT(*) FROM ops.audit_logs;"));
        var reloaded = await store.GetWorkflowFormContentAdministrationAsync(user, Token);
        Assert.Equal(47, reloaded.Sum(form => form.Fields.Count));
        Assert.All(reloaded.Where(form => form.FormKey != original.FormKey), form => Assert.Null(form.RowVersion));
    }

    [AccountAdministrationDatabaseFact]
    public async Task New_blank_and_copied_Work_Scrutiny_drafts_receive_protected_core_questions_without_changing_published_history()
    {
        await using var db = await FormDatabase.CreateAsync(); var store = db.Store(); var user = db.User();
        var blank = await db.NewWorkScrutinyAsync();
        AssertWorkScrutinyCore(blank);
        await store.PublishFormVersionAsync(blank.TemplateId, blank.VersionId, blank.RowVersion, user, Token);
        var published = (await store.GetFormTemplateAdministrationAsync(blank.TemplateId, blank.VersionId, user, Token))!;
        var snapshot = System.Text.Json.JsonSerializer.Serialize(published.Sections);
        var draftId = await store.CreateFormVersionDraftAsync(blank.TemplateId, blank.VersionId, user, Token);
        var copy = (await store.GetFormTemplateAdministrationAsync(blank.TemplateId, draftId, user, Token))!;
        AssertWorkScrutinyCore(copy);
        Assert.DoesNotContain(copy.Sections.SelectMany(section => section.Fields), field => published.Sections.SelectMany(section => section.Fields).Any(old => old.Id == field.Id));
        await store.SaveFormVersionAsync(blank.TemplateId, draftId, ToRequest(copy), user, Token);
        AssertWorkScrutinyCore((await store.GetFormTemplateAdministrationAsync(blank.TemplateId, draftId, user, Token))!);
        Assert.Equal(snapshot, System.Text.Json.JsonSerializer.Serialize((await store.GetFormTemplateAdministrationAsync(blank.TemplateId, blank.VersionId, user, Token))!.Sections));
    }

    [AccountAdministrationDatabaseFact]
    public async Task Older_empty_Work_Scrutiny_draft_must_be_prepared_before_publishing()
    {
        await using var db = await FormDatabase.CreateAsync(); var store = db.Store(); var user = db.User();
        var form = await db.NewWorkScrutinyAsync();
        await db.ExecuteAsync($"DELETE field FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id WHERE section.form_template_version_id='{form.VersionId}'; DELETE forms.form_sections WHERE form_template_version_id='{form.VersionId}';");
        var empty = (await store.GetFormTemplateAdministrationAsync(form.TemplateId, form.VersionId, user, Token))!;
        Assert.Empty(empty.Sections);
        var failure = await Assert.ThrowsAsync<WorkflowValidationException>(() => store.PublishFormVersionAsync(form.TemplateId, form.VersionId, empty.RowVersion, user, Token));
        Assert.Contains("Save this older draft", failure.Message);
        var legacyFailure = await Assert.ThrowsAsync<WorkflowValidationException>(() => store.PublishFormTemplateAsync(form.TemplateId, user, Token, empty.RowVersion));
        Assert.Contains("Save this older draft", legacyFailure.Message);
        await store.SaveFormVersionAsync(form.TemplateId, form.VersionId, ToRequest(empty), user, Token);
        var ready = (await store.GetFormTemplateAdministrationAsync(form.TemplateId, form.VersionId, user, Token))!;
        AssertWorkScrutinyCore(ready);
        Assert.Equal(FormSubmissionUpdateResult.Saved, await store.PublishFormTemplateAsync(form.TemplateId, user, Token, ready.RowVersion));
        Assert.Equal("Published", (await store.GetFormTemplateAdministrationAsync(form.TemplateId, form.VersionId, user, Token))!.Status);
    }

    [FormAdministrationDatabaseTheory]
    [InlineData(false, "qualification_level", "inactive")]
    [InlineData(false, "course_level", "archived_fields")]
    [InlineData(false, "course_or_unit", "archived_section")]
    [InlineData(true, "qualification_level", "inactive")]
    [InlineData(true, "course_level", "archived_fields")]
    [InlineData(true, "course_or_unit", "archived_section")]
    public async Task Retired_Work_Scrutiny_core_fields_are_revived_once_with_their_saved_ids_and_configuration(bool legacy, string levelKey, string retirement)
    {
        await using var db = await FormDatabase.CreateAsync(); var store = db.Store(); var user = db.User();
        var form = await db.NewWorkScrutinyAsync();
        var level = form.Sections.SelectMany(section => section.Fields).Single(field => field.FieldKey == "qualification_level");
        var delivery = form.Sections.SelectMany(section => section.Fields).Single(field => field.FieldKey == "learning_walk_delivery_area");
        const string configuration = """{"options":["Special level","Other level"],"preserved":"core metadata"}""";
        await db.ExecuteAsync($"UPDATE forms.form_fields SET field_key=N'{levelKey}',label=N'Retained level wording',is_required=0,configuration_json=N'{configuration}',validation_json=N'{{\"retained\":true}}',options_lookup_type_id='{db.LookupId}' WHERE id='{level.Id}';");
        await db.ExecuteAsync(retirement switch
        {
            "inactive" => $"UPDATE forms.form_fields SET is_active=0 WHERE id IN('{level.Id}','{delivery.Id}');",
            "archived_fields" => $"UPDATE forms.form_fields SET archived_at=sysutcdatetime() WHERE id IN('{level.Id}','{delivery.Id}');",
            _ => $"UPDATE forms.form_sections SET archived_at=sysutcdatetime() WHERE form_template_version_id='{form.VersionId}';"
        });
        var retired = (await store.GetFormTemplateAdministrationAsync(form.TemplateId, form.VersionId, user, Token))!;
        Assert.Empty(retired.Sections);
        if (legacy) Assert.Equal(FormSubmissionUpdateResult.Saved, await store.UpdateFormTemplateStructureAsync(form.TemplateId, new(retired.Name, retired.Description, db.TeamId, [], retired.RowVersion), user, Token));
        else await store.SaveFormVersionAsync(form.TemplateId, form.VersionId, ToRequest(retired), user, Token);
        var revived = (await store.GetFormTemplateAdministrationAsync(form.TemplateId, form.VersionId, user, Token))!;
        var revivedLevel = revived.Sections.SelectMany(section => section.Fields).Single(field => field.FieldKey == levelKey);
        Assert.Equal(level.Id, revivedLevel.Id); Assert.False(revivedLevel.IsRequired); Assert.True(revivedLevel.IsProtected);
        Assert.Equal(new[] { "Special level", "Other level" }, revivedLevel.Options);
        Assert.Equal(delivery.Id, revived.Sections.SelectMany(section => section.Fields).Single(field => field.FieldKey == "learning_walk_delivery_area").Id);
        Assert.Equal(configuration, await db.ScalarAsync<string>($"SELECT configuration_json FROM forms.form_fields WHERE id='{level.Id}';"));
        Assert.Equal(2, await db.ScalarAsync<int>($"SELECT COUNT(*) FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id WHERE section.form_template_version_id='{form.VersionId}';"));

        var request = ToRequest(revived);
        var changed = request with { Sections = request.Sections.Select(section => section with { Fields = section.Fields.Select(field => field.FieldKey == levelKey ? field with { FieldType = "long_text", Options = [] } : field).ToArray() }).ToArray() };
        await Assert.ThrowsAsync<WorkflowValidationException>(() => store.UpdateFormTemplateStructureAsync(form.TemplateId, new(revived.Name, revived.Description, db.TeamId, changed.Sections, revived.RowVersion), user, Token));
        if (legacy) await store.UpdateFormTemplateStructureAsync(form.TemplateId, new(revived.Name, revived.Description, db.TeamId, request.Sections, revived.RowVersion), user, Token);
        else await store.SaveFormVersionAsync(form.TemplateId, form.VersionId, request, user, Token);
        Assert.Equal(configuration, await db.ScalarAsync<string>($"SELECT field.configuration_json FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id WHERE section.form_template_version_id='{form.VersionId}' AND field.field_key=N'{levelKey}';"));
        Assert.Equal(db.LookupId, await db.ScalarAsync<Guid>($"SELECT field.options_lookup_type_id FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id WHERE section.form_template_version_id='{form.VersionId}' AND field.field_key=N'{levelKey}';"));
        Assert.Equal("{\"retained\":true}", await db.ScalarAsync<string>($"SELECT field.validation_json FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id WHERE section.form_template_version_id='{form.VersionId}' AND field.field_key=N'{levelKey}';"));
    }

    private static void AssertWorkScrutinyCore(FormTemplateAdministration form)
    {
        var fields = form.Sections.SelectMany(section => section.Fields).ToArray(); Assert.Equal(2, fields.Length);
        var level = Assert.Single(fields, field => WorkScrutinyResponseRules.CourseLevelKeys.Contains(field.FieldKey));
        Assert.True(level.IsRequired); Assert.True(level.IsProtected); Assert.Equal("single_select", level.FieldType);
        Assert.Equal(WorkScrutinyResponseRules.CourseLevels, level.Options);
        var delivery = Assert.Single(fields, field => field.FieldKey == "learning_walk_delivery_area");
        Assert.True(delivery.IsRequired); Assert.True(delivery.IsProtected); Assert.Equal("learning_walk_delivery_area", delivery.FieldType);
    }

    private static bool IsChoice(string type) => type is "single_select" or "multi_select" or "checkbox_group" or "rubric_scale";
    private static SaveFormVersionRequest ToRequest(FormTemplateAdministration form) => new(form.Name, form.Description, form.RowVersion,
        form.Sections.Select(section => new FormStructureSectionRequest(section.SectionKey, section.Title, section.DisplayOrder,
            section.Fields.Select(field => new FormStructureFieldRequest(field.FieldKey, field.Label, field.FieldType, field.IsRequired, field.DisplayOrder, field.HelpText, field.Options)).ToArray())).ToArray());
    private static SaveFormVersionRequest WithCustomTypes(FormTemplateAdministration form)
    {
        var core = ToRequest(form).Sections[0];
        var fields = FormAdministrationRules.EditableTypes.Order().Select((type, index) => new FormStructureFieldRequest($"custom_{type}", $"Additional {type}", type, false, index + 1, "New guidance", IsChoice(type) ? ["First choice", "Other choice"] : [])).ToArray();
        return new("Revised form", "Revised description", form.RowVersion,
            [core with { Fields = [core.Fields[0] with { Label = "Reworded review date", HelpText = "Edited guidance" }] }, new("additional", "Additional questions", 2, fields)]);
    }

    private sealed class FormDatabase : IAsyncDisposable
    {
        private readonly string master;
        private readonly string name = "TLQS_FormAdminTest_" + Guid.NewGuid().ToString("N");
        private bool created;
        public string ConnectionString { get; private set; } = "";
        public Guid TemplateId { get; } = Guid.NewGuid();
        public Guid PublishedId { get; } = Guid.NewGuid();
        public Guid SubmissionId { get; } = Guid.NewGuid();
        public Guid LookupId { get; } = Guid.NewGuid();
        public Guid TeamId { get; } = Guid.NewGuid();
        private Guid ActorId { get; } = Guid.NewGuid();
        private FormDatabase(string master) => this.master = master;
        public CurrentUser User() => new(ActorId, null, "Form test administrator", "forms@example.invalid", new HashSet<string> { PermissionKeys.FormsManage }, []);
        public SqlFoundationDataStore Store() => new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:TlqsDatabase"] = ConnectionString }).Build(), NullLogger<SqlFoundationDataStore>.Instance);
        public static async Task<FormDatabase> CreateAsync()
        {
            var builder = new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TLQS_TEST_SQL_MASTER"));
            if (!builder.InitialCatalog.Equals("master", StringComparison.OrdinalIgnoreCase) || !string.IsNullOrEmpty(builder.AttachDBFilename)
                || !(builder.DataSource.StartsWith("(localdb)", StringComparison.OrdinalIgnoreCase) || builder.DataSource is "." or "localhost"))
                throw new InvalidOperationException("Form administration tests require an explicit, unattached local Database=master connection.");
            var result = new FormDatabase(builder.ConnectionString);
            await using (var master = new SqlConnection(result.master))
            {
                await master.OpenAsync(); await using var command = new SqlCommand($"CREATE DATABASE [{result.name}];", master) { CommandTimeout = 120 };
                await command.ExecuteNonQueryAsync(); result.created = true;
            }
            builder.InitialCatalog = result.name; result.ConnectionString = builder.ConnectionString;
            try
            {
                foreach (var schema in new[] { "core", "forms", "ops", "org" }) await result.ExecuteAsync($"CREATE SCHEMA {schema};");
                await result.ExecuteAsync("""
                    CREATE TABLE core.modules(id uniqueidentifier PRIMARY KEY,module_key nvarchar(100),archived_at datetimeoffset NULL);
                    CREATE TABLE forms.form_templates(id uniqueidentifier PRIMARY KEY,module_id uniqueidentifier REFERENCES core.modules(id),template_key nvarchar(100),name nvarchar(250),description nvarchar(1000),is_active bit DEFAULT 1,updated_at datetimeoffset DEFAULT sysutcdatetime(),archived_at datetimeoffset NULL);
                    CREATE TABLE forms.form_template_versions(id uniqueidentifier PRIMARY KEY DEFAULT NEWID(),form_template_id uniqueidentifier REFERENCES forms.form_templates(id),version_label nvarchar(100),is_published bit,display_name nvarchar(250),description nvarchar(1000),active_from datetimeoffset DEFAULT sysutcdatetime(),active_to datetimeoffset NULL,created_at datetimeoffset DEFAULT sysutcdatetime(),updated_at datetimeoffset DEFAULT sysutcdatetime(),created_by_user_account_id uniqueidentifier NULL,archived_at datetimeoffset NULL,row_version rowversion);
                    CREATE TABLE forms.form_sections(id uniqueidentifier PRIMARY KEY DEFAULT NEWID(),form_template_version_id uniqueidentifier REFERENCES forms.form_template_versions(id),section_key nvarchar(100),title nvarchar(250),description nvarchar(1000),display_order int,archived_at datetimeoffset NULL,updated_at datetimeoffset DEFAULT sysutcdatetime(),UNIQUE(form_template_version_id,section_key));
                    CREATE TABLE forms.form_fields(id uniqueidentifier PRIMARY KEY DEFAULT NEWID(),form_section_id uniqueidentifier REFERENCES forms.form_sections(id),field_key nvarchar(100),label nvarchar(300),field_type nvarchar(100),options_lookup_type_id uniqueidentifier NULL,is_required bit DEFAULT 0,display_order int DEFAULT 0,help_text nvarchar(1000),validation_json nvarchar(max),configuration_json nvarchar(max),is_active bit DEFAULT 1,archived_at datetimeoffset NULL,UNIQUE(form_section_id,field_key));
                    CREATE TABLE forms.form_submissions(id uniqueidentifier PRIMARY KEY DEFAULT NEWID(),form_template_version_id uniqueidentifier REFERENCES forms.form_template_versions(id),archived_at datetimeoffset NULL);
                    CREATE TABLE forms.form_responses(form_submission_id uniqueidentifier REFERENCES forms.form_submissions(id),form_field_id uniqueidentifier REFERENCES forms.form_fields(id),response_text nvarchar(max));
                    CREATE TABLE forms.workflow_content(form_key nvarchar(100) PRIMARY KEY,content_json nvarchar(max) NOT NULL,updated_at datetimeoffset DEFAULT sysutcdatetime(),row_version rowversion);
                    CREATE TABLE org.org_units(id uniqueidentifier PRIMARY KEY,parent_org_unit_id uniqueidentifier NULL,org_unit_type nvarchar(50),is_active bit DEFAULT 1,archived_at datetimeoffset NULL);
                    CREATE TABLE forms.form_template_org_units(form_template_id uniqueidentifier REFERENCES forms.form_templates(id),org_unit_id uniqueidentifier REFERENCES org.org_units(id),archived_at datetimeoffset NULL);
                    CREATE TABLE ops.audit_logs(user_account_id uniqueidentifier NULL,record_id uniqueidentifier NULL,entity_name nvarchar(100),entity_id uniqueidentifier,action nvarchar(100),summary nvarchar(max),before_json nvarchar(max),after_json nvarchar(max));
                    """);
                const string coreValidation = """{"minimum":1}""";
                const string coreConfiguration = """{"placeholder":"Preserve core configuration"}""";
                await result.ExecuteAsync($"""
                    DECLARE @module uniqueidentifier=NEWID(),@section uniqueidentifier=NEWID(),@field uniqueidentifier=NEWID(),@retiredSection uniqueidentifier=NEWID(),@faculty uniqueidentifier=NEWID();
                    INSERT org.org_units(id,org_unit_type) VALUES(@faculty,N'faculty');
                    INSERT org.org_units(id,parent_org_unit_id,org_unit_type) VALUES('{result.TeamId}',@faculty,N'team');
                    INSERT core.modules(id,module_key) VALUES(@module,N'learning_walks');
                    INSERT forms.form_templates(id,module_id,template_key,name,description) VALUES('{result.TemplateId}',@module,N'form_admin_test',N'Stable template',N'Stable description');
                    INSERT forms.form_template_versions(id,form_template_id,version_label,is_published,display_name,description,active_from) VALUES('{result.PublishedId}','{result.TemplateId}',N'1.0',1,N'Original published form',N'Original description',DATEADD(day,-10,sysutcdatetime()));
                    INSERT forms.form_sections(id,form_template_version_id,section_key,title,description,display_order) VALUES(@section,'{result.PublishedId}',N'context',N'Context',N'Section guidance',1);
                    INSERT forms.form_fields(id,form_section_id,field_key,label,field_type,options_lookup_type_id,is_required,display_order,help_text,validation_json,configuration_json) VALUES(@field,@section,N'review_date',N'Original review date',N'date','{result.LookupId}',1,10,N'Original guidance',N'{coreValidation}',N'{coreConfiguration}');
                    INSERT forms.form_fields(form_section_id,field_key,label,field_type,is_active) VALUES(@section,N'custom_inactive',N'Inactive historical question',N'short_text',0);
                    INSERT forms.form_sections(id,form_template_version_id,section_key,title,display_order) VALUES(@retiredSection,'{result.PublishedId}',N'retired',N'Retired questions',2);
                    INSERT forms.form_fields(form_section_id,field_key,label,field_type,is_active) VALUES(@retiredSection,N'custom_retired',N'Retired historical question',N'short_text',0);
                    INSERT forms.form_submissions(id,form_template_version_id) VALUES('{result.SubmissionId}','{result.PublishedId}');
                    INSERT forms.form_responses(form_submission_id,form_field_id,response_text) VALUES('{result.SubmissionId}',@field,N'Historical saved response');
                    """);
                return result;
            }
            catch { await result.DisposeAsync(); throw; }
        }
        public async Task ExecuteAsync(string sql)
        {
            await using var connection = new SqlConnection(ConnectionString); await connection.OpenAsync();
            await using var command = new SqlCommand(sql, connection); await command.ExecuteNonQueryAsync();
        }
        public async Task<FormTemplateAdministration> NewWorkScrutinyAsync()
        {
            await ExecuteAsync("IF NOT EXISTS(SELECT 1 FROM core.modules WHERE module_key=N'work_scrutiny') INSERT core.modules(id,module_key) VALUES(NEWID(),N'work_scrutiny');");
            var store = Store(); var user = User();
            var id = await store.CreateFormTemplateAsync(new("work_scrutiny", $"Isolated scrutiny {Guid.NewGuid():N}", "Draft guidance", TeamId), user, Token);
            return (await store.GetFormTemplateAdministrationAsync(id, null, user, Token))!;
        }
        public async Task<T> ScalarAsync<T>(string sql)
        {
            await using var connection = new SqlConnection(ConnectionString); await connection.OpenAsync();
            await using var command = new SqlCommand(sql, connection); return (T)(await command.ExecuteScalarAsync())!;
        }
        public async Task<Guid> ResolveVersionAsync(Guid? requested)
        {
            await using var connection = new SqlConnection(ConnectionString); await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            var method = typeof(SqlFoundationDataStore).GetMethod("GetLatestTemplateVersionAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
            var task = (Task)method.Invoke(null, [connection, transaction, "form_admin_test", Token, requested])!;
            await task;
            var value = task.GetType().GetProperty("Result")!.GetValue(task)!;
            return (Guid)value.GetType().GetProperty("VersionId")!.GetValue(value)!;
        }
        public async ValueTask DisposeAsync()
        {
            if (!created) return;
            SqlConnection.ClearAllPools();
            await using var connection = new SqlConnection(master); await connection.OpenAsync();
            await using var drop = new SqlCommand($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}];", connection) { CommandTimeout = 120 };
            await drop.ExecuteNonQueryAsync(); created = false;
        }
    }
}
