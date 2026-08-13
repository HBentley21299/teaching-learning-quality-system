SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @marker nvarchar(80) = N'[PERFORMANCE BENCHMARK]';
DECLARE @recordsPerYear int = 2000;

IF EXISTS (SELECT 1 FROM core.records WHERE LEFT(title, LEN(@marker)) = @marker)
BEGIN
    PRINT 'The local performance fixture already exists.';
    RETURN;
END;

DECLARE @moduleId uniqueidentifier = (
    SELECT id FROM core.modules WHERE module_key = N'learning_walks' AND archived_at IS NULL
);
DECLARE @accountId uniqueidentifier = (
    SELECT TOP (1) account.id
    FROM auth.user_accounts account
    JOIN people.staff staff ON staff.id = account.staff_id
    WHERE staff.email = N'harryjbentley@outlook.com'
      AND account.archived_at IS NULL
      AND staff.archived_at IS NULL
);
DECLARE @staffId uniqueidentifier = (SELECT staff_id FROM auth.user_accounts WHERE id = @accountId);
DECLARE @orgUnitId uniqueidentifier = (
    SELECT TOP (1) id FROM org.org_units
    WHERE archived_at IS NULL AND is_active = 1 AND parent_org_unit_id IS NOT NULL
    ORDER BY code
);
DECLARE @openStatusId uniqueidentifier = (
    SELECT value.id
    FROM core.lookup_values value
    JOIN core.lookup_types type ON type.id = value.lookup_type_id
    WHERE type.lookup_key = N'action_status' AND value.value_key = N'open'
);

IF @moduleId IS NULL OR @accountId IS NULL OR @staffId IS NULL OR @openStatusId IS NULL
    THROW 51000, 'The local performance fixture requires the local administrator and foundation lookup data.', 1;

CREATE TABLE #fixture (
    sequence_number int NOT NULL PRIMARY KEY,
    record_id uniqueidentifier NOT NULL,
    academic_year_key nvarchar(7) NOT NULL,
    record_date date NOT NULL
);

;WITH numbers AS (
    SELECT TOP (@recordsPerYear * 3)
           ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS sequence_number
    FROM sys.all_objects first_set
    CROSS JOIN sys.all_objects second_set
)
INSERT #fixture (sequence_number, record_id, academic_year_key, record_date)
SELECT sequence_number,
       NEWID(),
       CASE
           WHEN sequence_number <= @recordsPerYear THEN N'2024/25'
           WHEN sequence_number <= @recordsPerYear * 2 THEN N'2025/26'
           ELSE N'2026/27'
       END,
       DATEADD(day, (sequence_number - 1) % 330,
           CASE
               WHEN sequence_number <= @recordsPerYear THEN CONVERT(date, '2024-08-01')
               WHEN sequence_number <= @recordsPerYear * 2 THEN CONVERT(date, '2025-08-01')
               ELSE CONVERT(date, '2026-08-01')
           END)
FROM numbers;

BEGIN TRANSACTION;

INSERT core.records (
    id, module_id, record_type, title, summary, subject_staff_id, owner_staff_id,
    org_unit_id, record_date, created_by_user_account_id, created_at, academic_year_key
)
SELECT record_id, @moduleId, N'learning_walk',
       CONCAT(@marker, N' record ', sequence_number),
       N'Removable local record used only for repeatable performance measurement.',
       @staffId, @staffId, @orgUnitId, record_date, @accountId,
       TODATETIMEOFFSET(CONVERT(datetime2, record_date), '+00:00'), academic_year_key
FROM #fixture;

INSERT quality.actions (
    id, source_record_id, subject_staff_id, owner_staff_id, title, detail,
    action_theme, status_lookup_value_id, due_date, published_to_staff,
    created_by_user_account_id, created_at, source_form_type,
    original_due_date, visibility_setting, progress_status
)
SELECT NEWID(), record_id, @staffId, @staffId,
       CONCAT(@marker, N' action ', sequence_number),
       N'Removable local action used only for repeatable performance measurement.',
       N'Performance benchmark', @openStatusId, DATEADD(day, 30, record_date), 1,
       @accountId, TODATETIMEOFFSET(CONVERT(datetime2, record_date), '+00:00'),
       N'learning_walk', DATEADD(day, 30, record_date), N'staff_and_management', N'not_started'
FROM #fixture;

COMMIT TRANSACTION;

SELECT academic_year_key, COUNT_BIG(*) record_count
FROM core.records
WHERE LEFT(title, LEN(@marker)) = @marker
GROUP BY academic_year_key
ORDER BY academic_year_key;
