SET XACT_ABORT ON;
GO

-- Imported source references are durable idempotency keys, separate from form answers.
-- Existing records and configuration are not changed by this migration.
IF OBJECT_ID(N'ops.csv_import_items', N'U') IS NULL
BEGIN
    CREATE TABLE ops.csv_import_items (
        kind varchar(40) NOT NULL,
        source_reference nvarchar(200) NOT NULL,
        payload_sha256 char(64) NOT NULL,
        entity_id uniqueidentifier NOT NULL,
        batch_id uniqueidentifier NOT NULL,
        imported_by_user_account_id uniqueidentifier NOT NULL,
        imported_at datetime2(7) NOT NULL CONSTRAINT df_csv_import_items_at DEFAULT sysutcdatetime(),
        CONSTRAINT pk_csv_import_items PRIMARY KEY (kind, source_reference),
        CONSTRAINT fk_csv_import_items_actor FOREIGN KEY (imported_by_user_account_id) REFERENCES auth.user_accounts(id)
    );
    CREATE INDEX ix_csv_import_items_batch ON ops.csv_import_items(batch_id);
END;
GO
