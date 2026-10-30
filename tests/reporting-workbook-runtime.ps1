param(
    [string]$BaseUrl = 'http://127.0.0.1:5001/api/v1',
    [string]$AcademicYear = '2026/27',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '../.localappdata/local-run/dashboard-smoke/workbooks'),
    [string]$AssemblyDirectory = (Join-Path $PSScriptRoot '../apps/api/src/TLQS.Api/bin/DashboardSmoke/net10.0'),
    [string[]]$Modules = @('dashboard-overview','elevate-status','actions','cpd','coaching','liv','als-liv','elevate-practice','learning-walks','als-learning-walks','work-scrutiny','elevate-environments','probation','uco-tla-reviews')
)
# Exercises actual Excel endpoints and validates their OpenXML and business-facing worksheet structure.
# Export endpoints write their normal audit entries; no form/staff/fixture data or settings are changed.
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
foreach ($assembly in @('System.IO.Packaging.dll','DocumentFormat.OpenXml.Framework.dll','DocumentFormat.OpenXml.dll')) {
    Add-Type -Path (Join-Path $AssemblyDirectory $assembly)
}
$validator = [DocumentFormat.OpenXml.Validation.OpenXmlValidator]::new()
$year = [uri]::EscapeDataString($AcademicYear)
$results = foreach ($module in $Modules) {
    $path = Join-Path $OutputDirectory "$module.xlsx"
    $started = Get-Date
    Invoke-WebRequest "$BaseUrl/exports/excel/${module}?academicYear=$year" -OutFile $path -TimeoutSec 180
    $document = [DocumentFormat.OpenXml.Packaging.SpreadsheetDocument]::Open($path, $false)
    try {
        $errors = @($validator.Validate($document))
        if ($errors.Count) { throw "Workbook $module failed OpenXML validation: $($errors[0].Description)" }
    }
    finally { $document.Dispose() }
    $archive = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        function Read-ZipXml([string]$name) {
            $reader = [IO.StreamReader]::new($archive.GetEntry($name).Open())
            try { [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
        }
        $workbook = Read-ZipXml 'xl/workbook.xml'
        $sheets = @($workbook.workbook.sheets.sheet)
        if ($sheets[0].name -ne 'Form entries') { throw "Workbook $module does not open on Form entries." }
        $maximumColumns = 0; $primaryRows = 0
        foreach ($entry in @($archive.Entries | Where-Object FullName -Match '^xl/worksheets/sheet\d+\.xml$')) {
            $sheet = Read-ZipXml $entry.FullName
            $namespace = [Xml.XmlNamespaceManager]::new($sheet.NameTable)
            $namespace.AddNamespace('s','http://schemas.openxmlformats.org/spreadsheetml/2006/main')
            $headings = @($sheet.SelectNodes('/s:worksheet/s:sheetData/s:row[1]/s:c/s:is/s:t',$namespace) | ForEach-Object InnerText)
            if (@($headings | Group-Object | Where-Object Count -gt 1).Count) { throw "Workbook $module has duplicated headings." }
            if (@($headings | Where-Object { $_ -match '(^| - )(Record ID|Staff ID|LIV case ID|Submission ID|Observation ID|Row version|Visibility|Visible to staff|Can edit|Can view)$' }).Count) {
                throw "Workbook $module exposes an internal identifier or control column."
            }
            if (!$sheet.SelectSingleNode('/s:worksheet/s:autoFilter',$namespace)) { throw "Workbook $module has an unfilterable worksheet." }
            if (!$sheet.SelectSingleNode('/s:worksheet/s:sheetViews/s:sheetView/s:pane[@state="frozen"]',$namespace)) { throw "Workbook $module has an unfrozen header." }
            if ($entry.FullName -eq 'xl/worksheets/sheet1.xml') { $primaryRows = @($sheet.SelectNodes('/s:worksheet/s:sheetData/s:row',$namespace)).Count - 1 }
            $maximumColumns = [math]::Max($maximumColumns, $headings.Count)
        }
        [pscustomobject]@{ Module=$module; Entries=$primaryRows; Sheets=$sheets.Count; MaximumColumns=$maximumColumns; OpenXml='Valid'; Seconds=[math]::Round(((Get-Date)-$started).TotalSeconds,2) }
    }
    finally { $archive.Dispose() }
}
$results | Format-Table -AutoSize
