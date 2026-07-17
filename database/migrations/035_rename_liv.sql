SET XACT_ABORT ON;
GO

UPDATE core.modules
SET name = N'Learning and Innovation Visits',
    updated_at = sysutcdatetime()
WHERE module_key = N'liv'
  AND name <> N'Learning and Innovation Visits';
GO
