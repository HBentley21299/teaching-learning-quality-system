# Permissions audit — 29 September 2026

Implementation update: the accepted administration, consistency and rate-limiter work has now been implemented in the worktree. The findings below record the pre-fix audit evidence. Integrated verification and migration application are tracked by the main task; do not interpret the earlier 160-test run as validation of the new changes.

- Role allocation, custom-tier construction, access scope and indirect organisation grants now require a live active **system Administrator** role. A custom capability or client-supplied flag cannot stand in for that role. Account creation and reactivation are also protected; ordinary permitted detail maintenance remains available.
- Account creation/update/archive and organisation grants share a transaction-owned SQL application lock. Self-lockout and last-active-administrator invariants cover role, status, disable and archive paths.
- Migration `089_account_administration_guards.sql` adds an administrative revision counter and access-change triggers. Account edits carry both this version and the staff row version. Login timestamps do not cause false edit conflicts. The migration also excludes retired roles in SQL visibility functions; the API and legacy resolver apply the same retirement filter.
- Directorate-managed roles are included in account display/protection. The affected admin UI sends revision tokens, disables unauthorised allocation and explains Administrator-only access changes.
- Authentication precedes request rate limiting; validated identity and tenant partition authenticated requests, while unauthenticated traffic uses address-based protection. A real loopback pipeline regression test covers colleagues sharing an address.
- New fast policy tests and an opt-in isolated SQL database-boundary test cover live Administrator authority, forged/stale flags, retired roles, final-admin checks, application locking and stale revisions. The SQL test creates a uniquely named scratch database and drops it; it does not mutate the college database.

Focused implementation verification: the updated backend built successfully and **17/17 tests passed, with zero skips**, including the opted-in LocalDB database-boundary test (`AccountAdministration*`, `RequestRateLimitIdentity*`, `AuthenticatedRateLimiterPipeline*`). The first scratch database creation timed out before schema setup; a retry with a 120-second creation allowance passed in one second and removed the scratch database. The application database was not changed by these tests. TypeScript `tsc --noEmit -p tsconfig.json` also passed after admin guard/modal changes.

The SQL visibility hardening preserves each installed function's inline or multi-statement shape and existing scope logic, adding only role retirement filters. This avoids changing the query-performance shape found in the current local database. Migration application remains the main task's responsibility.

Admin editors now register real unsaved changes with the shared navigation guard, including embedded settings, account maintenance, permissions, form layout, managed lists, QA question/scale/access configuration, dashboard faculties and organisation structure. Ordinary saves support Save/Discard/Stay; operations needing an explicit choice or impact acknowledgement remain in their editor. Organisation dialogs use native modal focus handling and guarded Close/Cancel/Escape. Browser interaction checks remain part of integrated verification.

The QA draft/privacy, whitelist and validation-scope decisions below have not been changed by this implementation.

## Scope and evidence

Read-only audit of the current worktree: authentication mapping, API permission gates, staff/organisation scope, permission administration, custom tiers, directorates, QA evidence/whitelists/drafts, ELI validation, CPD and staff archive. No accounts, roles, records or settings were changed. This is source and existing-test evidence, not a claim that the deployed college system or every role has been exercised live.

Existing focused tests were run using:

```powershell
dotnet test tests/access-control/TLQS.AccessControl.Tests.csproj --no-build --filter "FullyQualifiedName~PolicyTests|FullyQualifiedName~PermissionKeysTests|FullyQualifiedName~OrganisationLeadershipRulesTests" --logger "console;verbosity=minimal"
```

Result: **160 passed, 0 failed, 0 skipped**. The existing test assembly was built on 29 September at 10:33; the inspected policy sources/tests predate it. These are mostly policy unit tests with synthetic current users. They do not prove the SQL scope functions, HTTP endpoint integration, concurrent administration or production identity configuration. No rebuild or API restart was performed for this audit.

## Confirmed defects to prioritise

### P1 — Account administrators can allocate privileges they do not hold

`apps/api/src/TLQS.Api/V1/FoundationEndpoints.cs:1756` gates account updates with `users.manage` only. `SqlFoundationDataStore.cs:6327` passes requested role keys to `ReplaceUserRolesAsync` at line 6874. That helper resolves any active role and adds it; it neither receives the acting user nor checks the role's capabilities against that user. Account creation at `FoundationEndpoints.cs:1732` and `SqlFoundationDataStore.cs:6134` uses the same allocation path.

The staff-access UI deliberately enables allocation for `users.manage` and lists every returned role (`apps/web/src/routes/PermissionsAdmin.tsx:27`, `:108`). Consequently a delegated custom tier with account management can allocate `super_admin` to itself or another account. Mandatory CPD's reserved capability can also be reached through allocating a built-in privileged role. This is a confirmed source path; no privilege escalation was attempted.

