using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
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

        api.MapGet("/onboarding/options", async (SqlFoundationDataStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetStaffOnboardingOptionsAsync(cancellationToken)));

        api.MapPost("/onboarding", async (CompleteStaffOnboardingRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (currentUser.UserAccountId.HasValue)
            {
                return Results.Conflict(new { Message = "This Microsoft account has already completed onboarding." });
            }

            var email = principal.FindFirstValue("preferred_username")
                ?? principal.FindFirstValue("email")
                ?? principal.FindFirstValue(ClaimTypes.Email);
            var objectId = principal.FindFirstValue("oid");
            var displayName = principal.FindFirstValue("name")
                ?? principal.Identity?.Name
                ?? email?.Split('@')[0];
            if (string.IsNullOrWhiteSpace(email)
                || string.IsNullOrWhiteSpace(objectId)
                || string.IsNullOrWhiteSpace(displayName)
                || !Guid.TryParse(principal.FindFirstValue("tid"), out var tenantId))
            {
                return Results.BadRequest(new { Message = "Your Microsoft sign-in is missing the Entra identity details required to create an account." });
            }

            var onboardedUser = await store.CompleteStaffOnboardingAsync(
                request,
                email,
                displayName,
                objectId,
                tenantId,
                cancellationToken);
            return Results.Ok(onboardedUser);
        });

        api.MapGet("/modules", async (SqlFoundationDataStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetModulesAsync(cancellationToken)));

        api.MapGet("/lookups", async (SqlFoundationDataStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetLookupsAsync(cancellationToken)));

        api.MapGet("/admin/lookups/{lookupKey}/values", async (string lookupKey, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageLists(currentUser)
                || currentUser.HasPermission(PermissionKeys.PermissionsManage)
                ? Results.Ok(await store.GetLookupValuesAsync(lookupKey, cancellationToken))
                : Results.Forbid();
        });

        api.MapPost("/admin/lookups/{lookupKey}/values", async (string lookupKey, CreateLookupValueRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageLists(currentUser)
                || currentUser.HasPermission(PermissionKeys.PermissionsManage)
                ? Results.Ok(await store.SaveLookupValueAsync(lookupKey, request.DisplayName, currentUser, cancellationToken))
                : Results.Forbid();
        });

        api.MapPost("/admin/lookups/{lookupKey}/values/{id:guid}/archive", async (string lookupKey, Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageLists(currentUser)
                && !currentUser.HasPermission(PermissionKeys.PermissionsManage))
            {
                return Results.Forbid();
            }

            return await store.ArchiveLookupValueAsync(lookupKey, id, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapGet("/org-units", async (SqlFoundationDataStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetOrgUnitsAsync(cancellationToken)));

        api.MapGet("/themes/{applicationKey}", async (string applicationKey, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetSharedThemeGroupsAsync(applicationKey, includeInactive: true, cancellationToken)));

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

        api.MapGet("/my-team", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return MyTeamAccessPolicy.CanView(currentUser)
                ? Results.Ok(await store.GetMyTeamAsync(currentUser, cancellationToken))
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
            if (!CanUseFormTemplate(currentUser, templateKey))
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
            if (!currentUser.HasPermission(PermissionKeys.FormsManage)
                && !AdministrationAccessPolicy.CanManageLists(currentUser))
            {
                return Results.Forbid();
            }

            return Results.Ok(await store.GetLearningWalkThemeGroupsAsync(includeInactive: true, cancellationToken));
        });

        api.MapPost("/admin/learning-walk/themes", async (SaveLearningWalkThemeRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!currentUser.HasPermission(PermissionKeys.FormsManage)
                && !AdministrationAccessPolicy.CanManageLists(currentUser))
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
            if (!currentUser.HasPermission(PermissionKeys.FormsManage)
                && !AdministrationAccessPolicy.CanManageLists(currentUser))
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
            if (!currentUser.HasPermission(PermissionKeys.FormsManage)
                && !AdministrationAccessPolicy.CanManageLists(currentUser))
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
            if (!currentUser.HasPermission(PermissionKeys.FormsManage)
                && !AdministrationAccessPolicy.CanManageLists(currentUser))
            {
                return Results.Forbid();
            }

            await store.ReorderLearningWalkThemesAsync(request, currentUser, cancellationToken);
            return Results.NoContent();
        });

        api.MapPost("/form-submissions", async (SubmitFormRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanSubmitForm(currentUser, request))
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

        api.MapGet("/records", async (string? academicYear, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetRecordsAsync(currentUser, academicYear, cancellationToken));
        });

        api.MapGet("/records/{id:guid}", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var detail = await store.GetRecordDetailAsync(id, currentUser, cancellationToken);
            return detail is null ? Results.NotFound() : Results.Ok(detail);
        });

        api.MapGet("/records/{id:guid}/navigation", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var navigation = await store.GetRecordNavigationAsync(id, currentUser, cancellationToken);
            return navigation is null ? Results.NotFound() : Results.Ok(navigation);
        });

        api.MapGet("/admin/work-scrutiny/records", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageRecords(currentUser)
                ? Results.Ok(await store.GetAdminWorkScrutinyRecordsAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/elevate-environment/pillars", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return CanUseElevate(currentUser)
                ? Results.Ok(await store.GetElevateEnvironmentPillarsAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/admin/work-scrutiny/records/{id:guid}", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageRecords(currentUser))
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
            if (!AdministrationAccessPolicy.CanManageRecords(currentUser))
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
            if (!AdministrationAccessPolicy.CanManageRecords(currentUser))
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
            if (!AccessBoundaryPolicy.CanCreateGenericRecord(currentUser))
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

        api.MapGet("/actions", async (bool? includeDeleted, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetActionsAsync(currentUser, includeDeleted == true, cancellationToken));
        });

        api.MapGet("/actions/owner-options", async (Guid? sourceRecordId, Guid? subjectStaffId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetActionOwnerOptionsAsync(sourceRecordId, subjectStaffId, currentUser, cancellationToken));
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
            return Results.Ok(await store.GetLivCasesV2Async(currentUser, cancellationToken));
        });

        api.MapGet("/liv-records/configuration", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return CanSubmitLiv(currentUser)
                ? Results.Ok(await store.GetLivConfigurationAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/liv-records/staff/{staffId:guid}/context", async (Guid staffId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanSubmitLiv(currentUser)) return Results.Forbid();
            var context = await store.GetLivStaffContextAsync(staffId, currentUser, cancellationToken);
            return context is null ? Results.NotFound() : Results.Ok(context);
        });

        api.MapPost("/liv-records", async (SaveLivCaseRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
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

            var id = await store.CreateLivCaseV2Async(request, currentUser, cancellationToken);
            return Results.Created($"/api/v1/liv-records/{id}", new { Id = id });
        });

        api.MapPut("/liv-records/{id:guid}", async (Guid id, SaveLivCaseRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanSubmitLiv(currentUser))
            {
                return Results.Forbid();
            }

            var result = await store.UpdateLivCaseV2Async(id, request, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapPost("/liv-records/{id:guid}/visits", async (Guid id, SaveLivVisitRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanSubmitLiv(currentUser))
            {
                return Results.Forbid();
            }

            var visit = await store.AddLivVisitAsync(id, request, currentUser, cancellationToken);
            return visit is null
                ? Results.NotFound()
                : Results.Created($"/api/v1/liv-records/{id}/visits/{visit.Id}", visit);
        });

        api.MapPut("/liv-records/{id:guid}/visits/{visitId:guid}", async (Guid id, Guid visitId, SaveLivVisitRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanSubmitLiv(currentUser))
            {
                return Results.Forbid();
            }

            var result = await store.UpdateLivVisitV2Async(id, visitId, request, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapPost("/liv-records/{id:guid}/stages", async (Guid id, SaveLivStageRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanSubmitLiv(currentUser)) return Results.Forbid();
            var stage = await store.AddLivStageAsync(id, request, currentUser, cancellationToken);
            return stage is null
                ? Results.NotFound()
                : Results.Created($"/api/v1/liv-records/{id}/stages/{stage.Id}", stage);
        });

        api.MapPut("/liv-records/{id:guid}/stages/{stageId:guid}", async (Guid id, Guid stageId, SaveLivStageRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.UpdateLivStageAsync(id, stageId, request, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapPost("/liv-records/{id:guid}/cycles/current/complete", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanSubmitLiv(currentUser)) return Results.Forbid();
            var cycle = await store.CompleteLivCycleAsync(id, currentUser, cancellationToken);
            return cycle is null ? Results.NotFound() : Results.Ok(cycle);
        });

        api.MapGet("/probation-observations", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return Results.Ok(await store.GetProbationCasesAsync(currentUser, cancellationToken));
        });

        api.MapGet("/probation-observations/configuration", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var configuration = await store.GetProbationConfigurationAsync(currentUser, cancellationToken);
            return CanSubmitProbation(currentUser)
                ? Results.Ok(configuration)
                : Results.Ok(configuration with { TeachingLearningReviewers = [], EligibleStaff = [], CanCreateCase = false });
        });

        api.MapGet("/probation-observations/staff/{staffId:guid}/context", async (Guid staffId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanSubmitProbation(currentUser)) return Results.Forbid();
            var context = await store.GetProbationStaffContextAsync(staffId, currentUser, cancellationToken);
            return context is null ? Results.NotFound() : Results.Ok(context);
        });

        api.MapPost("/probation-observations", async (CreateProbationCaseRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanSubmitProbation(currentUser)) return Results.Forbid();
            var id = await store.CreateProbationCaseAsync(request, currentUser, cancellationToken);
            return Results.Created($"/api/v1/probation-observations/{id}", new { Id = id });
        });

        api.MapPut("/probation-observations/{caseId:guid}/observations/{observationId:guid}/stages/{stageId:guid}", async (
            Guid caseId, Guid observationId, Guid stageId, SaveProbationStageRequest request,
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.UpdateProbationStageAsync(caseId, observationId, stageId, request, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapPut("/probation-observations/{caseId:guid}/observations/{observationId:guid}/visit", async (
            Guid caseId, Guid observationId, SaveProbationVisitRequest request,
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.UpdateProbationVisitAsync(caseId, observationId, request, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapPost("/probation-observations/{caseId:guid}/observations/{observationId:guid}/complete", async (
            Guid caseId, Guid observationId, ClaimsPrincipal principal,
            SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.CompleteProbationObservationAsync(caseId, observationId, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapPost("/probation-observations/{caseId:guid}/observations/2/start", async (
            Guid caseId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanSubmitProbation(currentUser)) return Results.Forbid();
            var result = await store.StartProbationLivAsync(caseId, currentUser, cancellationToken);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        api.MapGet("/actions/{id:guid}/extensions", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var extensions = await store.GetActionExtensionsAsync(id, currentUser, cancellationToken);
            return extensions is null ? Results.NotFound() : Results.Ok(extensions);
        });

        api.MapDelete("/actions/{id:guid}", async (Guid id, [FromBody] DeleteActionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.DeleteActionAsync(id, request.Reason, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapPost("/actions/{id:guid}/restore", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.RestoreActionAsync(id, currentUser, cancellationToken);
            return result switch
            {
                FormSubmissionUpdateResult.Saved => Results.NoContent(),
                FormSubmissionUpdateResult.Forbidden => Results.Forbid(),
                _ => Results.NotFound()
            };
        });

        api.MapPost("/actions/{id:guid}/extend", async (Guid id, ExtendActionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.ExtendActionAsync(id, request, currentUser, cancellationToken);

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
            var result = await store.ChangeLivCaseStatusAsync(id, request.Action, currentUser, cancellationToken);
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

        api.MapGet("/academic-years", async (SqlFoundationDataStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetAcademicYearsAsync(cancellationToken)));

        api.MapGet("/staff-profiles/{staffId:guid}", async (Guid staffId, string? academicYear, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
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

            var detail = await store.GetStaffProfileShellAsync(
                staffId,
                academicYear ?? SqlFoundationDataStore.GetCurrentAcademicYear(),
                currentUser,
                cancellationToken);
            return detail is null ? Results.NotFound() : Results.Ok(detail);
        });

        api.MapGet("/staff-profiles/{staffId:guid}/elevate-status", async (Guid staffId, string? academicYear, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var canView = CanViewStaffProfile(currentUser, staffId)
                || (currentUser.HasPermission(PermissionKeys.ReportsViewScoped)
                    && await store.IsStaffProfileInScopeAsync(staffId, currentUser, cancellationToken));
            if (!canView)
            {
                return Results.Forbid();
            }

            return Results.Ok(await store.GetElevateStatusAsync(
                staffId,
                academicYear ?? SqlFoundationDataStore.GetCurrentAcademicYear(),
                currentUser,
                cancellationToken));
        });

        api.MapPut("/staff-profiles/{staffId:guid}/elevate-status/{levelNumber:int}", async (Guid staffId, int levelNumber, SaveElevateStatusLevelRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var canView = CanViewStaffProfile(currentUser, staffId)
                || (currentUser.HasPermission(PermissionKeys.ReportsViewScoped)
                    && await store.IsStaffProfileInScopeAsync(staffId, currentUser, cancellationToken));
            if (!canView || !ElevateStatusAccessPolicy.CanUpdateLevel(currentUser, staffId, levelNumber))
            {
                return Results.Forbid();
            }

            return Results.Ok(await store.SaveElevateStatusLevelAsync(
                staffId,
                levelNumber,
                request,
                currentUser,
                cancellationToken));
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
            return AdministrationAccessPolicy.CanManageRecords(currentUser)
                ? Results.Ok(await store.GetElevatePracticeProgressAsync(SqlFoundationDataStore.GetCurrentAcademicYear(), cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/elevate-practice/admin/records/{assessmentId:guid}", async (Guid assessmentId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageRecords(currentUser))
            {
                return Results.Forbid();
            }

            var result = await store.GetAdminElevatePracticeWorkspaceAsync(assessmentId, cancellationToken);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        api.MapPut("/elevate-practice/admin/records/{assessmentId:guid}", async (Guid assessmentId, AdminSaveElevatePracticeAssessmentRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageRecords(currentUser))
            {
                return Results.Forbid();
            }

            var result = await store.AdminSaveElevatePracticeAssessmentAsync(assessmentId, request, currentUser, cancellationToken);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        api.MapDelete("/elevate-practice/admin/records/{assessmentId:guid}", async (Guid assessmentId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageRecords(currentUser))
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
            return AdministrationAccessPolicy.CanManageRecords(currentUser)
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

        api.MapGet("/elevate-practice/records/{recordId:guid}", async (Guid recordId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            var result = await store.GetElevatePracticeWorkspaceByRecordAsync(recordId, cancellationToken);
            if (result is null)
            {
                return Results.NotFound();
            }

            var canView = CanViewStaffProfile(currentUser, result.StaffId)
                || (currentUser.HasPermission(PermissionKeys.ReportsViewScoped)
                    && await store.IsStaffProfileInScopeAsync(result.StaffId, currentUser, cancellationToken));
            return canView ? Results.Ok(result) : Results.Forbid();
        });

        api.MapGet("/coaching/configuration", async (SqlFoundationDataStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.GetCoachingConfigurationAsync(cancellationToken)));

        api.MapPut("/admin/coaching/configuration", async (
            UpdateCoachingConfigurationRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageLists(currentUser)
                && !currentUser.HasPermission(PermissionKeys.CoachingManage))
            {
                return Results.Forbid();
            }

            var maxActions = await store.UpdateCoachingConfigurationAsync(request, currentUser, cancellationToken);
            return Results.Ok(new { MaxActionsPerSession = maxActions });
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

        api.MapGet("/admin/organisation/staff", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageOrganisation(currentUser)
                ? Results.Ok(await store.GetAdminOrganisationStaffAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/admin/organisation/structure", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageOrganisation(currentUser)
                ? Results.Ok(await store.GetAdminOrganisationStructureAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapPut("/admin/organisation/units/{orgUnitId:guid}/manager", async (Guid orgUnitId, SaveOrgUnitManagerRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageOrganisation(currentUser))
            {
                return Results.Forbid();
            }

            var id = await store.SaveOrgUnitManagerAsync(orgUnitId, request, currentUser, cancellationToken);
            return Results.Ok(new { Id = id });
        });

        api.MapPost("/admin/organisation/units/{orgUnitId:guid}/manager/archive", async (Guid orgUnitId, ArchiveReasonRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageOrganisation(currentUser))
            {
                return Results.Forbid();
            }

            return await store.ArchiveOrgUnitManagerAsync(orgUnitId, request.Reason, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapPost("/admin/organisation/staff/{staffId:guid}/memberships", async (Guid staffId, SaveOrganisationMembershipRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageOrganisation(currentUser))
            {
                return Results.Forbid();
            }

            var id = await store.SaveOrganisationMembershipAsync(staffId, request, currentUser, cancellationToken);
            return Results.Created($"/api/v1/admin/organisation/staff/{staffId}/memberships/{id}", new { Id = id });
        });

        api.MapPost("/admin/organisation/staff/{staffId:guid}/memberships/{membershipId:guid}/primary", async (Guid staffId, Guid membershipId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageOrganisation(currentUser))
            {
                return Results.Forbid();
            }

            return await store.SetPrimaryOrganisationMembershipAsync(staffId, membershipId, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapPost("/admin/organisation/staff/{staffId:guid}/memberships/{membershipId:guid}/archive", async (Guid staffId, Guid membershipId, ArchiveReasonRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageOrganisation(currentUser))
            {
                return Results.Forbid();
            }

            return await store.ArchiveOrganisationMembershipAsync(staffId, membershipId, request.Reason, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapPost("/admin/organisation/staff/{staffId:guid}/managers", async (Guid staffId, SaveManagerRelationshipRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageOrganisation(currentUser))
            {
                return Results.Forbid();
            }

            var id = await store.SaveManagerRelationshipAsync(staffId, request, currentUser, cancellationToken);
            return Results.Created($"/api/v1/admin/organisation/staff/{staffId}/managers/{id}", new { Id = id });
        });

        api.MapPost("/admin/organisation/staff/{staffId:guid}/managers/{relationshipId:guid}/archive", async (Guid staffId, Guid relationshipId, ArchiveReasonRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageOrganisation(currentUser))
            {
                return Results.Forbid();
            }

            return await store.ArchiveManagerRelationshipAsync(staffId, relationshipId, request.Reason, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapGet("/admin/lists", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageLists(currentUser)
                ? Results.Ok(await store.GetAdminManagedListsAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapPut("/admin/lists/{lookupKey}/values/{id:guid}", async (string lookupKey, Guid id, UpdateManagedListValueRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageLists(currentUser))
            {
                return Results.Forbid();
            }

            return await store.UpdateManagedListValueAsync(lookupKey, id, request.DisplayName, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapPost("/admin/lists/{lookupKey}/values/{id:guid}/status", async (string lookupKey, Guid id, SetManagedListValueStatusRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageLists(currentUser))
            {
                return Results.Forbid();
            }

            return await store.SetManagedListValueStatusAsync(lookupKey, id, request.IsActive, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapPut("/admin/lists/{lookupKey}/values/reorder", async (string lookupKey, ReorderManagedListValuesRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageLists(currentUser))
            {
                return Results.Forbid();
            }

            await store.ReorderManagedListValuesAsync(lookupKey, request.ValueIds, currentUser, cancellationToken);
            return Results.NoContent();
        });

        api.MapGet("/admin/records", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageRecords(currentUser)
                ? Results.Ok(await store.GetAdminRecordsAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/admin/records/{recordId:guid}/audit", async (Guid recordId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageRecords(currentUser)
                ? Results.Ok(await store.GetRecordAuditHistoryAsync(recordId, cancellationToken))
                : Results.Forbid();
        });

        api.MapPost("/admin/records/{recordId:guid}/archive", async (Guid recordId, ArchiveReasonRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageRecords(currentUser))
            {
                return Results.Forbid();
            }

            return await store.SetAdminRecordArchivedStateAsync(recordId, true, request.Reason, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapPost("/admin/records/{recordId:guid}/restore", async (Guid recordId, ArchiveReasonRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var currentUser = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageRecords(currentUser))
            {
                return Results.Forbid();
            }

            return await store.SetAdminRecordArchivedStateAsync(recordId, false, request.Reason, currentUser, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
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

    private static bool CanSubmitForm(CurrentUser currentUser, SubmitFormRequest request)
    {
        if (string.Equals(request.TemplateKey, "cpd_external_self_log", StringComparison.OrdinalIgnoreCase))
        {
            return string.Equals(request.RecordType, "cpd_event", StringComparison.OrdinalIgnoreCase)
                && currentUser.StaffId.HasValue
                && currentUser.HasPermission(PermissionKeys.CpdSelfLog);
        }

        if (string.Equals(request.RecordType, "cpd_event", StringComparison.OrdinalIgnoreCase))
        {
            return string.Equals(request.TemplateKey, "cpd_core", StringComparison.OrdinalIgnoreCase)
                && currentUser.HasPermission(PermissionKeys.CpdManage);
        }

        return CanCreateRecord(currentUser, request.RecordType);
    }

    private static bool CanUseFormTemplate(CurrentUser currentUser, string templateKey)
    {
        if (string.Equals(templateKey, "cpd_external_self_log", StringComparison.OrdinalIgnoreCase))
        {
            return currentUser.StaffId.HasValue && currentUser.HasPermission(PermissionKeys.CpdSelfLog);
        }

        if (string.Equals(templateKey, "cpd_core", StringComparison.OrdinalIgnoreCase))
        {
            return currentUser.HasPermission(PermissionKeys.CpdManage);
        }

        return CanUseForms(currentUser);
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

    private static bool CanSubmitProbation(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.ProbationSubmit)
        || currentUser.HasPermission(PermissionKeys.ProbationManage);

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
public sealed record MyTeamOrgUnitSummary(Guid Id, string Code, string Name);
public sealed record MyTeamMemberSummary(
    Guid StaffId,
    string ExternalId,
    string DisplayName,
    string Email,
    string AccountStatus,
    IReadOnlyList<MyTeamOrgUnitSummary> Faculties,
    IReadOnlyList<MyTeamOrgUnitSummary> Teams,
    IReadOnlyList<string> RoleNames,
    int OpenActionCount,
    int OverdueActionCount,
    string? ElevateJudgement,
    bool CanOpenProfile,
    bool CanManageActions);
public sealed record RecordSummary(Guid Id, Guid ModuleId, string RecordType, string Title, Guid? SubjectStaffId, Guid? OwnerStaffId, Guid? OrgUnitId, DateOnly? RecordDate, DateTimeOffset CreatedAt, string SubmissionStatus, string AcademicYear);

public sealed record RecordNavigationSummary(Guid Id, string RecordType, Guid? SubjectStaffId);
public sealed record ActionSummary(
    Guid Id,
    Guid? SourceRecordId,
    string? SourceRecordTitle,
    string SourceFormType,
    string? SourceSubRecordType,
    Guid? SourceSubRecordId,
    string? SourceSubRecordKey,
    Guid? SubjectStaffId,
    string? SubjectStaffName,
    Guid OwnerStaffId,
    string? OwnerStaffName,
    string Title,
    string? Detail,
    string? StatusKey,
    string? PriorityKey,
    DateOnly? DueDate,
    DateOnly? OriginalDueDate,
    DateOnly? RevisedDueDate,
    DateOnly? CompletedDate,
    string? CompletionNote,
    string? CancellationComments,
    string VisibilitySetting,
    bool PublishedToStaff,
    bool IsOverdue,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt,
    DateTimeOffset? DeletedAt,
    string? CreatedByName,
    string? UpdatedByName,
    string? CompletedByName,
    string? CancelledByName,
    string? DeletedByName,
    string? DeletionReason,
    Guid? FacultyId,
    string? FacultyCode,
    string? FacultyName,
    Guid? TeamId,
    string? TeamCode,
    string? TeamName,
    int ExtensionCount,
    string? LastExtensionReason,
    Guid? LivVisitId,
    Guid? LivCycleId,
    DateOnly? ReviewDate,
    string? IntendedEvidence,
    string? IntendedImpact,
    string? ProgressStatus,
    Guid? ParentActionId,
    string AcademicYear)
{
    public bool IsDeleted => DeletedAt.HasValue;
}
public sealed record DashboardSummary(Guid Id, string DashboardKey, string Name, string? Purpose, string PrimaryPermissionKey, bool FacultyScopeRequired);
public sealed record StaffProfileSummary(Guid StaffId, string ExternalId, string DisplayName, string Email, string? JobTitle, string? PrimaryOrgCode, int CpdSessionsAttended, int EvidenceRecords, int OpenActions, int OverdueActions);
public sealed record LookupSummary(string LookupKey, string Name, IReadOnlyList<string> Values);
public sealed record LookupValueSummary(Guid Id, string ValueKey, string DisplayName, int DisplayOrder);
public sealed record CreateLookupValueRequest(string DisplayName);
public sealed record OrgUnitSummary(Guid Id, Guid? ParentOrgUnitId, string OrgUnitType, string Code, string Name, bool IsActive);
public sealed record RoomSummary(Guid Id, string RoomCode, string BuildingName);
public sealed record ElevateEnvironmentPillarSummary(
    Guid Id,
    string PillarKey,
    string Name,
    string Description,
    int DisplayOrder,
    bool IsActive,
    string AssetUri,
    string AssetAltText,
    IReadOnlyList<ElevateEnvironmentRubricDescriptorSummary> Rubric);
public sealed record ElevateEnvironmentRubricDescriptorSummary(
    Guid Id,
    int Score,
    string JudgementKey,
    string Judgement,
    string Descriptor,
    string? ColorHex);
public sealed record CourseSummary(Guid Id, string CourseCode, string CourseName, Guid OrgUnitId, string? AcademicYear);
public sealed record RoleSummary(string RoleKey, string Name, bool IsOrganisationManaged = false);
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
    int LearningMinutes,
    int SampleSize,
    int ScoreTotal,
    int ScoreCount,
    int BarrierCount,
    int ScoreMaximum,
    Guid? RelatedRecordId = null);
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
public sealed record CreateActionRequest(
    Guid? SourceRecordId,
    Guid? SubjectStaffId,
    Guid OwnerStaffId,
    string Title,
    string? Detail,
    Guid? PriorityLookupValueId,
    Guid? StatusLookupValueId,
    DateOnly? DueDate,
    bool PublishedToStaff,
    Guid? LivVisitId = null,
    Guid? LivCycleId = null,
    string? SourceFormType = null,
    string? SourceSubRecordType = null,
    Guid? SourceSubRecordId = null,
    string? SourceSubRecordKey = null,
    string? VisibilitySetting = null);
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
    string? CompletionNote,
    Guid? OwnerStaffId = null,
    string? VisibilitySetting = null,
    string? CancellationComments = null);
public sealed record ExtendActionRequest(DateOnly DueDate, string Reason);
public sealed record DeleteActionRequest(string Reason);
public sealed record ActionExtensionSummary(
    Guid Id,
    DateOnly PreviousDueDate,
    DateOnly ExtendedDueDate,
    string Reason,
    string? CreatedByName,
    DateTimeOffset CreatedAt);
public sealed record ActionOwnerOptionSummary(
    Guid StaffId,
    string DisplayName,
    string Relationship,
    Guid? OrgUnitId,
    string? OrgUnitCode);
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
public sealed record SaveLivVisitRequest(
    DateOnly? VisitDate,
    string? VisitTime,
    string? CourseName,
    string? CourseGroup,
    string? CourseLevel,
    string? ReflectionNotes,
    string? Findings,
    string? DeliveryAreaKey = null,
    IReadOnlyList<LivVisitRatingRequest>? Ratings = null);
public sealed record SaveLivCaseRequest(
    Guid SubjectStaffId,
    Guid? OrgUnitId,
    string? DeliveryAreaKey,
    string? PreConversation,
    SaveLivVisitRequest? InitialVisit,
    bool? IsElevatePractitioner,
    IReadOnlyList<string>? AreaOfPracticeKeys,
    string? AreaOfPracticeOther,
    IReadOnlyList<Guid>? AreaOfPracticeThemeIds);
public sealed record LivVisitCreatedSummary(Guid Id, int VisitNumber);
public sealed record LivVisitSummary(
    Guid Id,
    int VisitNumber,
    DateOnly? VisitDate,
    string? VisitTime,
    string VisitType,
    string? CourseName,
    string? CourseGroup,
    string? CourseLevel,
    string? ReflectionNotes,
    string? Findings,
    string VisitStatus,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt,
    Guid? CycleId = null,
    IReadOnlyList<LivVisitRatingSummary>? Ratings = null,
    string? DeliveryAreaKey = null,
    string? DeliveryAreaName = null);
public sealed record LivCaseSummary(
    Guid Id,
    Guid RecordId,
    Guid SubjectStaffId,
    string SubjectStaffName,
    Guid? ReviewerStaffId,
    string? ReviewerStaffName,
    Guid? OrgUnitId,
    string? OrgUnitCode,
    string? ParentOrgUnitCode,
    string? PreConversation,
    string Status,
    string CurrentStage,
    string VisibilityStatus,
    DateOnly? CompletionDate,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt,
    bool CanEdit,
    bool CanViewSensitive,
    bool? IsElevatePractitioner,
    IReadOnlyList<string> AreaOfPracticeKeys,
    string? AreaOfPracticeOther,
    IReadOnlyList<Guid> AreaOfPracticeThemeIds,
    IReadOnlyList<LivVisitSummary> Visits,
    string? DeliveryAreaKey = null,
    string? DeliveryAreaName = null,
    Guid? SourceElevateAssessmentId = null,
    string? EliPrimaryFocusKey = null,
    string? EliPrimaryFocus = null,
    string? EliDesiredOutcome = null,
    IReadOnlyList<LivCycleSummary>? Cycles = null,
    string? EliNoticePreferenceKey = null,
    string? EliNoticePreference = null,
    string? EliPreferredVisitMonth = null,
    string? EliSecondaryFocusKey = null,
    string? EliSecondaryFocus = null,
    string? EliSecondaryFocusOther = null,
    Guid? LinkedProbationCaseId = null,
    int? ProbationObservationNumber = null);
public sealed record LivLookupOptionSummary(string Key, string Name, int DisplayOrder, bool IsOther = false);
public sealed record LivConfigurationSummary(
    IReadOnlyList<LivLookupOptionSummary> DeliveryAreas,
    IReadOnlyList<LivLookupOptionSummary> FocusAreas,
    IReadOnlyList<LivLookupOptionSummary> DevelopmentOpportunities,
    IReadOnlyList<ElevatePracticeRatingScaleSummary> Rubric);
public sealed record LivStaffContextSummary(
    Guid StaffId,
    string StaffName,
    Guid? AssessmentId,
    string? AcademicYear,
    string? PrimaryFocusKey,
    string? PrimaryFocus,
    string? DesiredOutcome,
    Guid? ExistingLivRecordId,
    Guid? ExistingLivSourceRecordId,
    string? NoticePreferenceKey = null,
    string? NoticePreference = null,
    string? PreferredVisitMonth = null,
    string? SecondaryFocusKey = null,
    string? SecondaryFocus = null,
    string? SecondaryFocusOther = null);
public sealed record LivVisitRatingRequest(string FocusKey, Guid? DescriptorId, bool IsNotApplicable = false);
public sealed record LivVisitRatingSummary(string FocusKey, string FocusName, Guid? DescriptorId, string? Descriptor, bool IsNotApplicable);
public sealed record SaveLivStageRequest(
    string StageType,
    string? ContextText,
    string? AimsText,
    string? LearnerActivityText,
    string? ReflectionText,
    DateOnly? IntendedFollowUpDate,
    string? DistanceImpactText,
    IReadOnlyList<string>? DevelopmentOpportunityKeys,
    string? StageStatus = null);
public sealed record LivStageCreatedSummary(Guid Id, string StageType, int StageOrder, Guid? VisitId);
public sealed record LivStageSummary(
    Guid Id,
    string StageType,
    int StageOrder,
    string StageStatus,
    string? ContextText,
    string? AimsText,
    string? LearnerActivityText,
    string? ReflectionText,
    DateOnly? IntendedFollowUpDate,
    string? DistanceImpactText,
    IReadOnlyList<string> DevelopmentOpportunityKeys,
    Guid? VisitId,
    bool CanEdit);
public sealed record LivCycleSummary(
    Guid Id,
    int CycleNumber,
    string Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt,
    bool IsFollowUp,
    IReadOnlyList<LivStageSummary> Stages);
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
    string AcademicYear,
    int EvidenceSubmitted,
    int MilestonesCompleted,
    IReadOnlyList<StaffReflectionSummary> Reflections,
    IReadOnlyList<StaffCpdRecordSummary> CpdRecords,
    IReadOnlyList<StaffProfileActionSummary> Actions,
    IReadOnlyList<StaffProfileCoachingSummary> CoachingRecords,
    StaffElevatePracticeSummary? ElevatePractice,
    ElevateStatusSummary ElevateStatus);

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
    IReadOnlyList<StaffReflectionFocusAreaSummary> FocusAreas,
    Guid? CreatedByUserAccountId,
    string? CreatedByName,
    DateTimeOffset CreatedAt,
    Guid? UpdatedByUserAccountId,
    string? UpdatedByName,
    DateTimeOffset? UpdatedAt);

public sealed record StaffReflectionFocusAreaSummary(
    Guid? FocusLookupValueId,
    string FocusKeySnapshot,
    string TextSnapshot,
    string FocusType,
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

public sealed record StaffCpdRecordSummary(Guid Id, Guid RecordId, string Title, DateOnly EventDate, string? Themes, int? DurationMinutes, bool IsInternal);

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
    string? PrimaryFocus,
    string? SpecificSessionFocus);

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
