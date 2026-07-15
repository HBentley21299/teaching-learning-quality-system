param(
    [Parameter(Mandatory = $true)]
    [string] $SourceDirectory,

    [Parameter(Mandatory = $true)]
    [string] $DestinationPath
)

$ErrorActionPreference = "Stop"

$source = [System.IO.Path]::GetFullPath($SourceDirectory).TrimEnd("\", "/")
$destination = [System.IO.Path]::GetFullPath($DestinationPath)

if (!(Test-Path -LiteralPath $source -PathType Container)) {
    throw "Package source directory was not found: $source"
}
if ($destination.StartsWith("$source\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The deployment package cannot be written inside its source directory."
}

$files = @(Get-ChildItem -LiteralPath $source -Recurse -File)
if ($files.Count -eq 0) {
    throw "Package source directory is empty: $source"
}

$destinationDirectory = Split-Path -Parent $destination
if (!(Test-Path -LiteralPath $destinationDirectory -PathType Container)) {
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
}
if (Test-Path -LiteralPath $destination) {
    Remove-Item -LiteralPath $destination -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$stream = [System.IO.File]::Open($destination, [System.IO.FileMode]::CreateNew)
try {
    $archive = New-Object System.IO.Compression.ZipArchive(
        $stream,
        [System.IO.Compression.ZipArchiveMode]::Create,
        $false
    )
    try {
        foreach ($file in $files) {
            $entryName = $file.FullName.Substring($source.Length + 1).Replace("\", "/")
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                $file.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    $stream.Dispose()
}

Write-Host "Deployment package: $destination"
