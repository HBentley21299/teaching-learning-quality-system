param(
    [switch] $SkipInstall,
    [switch] $SkipSecurityAudit,
    [switch] $AllowDirty,
    [ValidateSet("win-x64")]
    [string] $RuntimeIdentifier = "win-x64"
)

$ErrorActionPreference = "Stop"

$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$apiSolution = Join-Path $root "apps\api\TLQS.sln"
$apiProject = Join-Path $root "apps\api\src\TLQS.Api\TLQS.Api.csproj"
$webRoot = Join-Path $root "apps\web"
$artifactRoot = [System.IO.Path]::GetFullPath((Join-Path $root ".artifacts\v1"))
$apiOutput = Join-Path $artifactRoot "api"
$webOutput = Join-Path $artifactRoot "web"
$nugetSource = "https://api.nuget.org/v3/index.json"
$entraBuildSettings = [ordered]@{
    VITE_ENTRA_CLIENT_ID = $env:VITE_ENTRA_CLIENT_ID
    VITE_ENTRA_TENANT_ID = $env:VITE_ENTRA_TENANT_ID
    VITE_ENTRA_API_SCOPE = $env:VITE_ENTRA_API_SCOPE
}
$configuredEntraSettings = @($entraBuildSettings.GetEnumerator() | Where-Object {
    ![string]::IsNullOrWhiteSpace($_.Value)
})
if ($configuredEntraSettings.Count -gt 0 -and $configuredEntraSettings.Count -ne $entraBuildSettings.Count) {
    $missingSettings = @($entraBuildSettings.GetEnumerator() | Where-Object {
        [string]::IsNullOrWhiteSpace($_.Value)
    } | ForEach-Object Key)
    throw "Entra web configuration is incomplete. Missing: $($missingSettings -join ', ')."
}

$gitCommit = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitCommit)) {
    throw "The current Git commit could not be determined."
}
$gitBranch = ((@(& git -C $root branch --show-current) -join "").Trim())
if ([string]::IsNullOrWhiteSpace($gitBranch)) {
    $gitBranch = "detached"
}
$gitChanges = @(& git -C $root status --porcelain)
$isDirty = $gitChanges.Count -gt 0
if ($isDirty -and !$AllowDirty) {
    throw "The working tree has uncommitted changes. Commit them before creating a V1 artifact, or use -AllowDirty for a development-only verification."
}

if (!$artifactRoot.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The artifact directory resolved outside the repository."
}

function Invoke-Step {
    param(
        [string] $Name,
        [scriptblock] $Action
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

if (Test-Path -LiteralPath $artifactRoot) {
    Remove-Item -LiteralPath $artifactRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $apiOutput, $webOutput | Out-Null

Invoke-Step "Restore API dependencies" {
    dotnet restore $apiSolution --source $nugetSource
}

Invoke-Step "Build API in Release mode" {
    dotnet build $apiSolution --configuration Release --no-restore
}

Invoke-Step "Run API and access-control tests" {
    dotnet test $apiSolution --configuration Release --no-build --verbosity minimal
}

if (!$SkipSecurityAudit) {
    Invoke-Step "Audit .NET dependencies" {
        dotnet list $apiSolution package --vulnerable --include-transitive --source $nugetSource
    }
}

if (!$SkipInstall) {
    Invoke-Step "Install locked web dependencies" {
        Push-Location $webRoot
        try {
            npm.cmd ci --cache .npm-cache
        }
        finally {
            Pop-Location
        }
    }
}

if (!$SkipSecurityAudit) {
    Invoke-Step "Audit production web dependencies" {
        Push-Location $webRoot
        try {
            npm.cmd audit --omit=dev --audit-level=high
        }
        finally {
            Pop-Location
        }
    }
}

Invoke-Step "Build the production web application" {
    Push-Location $webRoot
    try {
        npm.cmd run build
    }
    finally {
        Pop-Location
    }
}

Invoke-Step "Publish API artifact" {
    # Production is hosted on Windows IIS. The .NET Hosting Bundle supplies the
    # runtime and ASP.NET Core Module on the server.
    dotnet publish $apiProject --configuration Release --runtime $RuntimeIdentifier --self-contained false --output $apiOutput
}

Get-ChildItem -LiteralPath (Join-Path $webRoot "dist") -Force |
    Copy-Item -Destination $webOutput -Recurse -Force

if ($configuredEntraSettings.Count -eq $entraBuildSettings.Count) {
    $webFiles = @(Get-ChildItem -LiteralPath $webOutput -Recurse -File -Filter "*.js")
    foreach ($setting in $entraBuildSettings.GetEnumerator()) {
        $found = $false
        foreach ($file in $webFiles) {
            $content = [System.IO.File]::ReadAllText($file.FullName)
            if ($content.IndexOf([string] $setting.Value, [System.StringComparison]::Ordinal) -ge 0) {
                $found = $true
                break
            }
        }
        if (!$found) {
            throw "$($setting.Key) was not embedded in the production web artifact."
        }
    }
}

# Production is deployed as one same-origin IIS application. Keep the standalone
# web artifact as well so the frontend can move without changing the data model.
$apiWebRoot = Join-Path $apiOutput "wwwroot"
New-Item -ItemType Directory -Force -Path $apiWebRoot | Out-Null
Get-ChildItem -LiteralPath $webOutput -Force |
    Copy-Item -Destination $apiWebRoot -Recurse -Force

[ordered]@{
    generatedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
    gitCommit = $gitCommit
    gitBranch = $gitBranch
    workingTreeDirty = $isDirty
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifactRoot "release.json") -Encoding utf8

$manifest = Get-ChildItem -LiteralPath $artifactRoot -Recurse -File |
    Sort-Object FullName |
    ForEach-Object {
        $relativePath = $_.FullName.Substring($artifactRoot.Length).TrimStart("\", "/")
        [ordered]@{
            path = $relativePath.Replace("\", "/")
            bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }

$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $artifactRoot "manifest.json") -Encoding utf8

Write-Host ""
Write-Host "V1 verification passed." -ForegroundColor Green
Write-Host "API artifact: $apiOutput"
Write-Host "Web artifact: $webOutput"
Write-Host "Manifest:     $(Join-Path $artifactRoot 'manifest.json')"
