param([string]$ServerInstance = '(localdb)\MSSQLLocalDB')

$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '../apps/api/src/TLQS.Api/Data/QaReviewDataStore.cs'
$source = Get-Content -LiteralPath $sourcePath -Raw
$validationMethod = $source.Substring($source.IndexOf('private async Task<QaCloseValidationSummary> GetQaCloseValidationAsync'))
$queryMatch = [regex]::Match($validationMethod, '(?s)SELECT SUM\(CASE WHEN status = N''draft''.*?FROM qa\.evidence_submissions WHERE review_id = @id AND removed_at IS NULL;')
if (-not $queryMatch.Success) { throw 'Could not locate the QA close-validation totals query.' }
$countsQuery = $queryMatch.Value.Replace('qa.evidence_submissions', 'evidence_submissions').Replace('qa.evidence_responses', 'evidence_responses')

# CTE fixtures only: no schema, application data, or database objects are changed.
$fixture = @'
;WITH evidence_submissions AS (
    SELECT * FROM (VALUES
        (1, 1, N'submitted', 3, CAST(NULL AS int)),
        (2, 1, N'draft', 999, NULL),
        (3, 1, N'submitted', 888, 1),
        (4, 2, N'submitted', 5, NULL),
        (5, 3, N'draft', 100, NULL)
    ) AS fixture(record_id, review_id, status, sample_size, removed_at)
), evidence_responses AS (
    SELECT * FROM (VALUES
        (1, N'at'), (1, NULL), (2, N'below'), (2, N'above'),
        (3, N'below'), (4, N'at'), (5, N'below')
    ) AS fixture(evidence_record_id, outcome)
)
'@

$cases = @(
    @{ Review = 1; Expected = '1|1|3|1'; Name = 'Mixed submitted, draft, removed and unrelated evidence' },
    @{ Review = 2; Expected = '0|1|5|1'; Name = 'Submitted evidence without drafts' },
    @{ Review = 3; Expected = '1|0|0|0'; Name = 'Draft-only review has no reporting totals' },
    @{ Review = 4; Expected = 'NULL|0|0|0'; Name = 'Empty review has no reporting totals' }
)
foreach ($case in $cases) {
    $sql = "SET NOCOUNT ON; DECLARE @id int = $($case.Review);`n$fixture`n$countsQuery"
    $output = & sqlcmd -S $ServerInstance -d master -E -b -h -1 -W -s '|' -Q $sql
    if ($LASTEXITCODE -ne 0) { throw "SQL validation failed for $($case.Name): $output" }
    $actual = (($output | Where-Object { $_.Trim() }) -join '').Trim()
    if ($actual -ne $case.Expected) { throw "$($case.Name): expected $($case.Expected), received $actual" }
    Write-Output "PASS: $($case.Name)"
}
