$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root "apps\web"

Push-Location $web
try {
    if (!(Test-Path "node_modules")) {
        npm.cmd install --cache .\.npm-cache
    }

    npm.cmd run dev
}
finally {
    Pop-Location
}