**Recommendation to accept/reject:** separate account maintenance from access allocation; require explicit allocation authority and enforce a server-side grant ceiling on both creation and update. Protect built-in administrator/T&L roles separately where necessary. The custom-tier construction ceiling (`CustomRoleAdminDataStore.cs:40`, `CustomRolePolicy.cs:5`) does not close this allocation route. Add API/database tests with a delegated account administrator before treating custom tiers as safely delegable.

### P1 — Final-administrator and self-lockout safeguards do not cover account status changes

`SqlFoundationDataStore.cs:6192` prevents `isDisabled=true` for the acting user's account. The final-active-admin guard at `:6298` runs only when removing `super_admin` from the requested role list. The same method accepts `accountStatus` changes and writes them at `:6260`; setting an administrator to inactive/leaver does not trigger either guard. It also permits disabling another last active administrator when roles are unchanged.

This is exposed by normal UI: `apps/web/src/routes/AdminCentre.tsx:637` offers the account-status select even for self, whereas the enable/disable checkbox at `:656` is disabled for self. Changing own status to inactive blocks subsequent database account resolution (`SqlFoundationDataStore.cs:77`). The archive operation has a stronger separate serializable guard (`StaffArchiveDataStore.cs:25`, `:65`), but the ordinary update bypass remains.

**Recommendation:** apply one transactional “at least one active administrator remains” rule to all role, archive, disable and status mutations, and prevent own status from becoming unusable. Add concurrent tests so two administrators cannot each disable the other after both read an initially safe state.

### P2 — Directorate-managed roles are omitted from account protection

Directorate management correctly projects the `director` role (`database/migrations/086_directorate_hierarchy.sql:237`). However, the account listing's `IsOrganisationManaged` CASE at `SqlFoundationDataStore.cs:5889` and the role replacement protection CASE at `:6938` only map faculty/head_of_faculty and team/programme_leader.

The director role therefore appears manually editable rather than “Managed through Organisation structure”; an ordinary account-role edit can end it even while the directorate assignment remains active. A later organisation projection rebuild can restore it, giving inconsistent access and confusing administrators.

**Recommendation:** include directorate/director in both paths, preferably sharing one mapping, and regression-test the listing plus save behaviour for all three organisation levels.

### P2 — Deactivating a role does not consistently revoke its effective permissions

`SqlFoundationDataStore.cs:7122` loads permissions through user_roles → role_permissions → permissions, without joining `auth.roles` or checking its `is_active`/`archived_at`. The staff visibility function has the same omission (`database/migrations/037_scope_hardening_and_domain_events.sql:39`). QA's form-whitelist role detection does check active/nonarchived roles (`QaFormAccessDataStore.cs:133`).

A role made inactive/archived while its assignments remain active can continue granting general API permissions while no longer being recognised by the QA whitelist logic. The current custom-tier editor does not expose archive/deactivate, so this is a latent lifecycle defect rather than an observed production incident.

**Recommendation:** make effective-permission queries consistently exclude inactive/archived roles; establish a single role retirement process that also ends assignments, and test it through the actual permission resolver and SQL visibility functions.

### P2 — Staff access saves can overwrite another administrator's changes

`UpdateAdminUserRequest` (`FoundationEndpoints.cs:2554`) has no row version. The update reads current assignments then replaces the entire supplied role/scope selection (`SqlFoundationDataStore.cs:6233`, `:6327`, `:6332`). Two administrators editing the same account can silently undo one another's changes. The newer custom-tier editor and QA whitelist already use row versions, highlighting the difference.

**Recommendation:** add optimistic concurrency to account and access allocation edits, return a useful conflict message, and show the newly saved roles/scopes before retrying. Keep this separate from the final-administrator transaction guard.

## Policy decisions for Harry

1. **Should a QA draft be private to its author?** Drafts are excluded from submitted evidence dashboards and exports (`QaReviewDataStore.cs:932`, `:1230`). However, evidence listing/detail uses the same view-all or team/contributor scope for drafts and submissions (`:675`, `:1119`); there is no author-only draft read clause. Editing another person's evidence requires correction permission (`:550`). The present behaviour lets authorised colleagues read in-scope unfinished drafts. Suggest private-to-author drafts, with an explicit QA administrator exception, if staff expect privacy. This is a policy decision, not evidence of dashboard contamination.

2. **Should whitelists constrain every custom submission tier or only QA Staff?** The implemented, tested rule deliberately narrows the named QA Staff role and preserves existing report access (`QaFormAccessPolicy.cs:5`). A separate tier carrying `qa_reviews.submit_all` bypasses that restriction (`QaFormAccessDataStore.cs:141`); people without QA Staff are not constrained by its whitelist. This matches the earlier QA-Staff-only requirement but needs to be explained when granting custom tiers. Suggest an effective-access preview explaining the bypass, or a deliberate switch to a per-user/form rule if desired.

