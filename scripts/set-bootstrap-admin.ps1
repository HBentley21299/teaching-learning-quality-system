param(
    [Parameter(Mandatory = $true)][string] $Server,
    [Parameter(Mandatory = $true)][string] $Database,
    [Parameter(Mandatory = $true)][string] $Email,
    [Parameter(Mandatory = $true)][Guid] $TenantId,
    [Parameter(Mandatory = $true)][Guid] $ObjectId,
    [string] $SqlCmd = "sqlcmd"
)

$ErrorActionPreference = "Stop"
if ($null -eq (Get-Command $SqlCmd -ErrorAction SilentlyContinue)) {
    throw "sqlcmd was not found. Install Microsoft SQL Server command line tools."
}
try { [void][System.Net.Mail.MailAddress]::new($Email) }
catch { throw "Bootstrap administrator email is not valid." }
$escapedEmail = $Email.Trim().Replace("'", "''")

$query = @"
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @UserAccountId uniqueidentifier = (
    SELECT account.id
    FROM auth.user_accounts account
    JOIN people.staff staff ON staff.id = account.staff_id
    WHERE LOWER(staff.email) = LOWER(N'$escapedEmail')
      AND staff.archived_at IS NULL AND staff.account_status = N'active'
      AND account.archived_at IS NULL AND account.account_status = N'active'
      AND account.is_disabled = 0
);
IF @UserAccountId IS NULL
    THROW 50002, 'The bootstrap administrator email does not match an active staff account.', 1;
IF EXISTS (
    SELECT 1 FROM auth.auth_identities
    WHERE provider = N'entra' AND tenant_id = '$TenantId'
      AND provider_subject_id = N'$ObjectId' AND user_account_id <> @UserAccountId
)
    THROW 50003, 'The Microsoft Entra identity is already linked to another account.', 1;
IF EXISTS (
    SELECT 1 FROM auth.auth_identities
    WHERE provider = N'entra' AND tenant_id = '$TenantId'
      AND provider_subject_id = N'$ObjectId' AND user_account_id = @UserAccountId
)
    UPDATE auth.auth_identities
       SET email_claim = N'$escapedEmail', updated_at = sysutcdatetime(), archived_at = NULL
     WHERE provider = N'entra' AND tenant_id = '$TenantId'
       AND provider_subject_id = N'$ObjectId' AND user_account_id = @UserAccountId;
ELSE
    INSERT INTO auth.auth_identities (user_account_id, provider, tenant_id, provider_subject_id, email_claim)
    VALUES (@UserAccountId, N'entra', '$TenantId', N'$ObjectId', N'$escapedEmail');
IF NOT EXISTS (
    SELECT 1 FROM auth.user_roles user_role
    JOIN auth.roles role ON role.id = user_role.role_id
    WHERE user_role.user_account_id = @UserAccountId AND role.role_key = N'super_admin'
      AND user_role.active_from <= sysutcdatetime()
      AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
)
    INSERT INTO auth.user_roles (user_account_id, role_id, assignment_source)
    SELECT @UserAccountId, id, N'deployment_bootstrap'
    FROM auth.roles WHERE role_key = N'super_admin' AND archived_at IS NULL;
IF NOT EXISTS (
    SELECT 1 FROM auth.access_scopes
    WHERE user_account_id = @UserAccountId AND scope_type = N'global'
      AND is_active = 1 AND archived_at IS NULL
)
    INSERT INTO auth.access_scopes (user_account_id, scope_type, assignment_source)
    VALUES (@UserAccountId, N'global', N'deployment_bootstrap');
INSERT INTO ops.audit_logs (user_account_id, entity_name, action, summary)
VALUES (@UserAccountId, N'deployment', N'deployment.bootstrap_admin_confirmed',
        N'Bootstrap administrator identity and access confirmed during deployment.');
COMMIT TRANSACTION;
"@

& $SqlCmd -S $Server -d $Database -E -b -Q $query
if ($LASTEXITCODE -ne 0) { throw "Bootstrap administrator configuration failed with exit code $LASTEXITCODE." }
Write-Host "Bootstrap administrator confirmed: $Email" -ForegroundColor Green
