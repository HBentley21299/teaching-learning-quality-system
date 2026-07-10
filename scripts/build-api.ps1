$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root "apps\api\src\TLQS.Api\TLQS.Api.csproj"
$nugetConfig = Join-Path $root "NuGet.Config"
$env:NUGET_PACKAGES = Join-Path $root ".nuget\packages"
$env:APPDATA = Join-Path $root ".appdata"

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

Invoke-Native -FilePath "dotnet" -Arguments @("restore", $project, "--configfile", $nugetConfig, "--ignore-failed-sources")
Invoke-Native -FilePath "dotnet" -Arguments @("build", $project, "--configuration", "Release", "--no-restore")
