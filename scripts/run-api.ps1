$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root "apps\api\src\TLQS.Api\TLQS.Api.csproj"

$env:ASPNETCORE_ENVIRONMENT = "Development"
$env:NUGET_PACKAGES = Join-Path $root ".nuget\packages"
dotnet run --project $project --urls "http://127.0.0.1:5001"
