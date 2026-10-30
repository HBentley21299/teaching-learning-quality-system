param([string]$BaseUrl='http://127.0.0.1:5001/api/v1')
# Preview-only integration checks. Never applies an import or changes business data.
$ErrorActionPreference='Stop'
$user=Invoke-RestMethod "$BaseUrl/me"
if (!$user.isAdministrator) { throw 'Run these checks only as the local development administrator.' }
$reference='PREVIEW-'+[guid]::NewGuid().ToString('N')
$definitions=@{}
foreach ($kind in @('qa-questions','cpd-events','managed-list-values')) {
    $definition=Invoke-RestMethod "$BaseUrl/admin/csv-imports/$kind"
    if ($definition.kind -ne $kind -or !$definition.columns.Count) { throw "Missing metadata for $kind." }
    $template=Invoke-WebRequest "$BaseUrl/admin/csv-imports/$kind/template" -UseBasicParsing
    if ($template.StatusCode -ne 200) { throw "Missing template for $kind." }
    $definitions[$kind]=$definition
}
$activity=$definitions['qa-questions'].references[0].rows[0][0]
$theme=$definitions['cpd-events'].references[0].rows[0][0]
$cases=@{
    'qa-questions'="question_reference,activity_key,question_text`r`n$reference,$activity,CSV preview only $reference"
    'cpd-events'="event_reference,academic_year,cpd_type,title,event_date_time,duration_minutes,delivery_mode,theme_keys,participant_email`r`n$reference,2026/27,internal,CSV preview only $reference,2026-10-01T14:00,90,Online,$theme,$($user.email)"
    'managed-list-values'="lookup_key,value_key,display_name`r`ncpd_theme,preview_$($reference.ToLowerInvariant().Replace('-','_')),CSV preview only $reference"
}
foreach ($kind in $cases.Keys) {
    $body=@{csv=$cases[$kind]}|ConvertTo-Json
    $preview=Invoke-RestMethod "$BaseUrl/admin/csv-imports/$kind/preview" -Method Post -ContentType 'application/json' -Body $body
    if (!$preview.canImport -or $preview.createCount -ne 1 -or !$preview.previewToken -or @($preview.issues|Where-Object severity -eq 'error').Count) {
        $preview|ConvertTo-Json -Depth 10|Write-Output
        throw "Valid $kind preview failed."
    }
    [pscustomobject]@{Kind=$kind;Rows=$preview.rowsRead;NewEntries=$preview.createCount;Outcome='Preview passed; not applied'}
}
$invalid=Invoke-RestMethod "$BaseUrl/admin/csv-imports/qa-questions/preview" -Method Post -ContentType 'application/json' -Body (@{csv="question_reference,activity_key,question_text`ninvalid,unknown_activity,Preview"}|ConvertTo-Json)
if ($invalid.canImport -or $invalid.previewToken -or !@($invalid.issues|Where-Object severity -eq 'error').Count) { throw 'Invalid activity received an import token.' }
try {
    $null=Invoke-RestMethod "$BaseUrl/admin/csv-imports/qa-questions/apply" -Method Post -ContentType 'application/json' -Body (@{csv=$cases['qa-questions'];previewToken='not-a-preview-token'}|ConvertTo-Json)
    throw 'An invalid preview token was accepted.'
} catch {
    if ([int]$_.Exception.Response.StatusCode -ne 400) { throw }
}
Write-Output 'PASS: metadata/templates, three valid previews, invalid activity and invalid-token rejection; no imports applied.'
