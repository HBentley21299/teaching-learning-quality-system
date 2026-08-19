param(
    [Parameter(Mandatory = $true)]
    [string] $Server,

    [Parameter(Mandatory = $true)]
    [string] $Database,

    [string] $SqlCmd = "sqlcmd",

    [string[]] $SqlCmdOptions = @(),

    [switch] $UseAzureAuthentication,

    [switch] $ExcludeOfficialStaffData,

    [switch] $BaselineExistingDatabase
)

$ErrorActionPreference = "Stop"

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [string] $FilePath,

        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE."
    }
}

$azureAccessToken = $null
if ($UseAzureAuthentication) {
    if ($null -eq (Get-Command "az" -ErrorAction SilentlyContinue)) {
        throw "Azure CLI was not found. Install it and run 'az login' before applying an Azure database."
    }
    if ($null -eq (Get-Command "Invoke-Sqlcmd" -ErrorAction SilentlyContinue)) {
        try {
            Import-Module SqlServer -ErrorAction Stop
        }
        catch {
            throw "The SqlServer PowerShell module is required for token-based Azure SQL migrations. Install it with 'Install-Module SqlServer -Scope CurrentUser'."
        }
    }
    $azureAccessToken = ((@(& az account get-access-token `
        --resource "https://database.windows.net/" `
        --query accessToken `
        --output tsv) -join "").Trim())
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($azureAccessToken)) {
        throw "Azure CLI could not acquire an Azure SQL access token. Run 'az login' and try again."
    }
}
elseif ($null -eq (Get-Command $SqlCmd -ErrorAction SilentlyContinue)) {
    throw "sqlcmd was not found. Install SQL Server command line tools or pass -SqlCmd with the full path."
}

function Invoke-DatabaseQuery {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Query
    )

    if ($UseAzureAuthentication) {
        return @(Invoke-Sqlcmd `
            -ServerInstance $Server `
            -Database $Database `
            -AccessToken $azureAccessToken `
            -Query $Query `
            -AbortOnError `
            -ErrorAction Stop)
    }

    $arguments = @("-S", $Server, "-d", $Database, "-E", "-b", "-h", "-1", "-W") +
        $SqlCmdOptions + @("-Q", $Query)
    $output = @(& $SqlCmd @arguments)
    if ($LASTEXITCODE -ne 0) {
        throw "$SqlCmd failed with exit code $LASTEXITCODE."
    }
    return $output
}

function Get-ScalarValue {
    param([object[]] $Rows)

    if ($null -eq $Rows -or $Rows.Count -eq 0) {
        return $null
    }
    $first = $Rows[0]
    if ($first -is [System.Data.DataRow]) {
        return [string]$first[0]
    }
    return ([string]$first).Trim()
}

$root = Split-Path -Parent $PSScriptRoot
$scripts = @(
    (Join-Path -Path $root -ChildPath "database\migrations\001_foundation.sql"),
    (Join-Path -Path $root -ChildPath "database\seed\001_seed_foundation.sql"),
    (Join-Path -Path $root -ChildPath "database\views\001_reporting_views.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\002_form_template_admin.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\003_learning_walk_brief.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\004_workflows_liv_actions.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\005_staff_profiles_admin.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\006_official_org_structure.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\007_elevate_learning_environments.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\008_work_scrutiny_reframe.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\009_staff_onboarding_and_role_hierarchy.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\010_cpd_theme_and_participant_controls.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\011_elevate_your_practice.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\012_remove_sustainable_resource_area.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\013_coaching_and_mentoring.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\014_elevate_practice_rubric_and_admin.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\015_staff_reflections.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\016_learning_walk_themes_and_actions.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\017_liv_cases_and_visits.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\018_learning_environment_catalogues.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\019_coaching_configuration_and_action_extensions.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\020_central_action_engine.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\021_my_team.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\022_organisation_admin_and_shared_governance.sql"),
    (Join-Path -Path $root -ChildPath "database\seed\004_seed_elevate_rooms.sql"),
    (Join-Path -Path $root -ChildPath "database\seed\005_seed_official_curriculum_staff.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\023_org_unit_management.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\024_trusted_self_onboarding.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\025_learning_environment_central_actions.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\026_cpd_self_log_and_duration.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\027_elevate_learning_innovation_and_liv_cycles.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\028_eli_statement_ratings_and_liv_visit_delivery.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\029_staff_reflection_liv_focus_links.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\030_coaching_cycle_workflow_refactor.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\031_probationary_observations.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\032_probation_liv_link_uniqueness.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\033_academic_years_and_elevate_status.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\034_staff_profile_query_indexes.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\035_rename_liv.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\036_scalable_operations_and_org_alignment.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\037_scope_hardening_and_domain_events.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\038_domain_event_dispatch.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\039_staff_profile_summary_performance.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\040_learning_walk_practice_observed_rubric.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\041_elevate_learning_environment_audit_rubric.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\042_messaging_transport_configuration.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\043_learning_walk_focus_rubrics.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\044_action_themes_and_standardised_forms.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\045_configurable_action_themes.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\046_register_action_theme_admin_lists.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\047_probation_unobserved_rubric_areas.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\048_eli_streamlined_statements.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\049_eli_unicode_punctuation.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\050_liv_visit_detail_configuration.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\051_leadership_dashboard_configuration.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\052_teaching_and_learning_language.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\053_liv_focus_and_record_editing.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\054_liv_focus_stable_keys.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\055_teaching_and_learning_label_consistency.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\056_local_test_credentials.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\057_local_credentials_by_email.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\058_elevate_status_badge_assets.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\059_reporting_performance_indexes.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\060_als_liv_and_learning_walks.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\061_als_liv_source_uniqueness.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\062_als_liv_practitioner_catalogue.sql"),
    (Join-Path -Path $root -ChildPath "database\migrations\063_scope_function_inlining.sql")
)

if ($ExcludeOfficialStaffData) {
    $scripts = @($scripts | Where-Object {
        [System.IO.Path]::GetFileName($_) -ne "005_seed_official_curriculum_staff.sql"
    })
    Write-Host "Official curriculum staff seed excluded from this deployment."
}

foreach ($script in $scripts) {
    if (!(Test-Path $script)) {
        throw "Missing SQL script: $script"
    }
}

$ledgerSql = @"
IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.schema_migrations (
        migration_key nvarchar(260) NOT NULL CONSTRAINT pk_schema_migrations PRIMARY KEY,
        checksum_sha256 char(64) NOT NULL,
        applied_at datetimeoffset(0) NOT NULL CONSTRAINT df_schema_migrations_applied_at DEFAULT sysutcdatetime()
    );
END;
"@
Invoke-DatabaseQuery -Query $ledgerSql | Out-Null

function Get-NormalizedMigrationChecksum {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    # Git may materialise SQL files with CRLF on Windows and LF in deployment.
    # Hash a canonical UTF-8/LF representation so line endings alone never make
    # an already-applied migration appear to have changed.
    $content = [System.IO.File]::ReadAllText($LiteralPath)
    $content = $content.Replace("`r`n", "`n").Replace("`r", "`n")
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($content)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

if ($BaselineExistingDatabase) {
    $ledgerCount = Get-ScalarValue @(Invoke-DatabaseQuery -Query "SET NOCOUNT ON; SELECT COUNT_BIG(*) FROM dbo.schema_migrations;")
    $hasFinalSchema = Get-ScalarValue @(Invoke-DatabaseQuery -Query "SET NOCOUNT ON; SELECT CASE WHEN OBJECT_ID(N'org.org_unit_leaderships', N'U') IS NULL THEN 0 ELSE 1 END;")
    if ([long]$ledgerCount -ne 0) {
        throw "Cannot baseline a database that already contains migration history."
    }
    if ([int]$hasFinalSchema -ne 1) {
        throw "Cannot baseline because the database does not contain the final V1 organisation schema."
    }

    $baselineCutoff = "023_org_unit_management.sql"
    $baselineScripts = @()
    foreach ($script in $scripts) {
        $baselineScripts += $script
        if ([System.IO.Path]::GetFileName($script) -eq $baselineCutoff) {
            break
        }
    }
    if ($baselineScripts.Count -eq 0 -or [System.IO.Path]::GetFileName($baselineScripts[-1]) -ne $baselineCutoff) {
        throw "The baseline cutoff migration '$baselineCutoff' was not found."
    }

    foreach ($script in $baselineScripts) {
        $migrationKey = $script.Substring($root.Length).TrimStart("\", "/").Replace("\", "/")
        $checksum = Get-NormalizedMigrationChecksum -LiteralPath $script
        $escapedKey = $migrationKey.Replace("'", "''")
        Invoke-DatabaseQuery -Query "INSERT dbo.schema_migrations (migration_key, checksum_sha256) VALUES (N'$escapedKey', '$checksum');" | Out-Null
    }
    Write-Host "Existing V1 database baselined through $baselineCutoff with $($baselineScripts.Count) migration entries."
}

foreach ($script in $scripts) {
    $migrationKey = $script.Substring($root.Length).TrimStart("\", "/").Replace("\", "/")
    $checksum = Get-NormalizedMigrationChecksum -LiteralPath $script
    $rawChecksum = (Get-FileHash -LiteralPath $script -Algorithm SHA256).Hash.ToLowerInvariant()
    $escapedKey = $migrationKey.Replace("'", "''")
    $appliedChecksum = Get-ScalarValue @(Invoke-DatabaseQuery -Query "SET NOCOUNT ON; SELECT checksum_sha256 FROM dbo.schema_migrations WHERE migration_key = N'$escapedKey';")
    if (![string]::IsNullOrWhiteSpace($appliedChecksum)) {
        if ($appliedChecksum -ne $checksum -and $appliedChecksum -ne $rawChecksum) {
            throw "Applied migration '$migrationKey' has changed. Add a new forward-only migration instead of editing migration history."
        }
        Write-Host "Skipping already applied $migrationKey"
        continue
    }

    Write-Host "Applying $migrationKey"
    if ($UseAzureAuthentication) {
        Invoke-Sqlcmd `
            -ServerInstance $Server `
            -Database $Database `
            -AccessToken $azureAccessToken `
            -InputFile $script `
            -AbortOnError `
            -ErrorAction Stop
    }
    else {
        $arguments = @("-S", $Server, "-d", $Database, "-E", "-b") + $SqlCmdOptions + @("-i", $script)
        Invoke-Native -FilePath $SqlCmd -Arguments $arguments
    }
    Invoke-DatabaseQuery -Query "INSERT dbo.schema_migrations (migration_key, checksum_sha256) VALUES (N'$escapedKey', '$checksum');" | Out-Null
}

Write-Host "Database scripts applied."
