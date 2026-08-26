# College Linux container deployment

This is the production reference for running i-Elevate as one Linux container
with its Microsoft SQL Server database hosted separately on OC-DB. SQL Server is
not included in the image. The college infrastructure and DBA teams remain
responsible for the host, reverse proxy, database, certificates, secrets,
backups, monitoring and recovery.

## Deployment shape

- The root `Dockerfile` builds the React interface and ASP.NET Core API into one
  immutable Linux image.
- Kestrel listens on unencrypted HTTP port `8080` inside the host. Nginx, Apache
  or the college load balancer terminates HTTPS and forwards traffic to it.
- Microsoft Entra ID authenticates staff. The browser and API must use the same
  final HTTPS host name.
- OC-DB remains external. Database migrations are deliberately not run when the
  container starts.
- ASP.NET Core Data Protection keys use a persistent, access-controlled volume.

IIS is not used in this layout because IIS is a Windows component.

## Prerequisites

Confirm all of the following with the infrastructure and DBA teams:

1. A supported Docker Engine or Podman installation is available on the Linux
   host and its security updates are managed by the college.
2. The host can resolve and reach OC-DB on the approved SQL port.
3. OC-DB runs Microsoft SQL Server 2017 or later and the application database
   uses compatibility level 140 or later.
4. The OC-DB TLS certificate is trusted by the container and matches the server
   name used in the connection string.
5. The final DNS name, HTTPS certificate and Microsoft Entra redirect URI have
   been approved.
6. The Microsoft Entra API permission has tenant-wide administrator consent.
7. A production database has been created and migrations have been applied from
   an approved administration workstation using `scripts/apply-database.ps1`.

## Build the image

The three Vite settings are public application identifiers, not passwords. Vite
embeds them in the browser bundle, so a change requires a new image build.

Run from the repository root, replacing the placeholders with the approved
Microsoft Entra values:

```bash
docker build \
  --build-arg VITE_ENTRA_CLIENT_ID="<SPA-application-client-ID>" \
  --build-arg VITE_ENTRA_TENANT_ID="<college-tenant-ID>" \
  --build-arg VITE_ENTRA_API_SCOPE="api://<API-application-client-ID>/access_as_user" \
  --tag ielevate:<release-version> \
  .
```

Build only from a reviewed, clean Git tag. Record the Git commit and immutable
image digest in the change record. Never pass database passwords, client secrets
or certificates as Docker build arguments.

## Runtime configuration

Provide runtime settings through the college's container secret/configuration
service. If an environment file is the only approved option, store it outside
the repository, make it root-owned and restrict it to mode `0600`.

Required settings are:

```text
ConnectionStrings__TlqsDatabase=Server=tcp:<OC-DB-name>,1433;Database=<database>;User ID=<runtime-user>;Password=<secret>;Encrypt=True;TrustServerCertificate=False;MultipleActiveResultSets=True
Authentication__TenantId=<college-tenant-ID>
Authentication__Audience=<API-application-client-ID>
Authentication__AllowDevelopmentUser=false
AllowedHosts=<final-application-hostname>
Messaging__Enabled=false
```

Do not commit the completed values. The SQL runtime identity requires only
`db_datareader`, `db_datawriter` and `EXECUTE`. Use a separate, controlled
deployment identity for migrations. If the college requires Windows-integrated
SQL authentication from Linux, the infrastructure and DBA teams must configure
Kerberos, a service principal and a protected keytab; do not improvise this in a
connection string.

## First run

Create one persistent key volume and retain it across every upgrade:

```bash
docker volume create ielevate-keys

docker run --detach \
  --name ielevate \
  --restart unless-stopped \
  --publish 127.0.0.1:8080:8080 \
  --env-file /etc/ielevate/ielevate.env \
  --mount source=ielevate-keys,target=/var/lib/ielevate/keys \
  ielevate:<release-version>
```

The example binds only to loopback so staff cannot bypass the HTTPS reverse
proxy. Protect and back up the `ielevate-keys` volume. On Linux, file-system Data
Protection keys are not DPAPI-encrypted; the host/volume therefore needs the
college's approved encryption-at-rest and access controls.

Configure the reverse proxy to preserve the original host and supply:

```text
X-Forwarded-For: <client/proxy chain>
X-Forwarded-Proto: https
Host: <original host>
```

The public application must be HTTPS-only. Do not publish Kestrel port `8080`
directly to the staff network.

## Validation and operation

After every release:

1. Confirm `docker ps` reports the container as healthy.
2. Confirm `https://<final-host>/health/live` and `/health/ready` return HTTP 200.
3. Sign in through Microsoft Entra and test Tutor, Programme Leader, Head of
   Faculty, Director, Teaching and Learning, QA Staff and Admin access boundaries.
4. Complete one permission-scoped workflow and export before opening access to
   the pilot group.
5. Confirm application logs are collected without access tokens or form text.
6. Confirm OC-DB backups and restore testing are active.

The image health check calls `/health/ready`, which verifies database access.
Application logs are written to standard output/error for the college logging
agent to collect.

## Upgrade and rollback

Apply forward-only database migrations after verifying a restorable OC-DB backup
and before switching to an image that requires them. Keep the previous signed
image available. Replace the container with the new immutable tag while reusing
the same key volume and runtime configuration.

Application rollback is performed by starting the previous image. Database
migrations are not automatically reversed; the DBA must follow the agreed
recovery plan if a database restore is required. Never run local fixture, reset
or demo-data scripts against OC-DB.
