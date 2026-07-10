param(
    [string] $PackageId = "Microsoft.Data.SqlClient",
    [string] $Version = "7.0.2"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$feed = Join-Path $root ".nuget-feed"
$temp = Join-Path $root ".tmp\nuget-feed"

New-Item -ItemType Directory -Force -Path $feed, $temp | Out-Null

if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required to seed the local NuGet feed because Windows Schannel is blocking dotnet/curl downloads in this environment."
}

$seen = @{}

function Convert-VersionRangeToMinimum {
    param([string] $VersionRange)

    if ([string]::IsNullOrWhiteSpace($VersionRange)) {
        return $null
    }

    $clean = $VersionRange.Trim().TrimStart("[", "(").TrimEnd("]", ")")
    $first = ($clean -split ",")[0].Trim()
    if ([string]::IsNullOrWhiteSpace($first)) {
        return $null
    }

    return $first
}

function Get-DependencyGroups {
    param([xml] $Nuspec)

    $dependencies = $Nuspec.package.metadata.dependencies
    if ($null -eq $dependencies) {
        return @()
    }

    if ($null -ne $dependencies.group) {
        return @($dependencies.group)
    }

    return @($dependencies)
}

function Get-TargetScore {
    param($Group)

    $target = "$($Group.targetFramework)".ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($target)) { return 10 }
    if ($target -match "net9\.0") { return 100 }
    if ($target -match "net8\.0") { return 95 }
    if ($target -match "net7\.0") { return 90 }
    if ($target -match "net6\.0") { return 85 }
    if ($target -match "netstandard2\.1") { return 80 }
    if ($target -match "netstandard2\.0") { return 75 }
    if ($target -match "\.netstandard2\.0") { return 75 }
    return 0
}

function Get-BestDependencyGroup {
    param([xml] $Nuspec)

    $groups = Get-DependencyGroups -Nuspec $Nuspec
    if ($groups.Count -eq 0) {
        return $null
    }

    return $groups | Sort-Object { Get-TargetScore $_ } -Descending | Select-Object -First 1
}

function Invoke-NodeDownload {
    param(
        [string] $Url,
        [string] $OutputPath
    )

    $script = @"
const fs = require('fs');
const url = process.argv[1];
const output = process.argv[2];
fetch(url)
  .then(response => {
    if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
    return response.arrayBuffer();
  })
  .then(buffer => fs.writeFileSync(output, Buffer.from(buffer)))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
"@

    node -e $script $Url $OutputPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to download $Url"
    }
}

function Save-Package {
    param(
        [string] $Id,
        [string] $PackageVersion
    )

    $lowerId = $Id.ToLowerInvariant()
    $lowerVersion = $PackageVersion.ToLowerInvariant()
    $key = "$lowerId/$lowerVersion"

    if ($seen.ContainsKey($key)) {
        return
    }

    $seen[$key] = $true
    $nupkg = Join-Path $feed "$lowerId.$lowerVersion.nupkg"
    $extractPath = Join-Path $temp "$lowerId.$lowerVersion"

    if (!(Test-Path -LiteralPath $nupkg)) {
        $url = "https://api.nuget.org/v3-flatcontainer/$lowerId/$lowerVersion/$lowerId.$lowerVersion.nupkg"
        Write-Host "Downloading $Id $PackageVersion"
        Invoke-NodeDownload -Url $url -OutputPath $nupkg
    } else {
        Write-Host "Using cached $Id $PackageVersion"
    }

    if (Test-Path -LiteralPath $extractPath) {
        Remove-Item -LiteralPath $extractPath -Recurse -Force
    }

    New-Item -ItemType Directory -Force -Path $extractPath | Out-Null
    $zipPath = Join-Path $temp "$lowerId.$lowerVersion.zip"
    Copy-Item -LiteralPath $nupkg -Destination $zipPath -Force
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force

    $nuspecPath = Get-ChildItem -LiteralPath $extractPath -Filter "*.nuspec" | Select-Object -First 1
    if ($null -eq $nuspecPath) {
        return
    }

    [xml] $nuspec = Get-Content -LiteralPath $nuspecPath.FullName
    $group = Get-BestDependencyGroup -Nuspec $nuspec
    if ($null -eq $group -or $null -eq $group.dependency) {
        return
    }

    foreach ($dependency in @($group.dependency)) {
        $dependencyVersion = Convert-VersionRangeToMinimum "$($dependency.version)"
        if ($null -ne $dependencyVersion) {
            Save-Package -Id "$($dependency.id)" -PackageVersion $dependencyVersion
        }
    }
}

Save-Package -Id $PackageId -PackageVersion $Version
Write-Host "Local NuGet feed seeded at $feed"
