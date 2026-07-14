using System.Security.Claims;
using TLQS.Api.Data;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.V1;

public static class FoundationEndpoints
{
    public static IEndpointRouteBuilder MapFoundationEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/v1").RequireAuthorization();

        api.MapGet("/me", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            return Results.Ok(await GetCurrentUserAsync(principal, store, cancellationToken));
        });

        api.MapGet("/modules", async (SqlFoundationDataStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetModulesAsync(cancellationToken)));

        api.MapGet("/lookups", async (SqlFoundationDataStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetLookupsAsync(cancellationToken)));

        api.MapGet("/admin/lookups/{lookupKey}/values", async (string lookupKey, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.PermissionsManage)
                ? Results.Ok(await store.GetLookupValuesAsync(lookupKey, cancellationToken))
                : Results.Forbid();
        });

        api.MapPost("/admin/lookups/{lookupKey}/values", async (string lookupKey, CreateLookupValueRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.PermissionsManage)
                ? Results.Ok(await store.SaveLookupValueAsync(lookupKey, request.DisplayName, currentUser, cancellationToken))
                : Results.Forbid();
        });

        api.MapPost("/admin/lookups/{lookupKey}/values/{id:guid}/archive", async (string lookupKey, Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.PermissionsManage))
            {
                return Results.Forbid();
            }

            return await store.ArchiveLookupValueAsync(lookupKey, id, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapGet("/org-units", async (SqlFoundationDataStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetOrgUnitsAsync(cancellationToken)));

        api.MapGet("/rooms", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return CanUseElevate(currentUser)
                ? Results.Ok(await store.GetRoomsAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/work-scrutiny/template/{orgUnitId:guid}", async (Guid orgUnitId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.WorkScrutinySubmit)
                && !currentUser.HasPermission(PermissionKeys.FormsManage))
            {
                return Results.Forbid();
            }

            var definition = await store.GetWorkScrutinyTemplateAsync(orgUnitId, currentUser, cancellationToken);
            return definition is null ? Results.NotFound() : Results.Ok(definition);
        });

        api.MapGet("/courses", async (Guid orgUnitId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.WorkScrutinySubmit)
                && !currentUser.HasPermission(PermissionKeys.FormsManage))
            {
                return Results.Forbid();
            }

            return Results.Ok(await store.GetCoursesAsync(orgUnitId, currentUser, cancellationToken));
        });

        api.MapGet("/staff", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.StaffRead)
                ? Results.Ok(await store.GetStaffAsync(currentUser, cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/roles", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.PermissionsManage)
                ? Results.Ok(await store.GetRolesAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/permissions", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.PermissionsManage)
                ? Results.Ok(await store.GetPermissionsAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/form-templates", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.FormsManage)
                ? Results.Ok(await store.GetFormTemplatesAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapPost("/form-templates", async (CreateFormTemplateRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.FormsManage))
            {
                return Results.Forbid();
            }

            if (!string.Equals(request.ModuleKey, "work_scrutiny", StringComparison.OrdinalIgnoreCase))
            {
                return Results.BadRequest(new { Message = "Only Work Scrutiny templates can be created from template admin." });
            }

            if (!request.OrgUnitId.HasValue)
            {
                return Results.BadRequest(new { Message = "Work Scrutiny templates must be allocated to a sub-team." });
            }

            var id = await store.CreateFormTemplateAsync(request, currentUser, cancellationToken);
            return Results.Created($"/api/v1/form-templates/{id}", new { Id = id });
        });

        api.MapPost("/form-templates/{id:guid}/archive", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.FormsManage))
            {
                return Results.Forbid();
            }

            return await store.ArchiveFormTemplateAsync(id, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapGet("/form-templates/{templateKey}/definition", async (string templateKey, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanUseForms(currentUser))
            {
                return Results.Forbid();
            }

            var definition = await store.GetFormDefinitionAsync(templateKey, cancellationToken);
            return definition is null ? Results.NotFound() : Results.Ok(definition);
        });

        api.MapGet("/learning-walk/theme-mappings", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanUseForms(currentUser))
            {
                return Results.Forbid();
            }

            return Results.Ok(await store.GetLearningWalkThemeMappingsAsync(cancellationToken));
        });

        api.MapPut("/learning-walk/theme-mappings", async (UpdateLearningWalkThemeMappingRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.FormsManage))
            {
                return Results.Forbid();
            }

            if (string.IsNullOrWhiteSpace(request.AgreedTheme))
            {
                return Results.BadRequest(new { Message = "Agreed theme is required." });
            }

            var id = await store.UpsertLearningWalkThemeMappingAsync(request, cancellationToken);
            return Results.Ok(new { Id = id });
        });

        api.MapGet("/learning-walk/themes", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanUseForms(currentUser))
            {
                return Results.Forbid();
            }

            // Inactive themes are returned so historical drafts can still render their selections.
            // The form UI only offers active themes for new choices.
            return Results.Ok(await store.GetLearningWalkThemeGroupsAsync(includeInactive: true, cancellationToken));
        });

        api.MapGet("/admin/learning-walk/themes", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.FormsManage))
            {
                return Results.Forbid();
            }

            return Results.Ok(await store.GetLearningWalkThemeGroupsAsync(includeInactive: true, cancellationToken));
        });

        api.MapPost("/admin/learning-walk/themes", async (SaveLearningWalkThemeRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.FormsManage))
            {
                return Results.Forbid();
            }

            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return Results.BadRequest(new { Message = "A theme name is required." });
            }

            var id = await store.CreateLearningWalkThemeAsync(request, currentUser, cancellationToken);
            return Results.Created($"/api/v1/admin/learning-walk/themes/{id}", new { Id = id });
        });

        api.MapPut("/admin/learning-walk/themes/{id:guid}", async (Guid id, SaveLearningWalkThemeRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.FormsManage))
            {
                return Results.Forbid();
            }

            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return Results.BadRequest(new { Message = "A theme name is required." });
            }

            return await store.UpdateLearningWalkThemeAsync(id, request, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapPost("/admin/learning-walk/themes/{id:guid}/status", async (Guid id, SetLearningWalkThemeStatusRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.FormsManage))
            {
                return Results.Forbid();
            }

            return await store.SetLearningWalkThemeStatusAsync(id, request.IsActive, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapPut("/admin/learning-walk/themes/reorder", async (ReorderLearningWalkThemesRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.FormsManage))
            {
                return Results.Forbid();
            }

            await store.ReorderLearningWalkThemesAsync(request, currentUser, cancellationToken);
            return Results.NoContent();
        });

        api.MapPost("/form-submissions", async (SubmitFormRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanCreateRecord(currentUser, request.RecordType))
            {
                return Results.Forbid();
            }

            if (string.Equals(request.RecordType, "learning_walk", StringComparison.OrdinalIgnoreCase)
                && (!request.OrgUnitId.HasValue || !request.RecordDate.HasValue))
            {
                return Results.BadRequest(new { Message = "Learning Walk submissions require a team and visit date." });
            }

            if (string.Equals(request.RecordType, "work_scrutiny", StringComparison.OrdinalIgnoreCase)
                && (!request.OrgUnitId.HasValue
                    || !request.RecordDate.HasValue
                    || request.CourseIds is null
                    || request.CourseIds.Count == 0))
            {
                return Results.BadRequest(new { Message = "Work Scrutiny submissions require one sub-team, a date and at least one sampled course." });
            }

            var result = await store.SubmitFormAsync(request, currentUser, cancellationToken);
            return Results.Created(
                $"/api/v1/form-submissions/{result.SubmissionId}",
                new { Id = result.SubmissionId, result.RecordId });
        });

        api.MapGet("/records", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetRecordsAsync(currentUser, cancellationToken));
        });

        api.MapGet("/records/{id:guid}", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var detail = await store.GetRecordDetailAsync(id, currentUser, cancellationToken);
            return detail is null ? Results.NotFound() : Results.Ok(detail);
        });

        api.MapGet("/admin/work-scrutiny/records", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.UsersManage)
                ? Results.Ok(await store.GetAdminWorkScrutinyRecordsAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/admin/work-scrutiny/records/{id:guid}", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.UsersManage))
            {
                return Results.Forbid();
            }

            var detail = await store.GetRecordDetailAsync(id, currentUser, cancellationToken, includeArchived: true);
            return detail is null || !string.Equals(detail.RecordType, "work_scrutiny", StringComparison.OrdinalIgnoreCase)
                ? Results.NotFound()
                : Results.Ok(detail);
        });

        api.MapGet("/admin/work-scrutiny/records/{id:guid}/audit", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.UsersManage)
                ? Results.Ok(await store.GetRecordAuditHistoryAsync(id, cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/admin/work-scrutiny/records/{id:guid}/actions", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.UsersManage)
                ? Results.Ok(await store.GetAdminWorkScrutinyActionsAsync(id, cancellationToken))
                : Results.Forbid();
        });

        api.MapDelete("/admin/work-scrutiny/records/{id:guid}", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.UsersManage))
            {
                return Results.Forbid();
            }

            return await store.SetWorkScrutinyArchivedStateAsync(id, true, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapPost("/admin/work-scrutiny/records/{id:guid}/restore", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.UsersManage))
            {
                return Results.Forbid();
            }

            return await store.SetWorkScrutinyArchivedStateAsync(id, false, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapPost("/records", async (CreateRecordRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanCreateRecord(currentUser, request.RecordType))
            {
                return Results.Forbid();
            }

            var id = await store.CreateRecordAsync(request, currentUser, cancellationToken);
            return Results.Created($"/api/v1/records/{id}", new { Id = id });
        });

        api.MapPut("/form-submissions/{id:guid}", async (Guid id, UpdateFormSubmissionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.UpdateFormSubmissionAsync(id, request, currentUser, cancellationToken);

            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapPost("/form-submissions/{id:guid}/status", async (Guid id, ChangeSubmissionStatusRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.ChangeFormSubmissionStatusAsync(id, request.Action, currentUser, cancellationToken);

            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapGet("/actions", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetActionsAsync(currentUser, cancellationToken));
        });

        api.MapPost("/actions", async (CreateActionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.ActionsManage))
            {
                return Results.Forbid();
            }

            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return Results.BadRequest(new { Message = "An action title is required." });
            }

            var id = await store.CreateActionAsync(request, currentUser, cancellationToken);
            return Results.Created($"/api/v1/actions/{id}", new { Id = id });
        });

        api.MapPut("/actions/{id:guid}", async (Guid id, UpdateActionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.UpdateActionAsync(id, request, currentUser, cancellationToken);

            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapGet("/liv-records", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetLivRecordsAsync(currentUser, cancellationToken));
        });

        api.MapPost("/liv-records", async (SaveLivRecordRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanSubmitLiv(currentUser))
            {
                return Results.Forbid();
            }

            if (request.SubjectStaffId == Guid.Empty)
            {
                return Results.BadRequest(new { Message = "A staff member is required for a LIV record." });
            }

            var id = await store.CreateLivRecordAsync(request, currentUser, cancellationToken);
            return Results.Created($"/api/v1/liv-records/{id}", new { Id = id });
        });

        api.MapPut("/liv-records/{id:guid}", async (Guid id, SaveLivRecordRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanSubmitLiv(currentUser))
            {
                return Results.Forbid();
            }

            var result = await store.UpdateLivRecordAsync(id, request, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapPost("/liv-records/{id:guid}/status", async (Guid id, ChangeSubmissionStatusRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.ChangeLivStatusAsync(id, request.Action, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapGet("/reports/dashboards", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetDashboardsAsync(currentUser, cancellationToken));
        });

        api.MapGet("/reports/activity-overview", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetActivityOverviewAsync(currentUser, cancellationToken));
        });

        api.MapGet("/reports/process-records", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.ReportsViewAll)
                && !currentUser.HasPermission(PermissionKeys.ReportsViewScoped))
            {
                return Results.Forbid();
            }

            return Results.Ok(await store.GetProcessDashboardRecordsAsync(currentUser, cancellationToken));
        });

        api.MapGet("/reports/learning-walk-rollup", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetLearningWalkRollupAsync(currentUser, cancellationToken));
        });

        api.MapGet("/reports/staff-profile-summaries", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetStaffProfileSummariesAsync(currentUser, cancellationToken));
        });

        api.MapGet("/staff-profiles", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetStaffProfileRecordsAsync(currentUser, cancellationToken));
        });

        api.MapGet("/staff-profiles/{staffId:guid}", async (Guid staffId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);

            // Scoped leaders (reports.view_scoped) may open profiles for staff
            // inside their assigned org units or direct reports.
            var canView = CanViewStaffProfile(currentUser, staffId)
                || (currentUser.HasPermission(PermissionKeys.ReportsViewScoped)
                    && await store.IsStaffProfileInScopeAsync(staffId, currentUser, cancellationToken));
            if (!canView)
            {
                return Results.Forbid();
            }

            var detail = await store.GetStaffProfileDetailAsync(staffId, cancellationToken);
            return detail is null ? Results.NotFound() : Results.Ok(detail);
        });

        api.MapGet("/elevate-practice/me", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.StaffId.HasValue || !currentUser.HasPermission(PermissionKeys.ElevatePracticeSubmit))
            {
                return Results.Forbid();
            }

            return Results.Ok(await store.GetElevatePracticeWorkspaceAsync(
                currentUser.StaffId.Value,
                SqlFoundationDataStore.GetCurrentAcademicYear(),
                true,
                cancellationToken));
        });

        api.MapPut("/elevate-practice/me", async (SaveElevatePracticeAssessmentRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.StaffId.HasValue || !currentUser.HasPermission(PermissionKeys.ElevatePracticeSubmit))
            {
                return Results.Forbid();
            }

            var result = await store.SaveElevatePracticeAssessmentAsync(request, currentUser, cancellationToken);
            return Results.Ok(result);
        });

        api.MapGet("/elevate-practice/progress", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.UsersManage)
                ? Results.Ok(await store.GetElevatePracticeProgressAsync(SqlFoundationDataStore.GetCurrentAcademicYear(), cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/elevate-practice/admin/records/{assessmentId:guid}", async (Guid assessmentId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.UsersManage))
            {
                return Results.Forbid();
            }

            var result = await store.GetAdminElevatePracticeWorkspaceAsync(assessmentId, cancellationToken);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        api.MapPut("/elevate-practice/admin/records/{assessmentId:guid}", async (Guid assessmentId, AdminSaveElevatePracticeAssessmentRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.UsersManage))
            {
                return Results.Forbid();
            }

            var result = await store.AdminSaveElevatePracticeAssessmentAsync(assessmentId, request, currentUser, cancellationToken);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        api.MapDelete("/elevate-practice/admin/records/{assessmentId:guid}", async (Guid assessmentId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.UsersManage))
            {
                return Results.Forbid();
            }

            return await store.ArchiveElevatePracticeAssessmentAsync(assessmentId, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapGet("/elevate-practice/admin/records/{assessmentId:guid}/audit", async (Guid assessmentId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.UsersManage)
                ? Results.Ok(await store.GetElevatePracticeAuditHistoryAsync(assessmentId, cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/elevate-practice/staff/{staffId:guid}/latest", async (Guid staffId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var canView = CanViewStaffProfile(currentUser, staffId)
                || (currentUser.HasPermission(PermissionKeys.ReportsViewScoped)
                    && await store.IsStaffProfileInScopeAsync(staffId, currentUser, cancellationToken));
            if (!canView)
            {
                return Results.Forbid();
            }

            var result = await store.GetLatestElevatePracticeWorkspaceAsync(staffId, cancellationToken);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        api.MapGet("/coaching/sessions", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetCoachingSessionsAsync(currentUser, cancellationToken));
        });

        api.MapGet("/coaching/sessions/{id:guid}", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.GetCoachingSessionAsync(id, currentUser, cancellationToken);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        api.MapGet("/coaching/staff/{staffId:guid}/context", async (Guid staffId, Guid? cycleId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.CoachingSubmit)
                && !currentUser.HasPermission(PermissionKeys.CoachingManage))
            {
                return Results.Forbid();
            }

            if (!await store.CanStartCoachingForStaffAsync(staffId, currentUser, cancellationToken))
            {
                return Results.Forbid();
            }

            return Results.Ok(await store.GetCoachingContextAsync(staffId, cycleId, currentUser, cancellationToken));
        });

        api.MapPost("/coaching/sessions", async (SaveCoachingSessionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.CoachingSubmit)
                && !currentUser.HasPermission(PermissionKeys.CoachingManage))
            {
                return Results.Forbid();
            }

            var result = await store.SaveCoachingSessionAsync(null, request, currentUser, cancellationToken);
            return Results.Created($"/api/v1/coaching/sessions/{result.Id}", result);
        });

        api.MapPut("/coaching/sessions/{id:guid}", async (Guid id, SaveCoachingSessionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.CoachingSubmit)
                && !currentUser.HasPermission(PermissionKeys.CoachingManage))
            {
                return Results.Forbid();
            }

            return Results.Ok(await store.SaveCoachingSessionAsync(id, request, currentUser, cancellationToken));
        });

        api.MapPost("/staff-profiles/{staffId:guid}/reflections", async (Guid staffId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.CreateStaffReflectionAsync(staffId, currentUser, cancellationToken);

            return MapStaffReflectionMutation(result, created: true);
        });

        api.MapPut("/staff-profiles/{staffId:guid}/reflections/{reflectionId:guid}", async (Guid staffId, Guid reflectionId, SaveStaffReflectionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.UpdateStaffReflectionAsync(staffId, reflectionId, request, currentUser, cancellationToken);

            return MapStaffReflectionMutation(result, created: false);
        });

        api.MapGet("/admin/users", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.UsersManage)
                ? Results.Ok(await store.GetAdminUsersAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapPost("/admin/users", async (CreateAdminUserRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.UsersManage))
            {
                return Results.Forbid();
            }

            if (string.IsNullOrWhiteSpace(request.DisplayName)
                || string.IsNullOrWhiteSpace(request.Email)
                || string.IsNullOrWhiteSpace(request.ExternalId))
            {
                return Results.BadRequest(new { Message = "A staff name, email address and staff ID are required." });
            }

            if (request.RoleKeys is null || request.RoleKeys.Count == 0)
            {
                return Results.BadRequest(new { Message = "Select at least one role for the account." });
            }

            var id = await store.CreateAdminUserAsync(request, currentUser, cancellationToken);
            return Results.Created($"/api/v1/admin/users/{id}", new { Id = id });
        });

        api.MapPut("/admin/users/{id:guid}", async (Guid id, UpdateAdminUserRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.UsersManage))
            {
                return Results.Forbid();
            }

            var result = await store.UpdateAdminUserAsync(id, request, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapGet("/admin/roles", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return currentUser.HasPermission(PermissionKeys.UsersManage) || currentUser.HasPermission(PermissionKeys.PermissionsManage)
                ? Results.Ok(await store.GetAdminRolesAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapPut("/form-templates/{id:guid}/structure", async (Guid id, UpdateFormTemplateStructureRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.FormsManage))
            {
                return Results.Forbid();
            }

            var result = await store.UpdateFormTemplateStructureAsync(id, request, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapPost("/form-templates/{id:guid}/publish", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.FormsManage))
            {
                return Results.Forbid();
            }

            var result = await store.PublishFormTemplateAsync(id, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        return app;
    }

    private static Task<CurrentUser> GetCurrentUserAsync(
        ClaimsPrincipal principal,
        SqlFoundationDataStore store,
        CancellationToken cancellationToken)
    {
        // Entra ID access tokens carry both a stable object id and the current
        // email claim. Development authentication supplies email only.
        var email = principal.FindFirstValue("preferred_username")
            ?? principal.FindFirstValue("email")
            ?? principal.FindFirstValue(ClaimTypes.Email);
        var providerSubjectId = principal.FindFirstValue("oid")
            ?? principal.FindFirstValue("sub");
        var tenantId = Guid.TryParse(principal.FindFirstValue("tid"), out var parsedTenantId)
            ? parsedTenantId
            : (Guid?)null;
        return store.GetCurrentUserAsync(email, providerSubjectId, tenantId, cancellationToken);
    }

    private static IResult MapStaffReflectionMutation(StaffReflectionMutationResult result, bool created) =>
        result.Status switch
        {
            StaffReflectionMutationStatus.Saved when created => Results.Created(
                $"/api/v1/staff-profiles/{result.Reflection!.StaffId}/reflections/{result.Reflection.Id}",
                result.Reflection),
            StaffReflectionMutationStatus.Saved => Results.Ok(result.Reflection),
            StaffReflectionMutationStatus.Forbidden => Results.Forbid(),
            StaffReflectionMutationStatus.NoSubmittedElevateAssessment => Results.Conflict(new { message = result.Message }),
            StaffReflectionMutationStatus.ValidationFailed => Results.BadRequest(new { message = result.Message }),
            _ => Results.NotFound()
        };

    private static bool CanCreateRecord(CurrentUser currentUser, string recordType)
    {
        return recordType switch
        {
            "learning_walk" => currentUser.HasPermission(PermissionKeys.LearningWalkSubmit),
            "work_scrutiny" => currentUser.HasPermission(PermissionKeys.WorkScrutinySubmit),
            "cpd_event" => currentUser.HasPermission(PermissionKeys.CpdManage),
            "elevate_environment" => currentUser.HasPermission(PermissionKeys.ElevateSubmit)
                || currentUser.HasPermission(PermissionKeys.ElevateManage),
            _ => currentUser.HasPermission(PermissionKeys.FormsManage)
        };
    }

    private static bool CanUseForms(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.FormsManage)
        || currentUser.HasPermission(PermissionKeys.LearningWalkSubmit)
        || currentUser.HasPermission(PermissionKeys.WorkScrutinySubmit)
        || currentUser.HasPermission(PermissionKeys.CpdManage)
        || CanUseElevate(currentUser);

    private static bool CanUseElevate(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.ElevateSubmit)
        || currentUser.HasPermission(PermissionKeys.ElevateManage)
        || currentUser.HasPermission(PermissionKeys.FormsManage)
        || currentUser.HasPermission(PermissionKeys.ReportsViewAll)
        || currentUser.HasPermission(PermissionKeys.ReportsViewScoped);

    private static bool CanSubmitLiv(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.LivSubmit)
        || currentUser.HasPermission(PermissionKeys.LivManage);

    private static bool CanViewStaffProfile(CurrentUser currentUser, Guid staffId) =>
        (currentUser.StaffId.HasValue && currentUser.StaffId.Value == staffId)
        || SqlFoundationDataStore.CanViewAllStaffProfiles(currentUser);
}

public sealed record ModuleSummary(Guid Id, string ModuleKey, string Name, string? Description, string RoutePrefix, int DisplayOrder, bool IsEnabled);
public sealed record StaffSummary(
    Guid Id,
    string ExternalId,
    string DisplayName,
    string Email,
    string? JobTitle,
    Guid? PrimaryOrgUnitId,
    string AccountStatus,
    IReadOnlyList<Guid> OrgUnitIds);
public sealed record RecordSummary(Guid Id, Guid ModuleId, string RecordType, string Title, Guid? SubjectStaffId, Guid? OwnerStaffId, Guid? OrgUnitId, DateOnly? RecordDate, DateTimeOffset CreatedAt, string SubmissionStatus);
public sealed record ActionSummary(
    Guid Id,
    Guid? SourceRecordId,
    string? SourceRecordTitle,
    Guid? SubjectStaffId,
    string? SubjectStaffName,
    Guid OwnerStaffId,
    string? OwnerStaffName,
    string Title,
    string? Detail,
    string? StatusKey,
    string? PriorityKey,
    DateOnly? DueDate,
    DateOnly? CompletedDate,
    string? CompletionNote,
    bool IsOverdue);
public sealed record DashboardSummary(Guid Id, string DashboardKey, string Name, string? Purpose, string PrimaryPermissionKey, bool FacultyScopeRequired);
public sealed record StaffProfileSummary(Guid StaffId, string ExternalId, string DisplayName, string Email, string? JobTitle, string? PrimaryOrgCode, int CpdSessionsAttended, int EvidenceRecords, int OpenActions, int OverdueActions);
public sealed record LookupSummary(string LookupKey, string Name, IReadOnlyList<string> Values);
public sealed record LookupValueSummary(Guid Id, string ValueKey, string DisplayName, int DisplayOrder);
public sealed record CreateLookupValueRequest(string DisplayName);
public sealed record OrgUnitSummary(Guid Id, Guid? ParentOrgUnitId, string OrgUnitType, string Code, string Name, bool IsActive);
public sealed record RoomSummary(Guid Id, string RoomCode, string BuildingName);
public sealed record CourseSummary(Guid Id, string CourseCode, string CourseName, Guid OrgUnitId, string? AcademicYear);
public sealed record RoleSummary(string RoleKey, string Name);
public sealed record PermissionSummary(string PermissionKey, string Name, string Category);
public sealed record AssignedOrgUnitSummary(Guid Id, string Code, string Name);
public sealed record FormTemplateSummary(
    Guid Id,
    Guid ModuleId,
    string ModuleKey,
    string ModuleName,
    string TemplateKey,
    string Name,
    string? Version,
    string Status,
    bool IsEditable,
    IReadOnlyList<AssignedOrgUnitSummary> AssignedOrgUnits,
    int SubmissionCount);
public sealed record ActivityOverviewSummary(string ModuleKey, string ModuleName, string RecordType, long RecordCount);
public sealed record ProcessDashboardRecordSummary(
    Guid Id,
    string ProcessKey,
    string Title,
    string? Summary,
    DateOnly? RecordDate,
    DateTimeOffset CreatedAt,
    string Status,
    Guid? OrgUnitId,
    string? AreaCode,
    string? AreaName,
    string? ParentAreaCode,
    string? OwnerDisplayName,
    string? SubjectDisplayName,
    string? Theme,
    string? Detail,
    string? ParticipantAreaBreakdown,
    int ParticipantCount,
    int AttendanceCredits,
    int SampleSize,
    int ScoreTotal,
    int ScoreCount,
    int BarrierCount);
public sealed record LearningWalkRollupSummary(Guid? FacultyOrgUnitId, string? FacultyCode, string? FacultyName, Guid? ChildOrgUnitId, string? ChildCode, string? ChildName, long RecordCount, DateOnly? LatestRecordDate);
public sealed record RecordDetailSummary(
    Guid Id,
    string ModuleKey,
    string ModuleName,
    string RecordType,
    string Title,
    string? Summary,
    Guid? OrgUnitId,
    string? OrgUnitCode,
    string? OrgUnitName,
    string? ParentOrgUnitCode,
    DateOnly? RecordDate,
    DateTimeOffset CreatedAt,
    string? OwnerDisplayName,
    Guid SubmissionId,
    string TemplateKey,
    string TemplateName,
    string TemplateVersion,
    string SubmissionStatus,
    DateTimeOffset? SubmittedAt,
    DateTimeOffset? ArchivedAt,
    bool CanEdit,
    IReadOnlyList<Guid> CourseIds,
    IReadOnlyList<RecordDetailSectionSummary> Sections);
public sealed record RecordDetailSectionSummary(Guid Id, string SectionKey, string Title, int DisplayOrder, IReadOnlyList<RecordDetailFieldSummary> Fields);
public sealed record RecordDetailFieldSummary(Guid Id, string FieldKey, string Label, string FieldType, bool IsRequired, int DisplayOrder, string? HelpText, IReadOnlyList<string> Options, string? Value);

public sealed record CreateRecordRequest(Guid ModuleId, string RecordType, string Title, string? Summary, Guid? SubjectStaffId, Guid? OwnerStaffId, Guid? OrgUnitId, DateOnly? RecordDate);
public sealed record CreateActionRequest(Guid? SourceRecordId, Guid? SubjectStaffId, Guid OwnerStaffId, string Title, string? Detail, Guid? PriorityLookupValueId, Guid? StatusLookupValueId, DateOnly? DueDate, bool PublishedToStaff);
public sealed record CreateFormTemplateRequest(string ModuleKey, string Name, string? Description, Guid? OrgUnitId);
public sealed record FormDefinitionSummary(Guid TemplateId, Guid VersionId, string TemplateKey, string Name, string Version, IReadOnlyList<FormSectionSummary> Sections);
public sealed record FormSectionSummary(Guid Id, string SectionKey, string Title, int DisplayOrder, IReadOnlyList<FormFieldSummary> Fields);
public sealed record FormFieldSummary(Guid Id, string FieldKey, string Label, string FieldType, bool IsRequired, int DisplayOrder, string? HelpText, IReadOnlyList<string> Options);
public sealed record LearningWalkThemeMappingSummary(Guid Id, Guid FacultyOrgUnitId, Guid ChildOrgUnitId, string AgreedTheme);
public sealed record UpdateLearningWalkThemeMappingRequest(Guid FacultyOrgUnitId, Guid ChildOrgUnitId, string AgreedTheme);
public sealed record LearningWalkThemeSummary(Guid Id, Guid ThemeGroupId, string Name, int DisplayOrder, bool IsOther, bool IsActive);
public sealed record LearningWalkThemeGroupSummary(Guid Id, string GroupKey, string Name, int DisplayOrder, IReadOnlyList<LearningWalkThemeSummary> Themes);
public sealed record SaveLearningWalkThemeRequest(Guid ThemeGroupId, string Name);
public sealed record SetLearningWalkThemeStatusRequest(bool IsActive);
public sealed record ReorderLearningWalkThemesRequest(Guid ThemeGroupId, IReadOnlyList<Guid> ThemeIds);
public sealed record SubmitFormRequest(
    string TemplateKey,
    string RecordType,
    string Title,
    string? Summary,
    Guid? SubjectStaffId,
    Guid? OrgUnitId,
    DateOnly? RecordDate,
    IReadOnlyList<SubmitFormResponseRequest> Responses,
    bool SaveAsDraft = false,
    IReadOnlyList<Guid>? CourseIds = null,
    IReadOnlyList<SubmitLinkedActionRequest>? Actions = null);
public sealed record SubmitLinkedActionRequest(string Title, Guid OwnerStaffId, DateOnly DueDate);
public sealed record SubmittedFormResult(Guid SubmissionId, Guid RecordId);
public sealed record ChangeSubmissionStatusRequest(string Action);
public sealed record UpdateActionRequest(
    string? Title,
    string? Detail,
    DateOnly? DueDate,
    string? Status,
    string? CompletionNote);
public sealed record SaveLivRecordRequest(
    Guid SubjectStaffId,
    Guid? OrgUnitId,
    string? CourseSeen,
    DateOnly? LivDate,
    string? LivTime,
    string? PreConversation,
    string? LivOverview,
    string? PostConversation,
    DateOnly? FollowUpProjectedDate,
    string? SecondLivOverview,
    bool SaveAsDraft = false);
public sealed record LivRecordSummary(
    Guid Id,
    Guid RecordId,
    Guid SubjectStaffId,
    string SubjectStaffName,
    Guid? ReviewerStaffId,
    string? ReviewerStaffName,
    Guid? OrgUnitId,
    string? OrgUnitCode,
    string? ParentOrgUnitCode,
    string? CourseSeen,
    DateOnly? LivDate,
    string? LivTime,
    string? PreConversation,
    string? LivOverview,
    string? PostConversation,
    DateOnly? FollowUpProjectedDate,
    string? SecondLivOverview,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt,
    bool CanEdit);
public sealed record SubmitFormResponseRequest(Guid FieldId, string? Value);
public sealed record UpdateFormSubmissionRequest(
    string Title,
    string? Summary,
    Guid? SubjectStaffId,
    Guid? OrgUnitId,
    DateOnly? RecordDate,
    IReadOnlyList<SubmitFormResponseRequest> Responses,
    IReadOnlyList<Guid>? CourseIds = null);
public enum FormSubmissionUpdateResult
{
    Saved,
    NotFound,
    Forbidden
}

public sealed record StaffProfileRecordSummary(
    Guid StaffId,
    string ExternalId,
    string DisplayName,
    string Email,
    string? JobTitle,
    string? PrimaryOrgCode,
    string AccountStatus,
    int ReflectionCount,
    int SubmittedReflections,
    int DraftReflections,
    int OpenActions);

public sealed record StaffProfileDetail(
    Guid StaffId,
    string ExternalId,
    string DisplayName,
    string Email,
    string? PrimaryOrgCode,
    string AccountStatus,
    int EvidenceSubmitted,
    int MilestonesCompleted,
    IReadOnlyList<StaffReflectionSummary> Reflections,
    IReadOnlyList<StaffCpdRecordSummary> CpdRecords,
    IReadOnlyList<StaffProfileActionSummary> Actions,
    IReadOnlyList<StaffProfileCoachingSummary> CoachingRecords,
    StaffElevatePracticeSummary? ElevatePractice);

public sealed record StaffReflectionSummary(
    Guid Id,
    Guid StaffId,
    Guid ElevatePracticeAssessmentId,
    Guid ElevatePracticeRecordId,
    string ElevatePracticeAcademicYear,
    DateOnly ReflectionDate,
    string? Progress,
    string? Impact,
    string? Examples,
    string Status,
    IReadOnlyList<StaffReflectionDevelopmentAreaSummary> DevelopmentAreas,
    Guid? CreatedByUserAccountId,
    string? CreatedByName,
    DateTimeOffset CreatedAt,
    Guid? UpdatedByUserAccountId,
    string? UpdatedByName,
    DateTimeOffset? UpdatedAt);

public sealed record StaffReflectionDevelopmentAreaSummary(
    Guid DevelopmentAreaId,
    string TextSnapshot,
    int DisplayOrder);

public sealed record SaveStaffReflectionRequest(
    DateOnly ReflectionDate,
    string? Progress,
    string? Impact,
    string? Examples,
    string Status);

public enum StaffReflectionMutationStatus
{
    Saved,
    NotFound,
    Forbidden,
    NoSubmittedElevateAssessment,
    ValidationFailed
}

public sealed record StaffReflectionMutationResult(
    StaffReflectionMutationStatus Status,
    StaffReflectionSummary? Reflection,
    string? Message);

public sealed record StaffCpdRecordSummary(Guid Id, string Title, DateOnly EventDate, string? Themes);

public sealed record StaffProfileActionSummary(
    Guid Id,
    string Title,
    string? Detail,
    DateTimeOffset CreatedAt,
    Guid? SourceRecordId,
    string? SourceRecordTitle,
    string? SourceRecordType,
    string? SourceModuleName,
    string OwnerName,
    string? StatusKey,
    DateOnly? DueDate,
    DateOnly? CompletedDate,
    bool IsOverdue);

public sealed record StaffProfileCoachingSummary(
    Guid Id,
    Guid RecordId,
    int CycleNumber,
    int SessionNumber,
    DateOnly SessionDate,
    string SessionType,
    string Status,
    string CoachName,
    string? MainFocus,
    string? KeyTakeaway);

public sealed record AdminUserSummary(
    Guid UserAccountId,
    Guid StaffId,
    string ExternalId,
    string DisplayName,
    string Email,
    string? JobTitle,
    Guid? PrimaryOrgUnitId,
    string? PrimaryOrgCode,
    string AccountStatus,
    bool IsDisabled,
    DateTimeOffset? LastLoginAt,
    IReadOnlyList<RoleSummary> Roles,
    IReadOnlyList<AdminUserScopeSummary> Scopes);

public sealed record AdminUserScopeSummary(string ScopeType, Guid? OrgUnitId, string? OrgUnitCode);

public sealed record AdminRoleSummary(
    Guid Id,
    string RoleKey,
    string Name,
    string? Description,
    bool IsSystem,
    int Precedence,
    IReadOnlyList<PermissionSummary> Permissions);

public sealed record CreateAdminUserRequest(
    string ExternalId,
    string DisplayName,
    string Email,
    string? JobTitle,
    Guid? PrimaryOrgUnitId,
    IReadOnlyList<string>? RoleKeys,
    IReadOnlyList<Guid>? ScopeOrgUnitIds,
    string? AccountStatus);

public sealed record UpdateAdminUserRequest(
    string? DisplayName,
    string? JobTitle,
    Guid? PrimaryOrgUnitId,
    string? AccountStatus,
    bool? IsDisabled,
    IReadOnlyList<string>? RoleKeys,
    IReadOnlyList<Guid>? ScopeOrgUnitIds);

public sealed record UpdateFormTemplateStructureRequest(
    string Name,
    string? Description,
    Guid? OrgUnitId,
    IReadOnlyList<FormStructureSectionRequest> Sections);

public sealed record FormStructureSectionRequest(
    string SectionKey,
    string Title,
    int DisplayOrder,
    IReadOnlyList<FormStructureFieldRequest> Fields);

public sealed record FormStructureFieldRequest(
    string FieldKey,
    string Label,
    string FieldType,
    bool IsRequired,
    int DisplayOrder,
    string? HelpText,
    IReadOnlyList<string>? Options);
