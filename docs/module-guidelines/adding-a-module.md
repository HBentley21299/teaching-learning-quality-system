# Adding A Module

Use this checklist whenever adding a new process such as Observation Management, Peer Review, QIP, Mentoring, Coaching, Annual Review, or Performance Management.

## Required Steps

1. Add a row to `core.modules` with a stable `module_key`.
2. Add permissions for the module using the pattern `<module>.<verb>`.
3. Add navigation and route metadata to the frontend module registry.
4. Store each workflow item as a `core.records` row.
5. Use a dynamic form template unless the process needs stable reportable fields.
6. Attach actions through `quality.actions`.
7. Attach evidence through `evidence.evidence_items` and files through `evidence.file_assets`.
8. Add reporting through read models/views and dashboard widgets.
9. Add audit events for every meaningful create/update/status transition.

## Avoid

- Creating separate action, evidence, file, comment, or notification tables for one module.
- Storing multiple faculty IDs in one text field.
- Using staff names as keys.
- Changing old form submissions when a template changes.

