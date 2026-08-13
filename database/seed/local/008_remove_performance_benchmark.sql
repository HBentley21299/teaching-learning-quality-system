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

BEGIN TRANSACTION;

DELETE FROM quality.action_extensions
WHERE action_id IN (SELECT id FROM quality.actions WHERE LEFT(title, LEN(@marker)) = @marker);

DELETE FROM quality.actions WHERE LEFT(title, LEN(@marker)) = @marker;
DELETE FROM core.records WHERE LEFT(title, LEN(@marker)) = @marker;

COMMIT TRANSACTION;

PRINT 'The local performance fixture was removed.';
