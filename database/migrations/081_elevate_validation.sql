SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
BEGIN TRANSACTION;
IF COL_LENGTH(N'quality.elevate_practice_assessments', N'validation_status') IS NULL
BEGIN
    ALTER TABLE quality.elevate_practice_assessments ADD
        validation_status nvarchar(20) NOT NULL CONSTRAINT df_eli_validation_status DEFAULT N'draft' WITH VALUES,
        reviewed_by_user_account_id uniqueidentifier NULL,
        reviewed_at datetimeoffset NULL,
        validation_feedback nvarchar(4000) NULL;
END;
COMMIT TRANSACTION;
GO
BEGIN TRANSACTION;
-- Existing submissions await review; nobody is implicitly marked as validated.
UPDATE quality.elevate_practice_assessments SET validation_status=N'pending'
WHERE status=N'submitted' AND validation_status=N'draft';
IF OBJECT_ID(N'quality.ck_eli_validation_status',N'C') IS NULL
    ALTER TABLE quality.elevate_practice_assessments ADD CONSTRAINT ck_eli_validation_status
        CHECK (validation_status IN (N'draft',N'pending',N'returned',N'validated'));
IF OBJECT_ID(N'quality.elevate_practice_validation_events',N'U') IS NULL
    CREATE TABLE quality.elevate_practice_validation_events (
        id uniqueidentifier NOT NULL CONSTRAINT pk_eli_validation_events PRIMARY KEY DEFAULT newsequentialid(),
        assessment_id uniqueidentifier NOT NULL REFERENCES quality.elevate_practice_assessments(id),
        action nvarchar(40) NOT NULL,
        note nvarchar(4000) NULL,
        actor_user_account_id uniqueidentifier NULL REFERENCES auth.user_accounts(id),
        created_at datetimeoffset NOT NULL CONSTRAINT df_eli_validation_event_created DEFAULT sysutcdatetime()
    );
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'quality.elevate_practice_validation_events') AND name=N'ix_eli_validation_history')
    CREATE INDEX ix_eli_validation_history ON quality.elevate_practice_validation_events(assessment_id,created_at);
INSERT auth.permissions(permission_key,name,description,category,is_system)
SELECT N'elevate_practice.validate',N'Validate Elevate self-assessments',N'Review and validate staff self-assessments within assigned staff scope.',N'Elevate Learning and Innovation',1
WHERE NOT EXISTS(SELECT 1 FROM auth.permissions WHERE permission_key=N'elevate_practice.validate');
INSERT auth.role_permissions(role_id,permission_id)
SELECT role.id,permission.id FROM auth.roles role JOIN auth.permissions permission ON permission.permission_key=N'elevate_practice.validate'
WHERE role.role_key IN(N'programme_leader',N'head_of_faculty',N'director',N'teaching_learning_team',N'super_admin')
AND NOT EXISTS(SELECT 1 FROM auth.role_permissions existing WHERE existing.role_id=role.id AND existing.permission_id=permission.id);
COMMIT TRANSACTION;
