# Relationships And Permissions Decisions

## Confirmed Structure

The organisation hierarchy is:

```text
College
Faculty
Faculty child code
Individual staff member
```

The database continues to model this through `org.org_units` with parent-child relationships, rather than hard-coding separate tables for each level. This keeps the model expandable if the college later adds campuses, curriculum areas, temporary project teams, or cross-college groups.

## Staff Relationships

- Staff normally belong to one primary faculty child code.
- Directors may belong to more than one faculty or child code.
- Each staff member has one line manager.
- Multiple staff-to-organisation links are still supported through `org.staff_org_memberships`, but business rules should restrict multi-membership to directors unless an administrator deliberately overrides it.

## Visibility Rules

Staff profile visibility:

- Staff can see their own staff record.
- Teaching & Learning can see staff records.
- Administrators can see staff records.
- Managers do not automatically receive full staff-profile visibility unless a specific future permission is added.

Learning Walk and Work Scrutiny visibility:

- Teaching & Learning can see all records.
- Administrators can see all records.
- Managers can see records in their assigned scope.
- Assigned reviewers can see records assigned to them.

Action visibility:

- Actions are always visible to the staff member who owns the action.
- Actions are always visible to the staff member who is the subject of the action.
- Teaching & Learning and administrators can see all actions.
- Managers can see actions in their assigned scope.

Edit rules:

- Administrators can edit any form or record.
- Teaching & Learning can edit any form or record.
- The person who created or owns a record can edit their own record.
- Completed-form locking should be implemented in the form workflow layer, not by removing database access.

Assigned reviewer rule:

- Assigned reviewer access is represented by `owner_staff_id` on records and actions.
- A reviewer can see work assigned to them even when they are outside the subject staff member's normal management line.

## Implementation Notes

- The API must enforce these rules server-side.
- Frontend hiding is treated as usability only, never as security.
- Scope filtering must include child organisation units so a faculty-level scope automatically includes faculty child codes.
- The form builder should use these rules before allowing template editing, submission editing, or completed-form edits.
