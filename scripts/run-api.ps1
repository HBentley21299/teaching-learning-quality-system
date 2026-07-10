$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root "apps\api\src\TLQS.Api\TLQS.Api.csproj"

$env:ASPNETCORE_ENVIRONMENT = "Development"
$env:APPDATA = Join-Path $root ".appdata"
$env:LOCALAPPDATA = Join-Path $root ".localappdata"
$env:NUGET_PACKAGES = Join-Path $root ".nuget\packages"
dotnet run --no-restore --project $project --urls "http://127.0.0.1:5001"
