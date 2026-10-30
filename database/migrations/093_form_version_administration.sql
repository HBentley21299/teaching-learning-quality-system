SET XACT_ABORT ON;
GO
-- Version names and descriptions are published with their questions. Existing
-- versions continue to use their template's name until explicitly revised.
IF COL_LENGTH('forms.form_template_versions', 'display_name') IS NULL
    ALTER TABLE forms.form_template_versions ADD display_name nvarchar(250) NULL;
IF COL_LENGTH('forms.form_template_versions', 'description') IS NULL
    ALTER TABLE forms.form_template_versions ADD description nvarchar(1000) NULL;
GO
IF OBJECT_ID('forms.workflow_content', 'U') IS NULL
BEGIN
    CREATE TABLE forms.workflow_content(
        form_key nvarchar(50) NOT NULL CONSTRAINT pk_workflow_content PRIMARY KEY,
        content_json nvarchar(max) NOT NULL,
        updated_at datetimeoffset NOT NULL CONSTRAINT df_workflow_content_updated DEFAULT sysutcdatetime(),
        row_version rowversion NOT NULL,
        CONSTRAINT ck_workflow_content_json CHECK(ISJSON(content_json)=1)
    );
END;
GO
