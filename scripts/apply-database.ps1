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
    # Demo dataset (dummy staff, roles, scopes and learning walk records for
    # permission validation). Remove these lines when provisioning a real environment.
    (Join-Path -Path $root -ChildPath "database\seed\002_seed_demo.sql"),
    (Join-Path -Path $root -ChildPath "database\seed\003_seed_learning_walks.sql")
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
