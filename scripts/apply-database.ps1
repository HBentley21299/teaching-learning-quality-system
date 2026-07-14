param(
    [Parameter(Mandatory = $true)]
    [string] $Server,

    [Parameter(Mandatory = $true)]
    [string] $Database,

    [string] $SqlCmd = "sqlcmd",

    [string[]] $SqlCmdOptions = @()
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

if ($null -eq (Get-Command $SqlCmd -ErrorAction SilentlyContinue)) {
    throw "sqlcmd was not found. Install SQL Server command line tools or pass -SqlCmd with the full path."
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
    (Join-Path -Path $root -ChildPath "database\seed\005_seed_official_curriculum_staff.sql")
)

foreach ($script in $scripts) {
    if (!(Test-Path $script)) {
        throw "Missing SQL script: $script"
    }

    Write-Host "Applying $script"
    $arguments = @("-S", $Server, "-d", $Database, "-E", "-b") + $SqlCmdOptions + @("-i", $script)
    Invoke-Native -FilePath $SqlCmd -Arguments $arguments
}

Write-Host "Database scripts applied."
