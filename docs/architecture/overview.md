# Architecture Overview

## Architectural Style

The system is a modular monolith. It is deployed as one web application and one database, but internally divided into stable modules and layers. This keeps the platform maintainable for a 500-staff college without creating premature distributed-system overhead.

## Layers

- Presentation: React and TypeScript web app.
- API: ASP.NET Core REST API under `/api/v1`.
- Application: workflows, validation, permission checks, scope filtering, reporting orchestration.
- Domain: staff, organisation, records, forms, actions, evidence, CPD, reporting.
- Infrastructure: on-campus Microsoft SQL Server, Windows IIS, Microsoft Entra ID, notifications, audit and telemetry.

## Core Platform Engines

- Identity and access engine: user accounts, roles, permissions, scoped access.
- Organisation engine: faculties, departments, teams, and staff membership.
- Record engine: universal attachable records for all modules.
- Form engine: versioned templates, sections, fields, submissions, responses.
- Action engine: one action model across all processes.
- Evidence engine: evidence metadata, files, review status, related records.
- Reporting engine: permission-aware read models and dashboard configuration.
- Messaging engine: versioned templates, approved parameters, durable domain events,
  an idempotent outbox and Microsoft Graph delivery.
- Export engine: scope-aware Excel workbooks and extensible Word record reports.

## Operational Scale

- Staff profile collections are loaded only when their collapsible section opens
  and are paged server-side.
- Interactive exports have a 25,000-row limit per worksheet and always record the
  applied filters and requesting user.
- Domain events and message deliveries use database-backed claims and expiring
  locks, so overlapping application workers cannot send the same event twice.
- Membership describes where a staff member works. Management access comes only
  from explicit scopes, manager relationships or global permissions.

## Non-Negotiables

- New modules must register into the module and record system.
- Server-side queries must enforce permission and scope.
- Template versioning is required for auditability.
- Elevate Status artwork is versioned in SQL Server. General evidence-file uploads require a separately approved college storage and malware-scanning service before they are enabled.
- Staff identity, user account, and Entra identity are separate concepts.
- New notifications must publish a standard domain event; modules must not call
  Microsoft Graph directly.

