SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF COL_LENGTH(N'ops.domain_events', N'processing_at') IS NULL
    ALTER TABLE ops.domain_events ADD processing_at datetimeoffset NULL;
GO

IF COL_LENGTH(N'ops.domain_events', N'locked_until') IS NULL
    ALTER TABLE ops.domain_events ADD locked_until datetimeoffset NULL;
GO

IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'ops.domain_events')
      AND name = N'ix_domain_events_pending'
)
    DROP INDEX ix_domain_events_pending ON ops.domain_events;
GO

CREATE INDEX ix_domain_events_pending ON ops.domain_events(processed_at, locked_until, occurred_at)
    INCLUDE (event_type, aggregate_type, aggregate_id, source_record_id, attempt_count);
GO
