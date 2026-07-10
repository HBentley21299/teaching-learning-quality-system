# Architecture Overview

## Architectural Style

The system is a modular monolith. It is deployed as one web application and one database, but internally divided into stable modules and layers. This keeps the platform maintainable for a 500-staff college without creating premature distributed-system overhead.

## Layers

- Presentation: React and TypeScript web app.
- API: ASP.NET Core REST API under `/api/v1`.
- Application: workflows, validation, permission checks, scope filtering, reporting orchestration.
- Domain: staff, organisation, records, forms, actions, evidence, CPD, reporting.
- Infrastructure: Azure SQL, Blob Storage, Entra ID, Key Vault, notifications, audit, telemetry.

## Core Platform Engines

- Identity and access engine: user accounts, roles, permissions, scoped access.
- Organisation engine: faculties, departments, teams, and staff membership.
- Record engine: universal attachable records for all modules.
- Form engine: versioned templates, sections, fields, submissions, responses.
- Action engine: one action model across all processes.
- Evidence engine: evidence metadata, files, review status, related records.
- Reporting engine: permission-aware read models and dashboard configuration.

## Non-Negotiables

- New modules must register into the module and record system.
- Server-side queries must enforce permission and scope.
- Template versioning is required for auditability.
- Files live in Blob Storage; the database stores metadata and relationships.
- Staff identity, user account, and Entra identity are separate concepts.

