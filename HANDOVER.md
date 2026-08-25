# i-Elevate handover

This file is the repository-level handover index. Keep live credentials, personal
data, production database exports and recovery keys in approved college systems,
not in this repository.

## Handover deliverables

Provide all of the following together:

1. A private, college-owned GitHub repository containing full Git history.
2. A tagged release with the Linux deployment ZIP, `release.json`, `manifest.json`
   and SHA-256 checksum.
3. An accepted copy of the production readiness checklist.
4. A controlled operational record containing Azure, Entra, DNS, support and
   recovery ownership details.
5. A separately protected database recovery procedure and evidence of a restore test.

The repository is the authoritative source. A ZIP on its own is not a maintainable
handover because it omits history, build inputs and infrastructure definitions.

## Current handover state

Update this section immediately before formal transfer.

| Area | State at 25 August 2026 |
| --- | --- |
| Source | Azure-ready code is present; commit and tag this handover cleanup before transfer |
| Azure | Production resource group exists but contains no active resources |
| Cost | No application hosting or database service has been provisioned |
| Entra | API and browser registrations exist; final redirect URI remains outstanding |
| Consent | Tenant-wide administrator consent remains outstanding |
| Release | Linux Azure package can be reproduced with `new-azure-release.ps1` |
| Go-live | Blocked until provisioning, consent, production URL and acceptance checks |

Client IDs, tenant/subscription identifiers and named account owners should be
recorded in the controlled operational record. They are identifiers rather than
passwords, but keeping environment-specific values out of general documentation
reduces accidental disclosure and stale configuration.

## Required ownership register

Record a primary and deputy for each responsibility:

| Responsibility | Minimum authority |
| --- | --- |
| GitHub repository | Organisation owner/repository administrator |
| Application releases | Maintainer with protected-branch approval rights |
| Azure platform | Subscription/resource-group owner or delegated platform team |
| Microsoft Entra | Application administrator and tenant consent administrator |
| Azure SQL | Entra SQL administrator and recovery deputy |
| Information governance | Approved data owner |
| Service support | Monitored service desk and escalation owner |
| Product acceptance | Teaching and Learning product owner |

Avoid a single-person dependency. At least two permanent college staff should be
able to administer the repository and recover the service.

## Repository transfer checklist

- [ ] Transfer the repository from any personal account to the approved college organisation.
- [ ] Confirm the repository is private and remove obsolete collaborators.
- [ ] Protect `main`; require pull-request review and successful CI.
- [ ] Enable dependency alerts and the organisation's approved secret-scanning controls.
- [ ] Configure the four non-secret Entra build variables used by release workflows:
      `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_SPA_CLIENT_ID` and
      `ENTRA_API_SCOPE`.
- [ ] Store deployment credentials only in the approved secret store.
- [ ] Create an annotated handover tag and attach the verified release files.
- [ ] Record the release tag and checksum in the change record.

## Build and release

The reproducible Azure release command is:

```powershell
.\scripts\new-azure-release.ps1 `
  -EntraTenantId <tenant-guid> `
  -EntraApiAudience <api-client-guid> `
  -EntraSpaClientId <spa-client-guid> `
  -EntraApiScope 'api://<api-client-guid>/access_as_user'
```

The **Build Azure release** workflow performs the same verification and packaging
without provisioning or deploying Azure resources. Release artifacts remain ignored
locally and must be attached deliberately to the approved GitHub Release.

## Documentation map

- [Project overview and local development](README.md)
- [Production deployment entry point](DEPLOYMENT-START-HERE.md)
- [Azure infrastructure and deployment](infrastructure/azure/README.md)
- [Production readiness checklist](docs/deployment/v1-readiness.md)
- [Architecture overview](docs/architecture/overview.md)
- [Permissions decisions](docs/architecture/relationships-permissions-decisions.md)
- [Data model](docs/data-model/entity-relationships.md)
- [Messaging and exports](docs/deployment/messaging-and-exports.md)
- [On-premises contingency reference](docs/deployment/on-premises-operations.md)

## Known technical notes

- The production web build succeeds. Its current main entry chunk is approximately
  502 kB minified (139 kB gzip), which triggers Vite's non-blocking 500 kB warning.
  Add further route/vendor code splitting before the entry bundle grows materially.
- Database migrations are forward-only. Application rollback must never be treated
  as permission to reverse an applied migration manually.
- General evidence-file uploads remain out of scope until storage policy, access
  control, malware scanning and retention have been approved.
- Messaging is deliberately disabled by the Azure template until its sender,
  credentials, test recipient and operational owner are approved.

## Items that must never be committed

- completed deployment parameter or settings files;
- passwords, client secrets, tokens, certificates or private keys;
- production database backups or exports;
- staff evidence, reports or screenshots containing personal data;
- generated release ZIPs, build output, logs, caches or local databases.