3. **Should college-wide report access also expand validation scope?** Validation requires `elevate_practice.validate` (or record administration), blocks self-validation and enforces submitted/pending state. The assigned-scope check delegates to generic profile visibility (`ElevateValidationDataStore.cs:13`; `SqlFoundationDataStore.cs:5340`). That visibility is college-wide for `reports.view_all`, `staff.manage`, `users.manage` or global scope (`037_scope_hardening_and_domain_events.sql:59`). Thus someone combining validation permission and college-wide viewing can validate anyone except themselves. Suggest a dedicated validation/management scope if programme leaders should validate only their own hierarchy even when they hold broad reporting access.

4. **Should administrators preview the result of combined roles before saving?** The UI displays combined capabilities and scopes, but no explanation for why a person can access a particular colleague, record or QA form. Suggest “Why can this person access this?” showing role, hierarchy, explicit scope and whitelist decisions. This would make additive roles and college-wide exceptions easier to administer without changing the rules.

5. **How should live custom-tier edits be governed?** Updating a custom tier immediately changes all assigned users. The UI warns of that (`PermissionsAdmin.tsx:118`) and the database records before/after plus row-version conflict protection (`CustomRoleAdminDataStore.cs:46`). Suggest showing affected users and a capability diff before saving. A second approval is an optional college governance choice, not currently required by the implementation.

## Controls present and verification limits

| Area | Current evidence | What remains unproven |
|---|---|---|
| Authentication | API groups require authorization; production uses Entra JWT with configured tenant/audience; development/local authentication is Development-only (`Program.cs:132`, `:171`; `FoundationEndpoints.cs:14`). Active/disabled/archive checks happen in the API's SQL resolver. | Live college Entra settings, token issuer configuration and deployed build parity were not inspected. The older EF PermissionService is not the API's current request resolver. |
| Organisation scope | `org.fn_visible_staff` combines self, explicit scope, recursive primary management and global permissions; ordinary staff membership alone does not grant reporting access. Directorate projection extends manager chains and scopes. | Need database-backed tests for unrelated faculties, moved faculties, directors, secondary managers and stale assignments. Policy helper tests cannot establish SQL isolation. |
| Navigation | Frontend route permissions and admin sections mostly reflect endpoint categories (`app/navigation.ts`, `app/adminNavigation.ts`). Work Scrutiny corrections explicitly require both record and user administration because of dependent endpoints. | Custom capabilities can be assembled without their page dependencies: QA management without hub-view permissions can administer configuration but not open the review hub. A capability dependency/compatibility preview would improve this. |
| QA authoring | Save checks form access, each team's review scope, open/reopened status, authorship/correction rights and concurrency; submitted changes require an audit reason (`QaReviewDataStore.cs:496`). | No new cross-account HTTP mutation tests were run; draft privacy and whitelist exceptions are decisions above. |
| ELI validation | Tests cover permission, self-denial, linked identity, pending/submitted state, required return feedback and content-save reset. Database path checks row version, records reviewer/note/history, and resets validation after edited content. | Effective scope inherits global visibility; end-to-end validation with different real role combinations was not rerun here. |
| CPD | Mandatory template access is separately gated on definition/create/update/complete paths; only `cpd_core` contributes Elevate credit (`FoundationEndpoints.cs:1876`; `SqlFoundationDataStore.cs:4681`, `:4955`, `:5167`, `:8464`). Existing tests cover mandatory/external exclusion. | Built-in tier allocation can bypass the intended grant ceiling until the P1 allocation issue is addressed. |
| Archive/restore | Archive ends roles, scopes, memberships, management assignments; protects self and final active Admin; writes audit. Restore deliberately stays disabled (`StaffArchiveDataStore.cs:104`). UI explicitly explains reallocation/re-enabling (`AdminStaffDetails.tsx:161`). | Ordinary disable/status changes do not share archive's invariant, as above. No account was archived/restored in this audit. |
| Export access | Export routes require export permission plus module/view rights; filters and datasets are scoped downstream (`PlatformOperationsEndpoints.cs:470`). Existing export tests validate filter/data semantics. | Synthetic export tests are not a substitute for HTTP tests proving denial of another faculty's records and download identifiers. |

## Suggested acceptance order

Accept the two P1 administration safeguards before allocating account-management capabilities to additional custom tiers. Then align directorate protection and role retirement, and add concurrency to staff-access changes. Separately decide draft privacy and validation scope; both alter who can see or review records and should be agreed before implementation.

The smallest useful verification addition is a database-backed access matrix covering staff/self, programme leader, director, QA Staff with/without whitelist, report-only user, delegated account administrator and full administrator. Include negative reads/edits/export requests and archive/status transitions; retain the existing fast policy tests as a separate layer.
