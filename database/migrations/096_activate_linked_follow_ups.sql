SET XACT_ABORT ON;
GO
-- Links and frozen context only; no review, staff or fixture data is added by this migration.
IF OBJECT_ID(N'quality.process_review_follow_ups',N'U') IS NULL
BEGIN
    CREATE TABLE quality.process_review_follow_ups(
        child_record_id uniqueidentifier NOT NULL REFERENCES quality.process_reviews(record_id),
        parent_record_id uniqueidentifier NOT NULL REFERENCES quality.process_reviews(record_id),
        previous_context_json nvarchar(max) NOT NULL,
        created_by_user_account_id uniqueidentifier NOT NULL REFERENCES auth.user_accounts(id),
        created_at datetimeoffset NOT NULL DEFAULT sysutcdatetime(),
        CONSTRAINT pk_process_review_follow_ups PRIMARY KEY(child_record_id),
        CONSTRAINT uq_process_review_follow_ups_parent UNIQUE(parent_record_id),
        CONSTRAINT ck_process_review_follow_ups_not_self CHECK(child_record_id<>parent_record_id),
        CONSTRAINT ck_process_review_follow_ups_context CHECK(ISJSON(previous_context_json)=1)
    );
END;
GO
