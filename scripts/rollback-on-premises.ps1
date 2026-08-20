param(
    [string] $SettingsPath = "",
    [Parameter(Mandatory = $true)][string] $ReleasePath
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if ([string]::IsNullOrWhiteSpace($SettingsPath)) { $SettingsPath = Join-Path $root "deployment.settings.psd1" }
if (!(Test-Path -LiteralPath $SettingsPath -PathType Leaf)) { throw "Deployment settings were not found." }
$settings = Import-PowerShellDataFile -LiteralPath $SettingsPath
$installRoot = [System.IO.Path]::GetFullPath([string]$settings.InstallRoot).TrimEnd("\", "/")
$target = [System.IO.Path]::GetFullPath($ReleasePath).TrimEnd("\", "/")
if (!$target.StartsWith("$installRoot\releases\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "ReleasePath must be a retained release inside '$installRoot\releases'."
}
if (!(Test-Path -LiteralPath $target -PathType Container)) { throw "Release directory was not found at '$target'." }

Import-Module WebAdministration -ErrorAction Stop
$sitePath = "IIS:\Sites\$($settings.SiteName)"
$current = [string](Get-ItemProperty $sitePath -Name physicalPath).physicalPath
try {
    Stop-WebAppPool -Name ([string]$settings.AppPoolName) -ErrorAction SilentlyContinue
    Set-ItemProperty $sitePath -Name physicalPath -Value $target
    Start-WebAppPool -Name ([string]$settings.AppPoolName)
    $healthUrl = "$(([string]$settings.ApplicationUrl).TrimEnd('/'))/health/ready"
    $deadline = (Get-Date).AddMinutes(3)
    $healthy = $false
    do {
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 10
            if ($health.status -eq "healthy" -and $health.database -eq "connected") {
                $healthy = $true
                break
            }
        }
        catch { Start-Sleep -Seconds 5 }
    } while ((Get-Date) -lt $deadline)
    if (!$healthy) { throw "The selected release did not become healthy." }
    Write-Host "Rollback healthy: $target" -ForegroundColor Green
}
catch {
    Stop-WebAppPool -Name ([string]$settings.AppPoolName) -ErrorAction SilentlyContinue
    Set-ItemProperty $sitePath -Name physicalPath -Value $current
    Start-WebAppPool -Name ([string]$settings.AppPoolName)
    throw "Rollback failed; IIS was returned to '$current'. $($_.Exception.Message)"
}
