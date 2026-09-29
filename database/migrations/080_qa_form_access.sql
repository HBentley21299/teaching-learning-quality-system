-- Optional per-template QA Staff submission whitelist. Does not change evidence or role grants.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH(N'qa.activity_templates', N'restrict_qa_staff') IS NULL
    ALTER TABLE qa.activity_templates ADD restrict_qa_staff bit NOT NULL
        CONSTRAINT df_qa_activity_templates_restrict_staff DEFAULT (0) WITH VALUES;

IF OBJECT_ID(N'qa.activity_template_staff', N'U') IS NULL
    CREATE TABLE qa.activity_template_staff (
        activity_template_id uniqueidentifier NOT NULL,
        staff_id uniqueidentifier NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_template_staff_created DEFAULT sysutcdatetime(),
        CONSTRAINT pk_qa_activity_template_staff PRIMARY KEY (activity_template_id, staff_id),
        CONSTRAINT fk_qa_template_staff_template FOREIGN KEY (activity_template_id) REFERENCES qa.activity_templates(id),
        CONSTRAINT fk_qa_template_staff_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id)
    );

COMMIT TRANSACTION;
