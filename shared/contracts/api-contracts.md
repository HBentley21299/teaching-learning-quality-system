# API Contract Principles

- REST endpoints are versioned under `/api/v1`.
- Every write endpoint requires authentication, permission, and scope checks.
- List endpoints return paged results.
- IDs are GUIDs in API payloads.
- Human-readable codes are exposed as secondary fields for imports and display.
- Form submissions always reference a template version.
- File uploads return metadata records and never expose storage secrets directly.

## Endpoint Groups

- `/api/v1/me`
- `/api/v1/staff`
- `/api/v1/org-units`
- `/api/v1/users`
- `/api/v1/roles`
- `/api/v1/permissions`
- `/api/v1/lookups`
- `/api/v1/modules`
- `/api/v1/records`
- `/api/v1/form-templates`
- `/api/v1/form-submissions`
- `/api/v1/activities`
- `/api/v1/learning-walks`
- `/api/v1/work-scrutiny`
- `/api/v1/cpd-events`
- `/api/v1/evidence`
- `/api/v1/actions`
- `/api/v1/files`
- `/api/v1/reports`
- `/api/v1/audit`

