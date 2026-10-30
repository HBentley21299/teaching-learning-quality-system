SET XACT_ABORT ON;
GO
-- Additive workflow change. Existing data, configuration versions and Teams snapshots remain intact.
IF COL_LENGTH(N'quality.process_reviews',N'legacy_configuration_json') IS NULL
    ALTER TABLE quality.process_reviews ADD legacy_configuration_json nvarchar(max) NULL;
IF OBJECT_ID(N'quality.process_review_scopes',N'U') IS NULL
BEGIN
    CREATE TABLE quality.process_review_scopes(
        record_id uniqueidentifier NOT NULL REFERENCES quality.process_reviews(record_id),
        org_unit_id uniqueidentifier NOT NULL REFERENCES org.org_units(id),
        name_snapshot nvarchar(300) NOT NULL,
        parent_org_unit_id_snapshot uniqueidentifier NULL,
        parent_name_snapshot nvarchar(300) NULL,
        org_unit_type_snapshot nvarchar(100) NULL,
        CONSTRAINT pk_process_review_scopes PRIMARY KEY(record_id,org_unit_id)
    );
    CREATE INDEX ix_process_review_scopes_unit ON quality.process_review_scopes(org_unit_id,record_id);
END;
IF OBJECT_ID(N'quality.process_review_participants',N'U') IS NULL
BEGIN
    CREATE TABLE quality.process_review_participants(
        record_id uniqueidentifier NOT NULL REFERENCES quality.process_reviews(record_id),
        staff_id uniqueidentifier NOT NULL REFERENCES people.staff(id),
        display_name_snapshot nvarchar(300) NOT NULL,
        roles_json nvarchar(max) NOT NULL,
        is_locked bit NOT NULL,
        org_unit_names_json nvarchar(max) NOT NULL,
        CONSTRAINT pk_process_review_participants PRIMARY KEY(record_id,staff_id),
        CONSTRAINT ck_process_review_participants_roles CHECK(ISJSON(roles_json)=1 AND ISJSON(org_unit_names_json)=1)
    );
END;
IF COL_LENGTH(N'quality.process_review_actions',N'impact_area_key') IS NULL
    ALTER TABLE quality.process_review_actions ADD impact_area_key nvarchar(100) NULL;
IF COL_LENGTH(N'quality.process_review_actions',N'action_detail') IS NULL
    ALTER TABLE quality.process_review_actions ADD action_detail nvarchar(max) NULL;
IF COL_LENGTH(N'quality.process_review_actions',N'review_date') IS NULL
    ALTER TABLE quality.process_review_actions ADD review_date date NULL;
IF OBJECT_ID(N'quality.process_review_action_assignees',N'U') IS NULL
BEGIN
    CREATE TABLE quality.process_review_action_assignees(
        action_id uniqueidentifier NOT NULL REFERENCES quality.process_review_actions(action_id),
        staff_id uniqueidentifier NOT NULL REFERENCES people.staff(id),
        display_name_snapshot nvarchar(300) NOT NULL,
        CONSTRAINT pk_process_review_action_assignees PRIMARY KEY(action_id,staff_id)
    );
    CREATE INDEX ix_process_review_action_assignees_staff ON quality.process_review_action_assignees(staff_id,action_id);
END;
GO
INSERT INTO quality.process_review_action_assignees(action_id,staff_id,display_name_snapshot)
SELECT action.id,action.owner_staff_id,staff.display_name
FROM quality.process_review_actions metadata JOIN quality.actions action ON action.id=metadata.action_id
JOIN people.staff staff ON staff.id=action.owner_staff_id
WHERE action.source_form_type=N'activate_growth_review' AND NOT EXISTS(
    SELECT 1 FROM quality.process_review_action_assignees existing WHERE existing.action_id=action.id AND existing.staff_id=action.owner_staff_id);
GO
-- Publish a new current configuration rather than revising the configuration pinned to any existing review.
DECLARE @previous nvarchar(max),@version int;
SELECT TOP(1) @previous=configuration_json,@version=version FROM quality.process_review_configurations
WHERE process_key=N'activate_growth_review' ORDER BY version DESC;
IF @previous IS NOT NULL AND JSON_QUERY(@previous,N'$.skillsScanPillars') IS NULL
BEGIN
    DECLARE @pillars nvarchar(max)=N'[
      {"key":"digital_proficiency_productivity","title":"Digital proficiency and productivity","subAreas":[{"key":"digital_proficiency","title":"Digital proficiency"},{"key":"digital_productivity","title":"Digital productivity"}]},
      {"key":"information_data_media_literacies","title":"Information, data and media literacies","subAreas":[{"key":"information_literacy","title":"Information literacy"},{"key":"data_literacy","title":"Data literacy"},{"key":"media_literacy","title":"Media literacy"}]},
      {"key":"digital_creation_problem_solving_innovation","title":"Digital creation, problem solving and innovation","subAreas":[{"key":"digital_creation","title":"Digital creation"},{"key":"problem_solving","title":"Problem solving"},{"key":"digital_innovation","title":"Digital innovation"}]},
      {"key":"digital_communication_collaboration_participation","title":"Digital communication, collaboration and participation","subAreas":[{"key":"digital_communication","title":"Digital communication"},{"key":"digital_collaboration","title":"Digital collaboration"},{"key":"digital_participation","title":"Digital participation"}]},
      {"key":"digital_learning_development","title":"Digital learning and development","subAreas":[{"key":"digital_learning","title":"Digital learning"},{"key":"digital_teaching","title":"Digital teaching"}]},
      {"key":"digital_identity_wellbeing","title":"Digital identity and wellbeing","subAreas":[{"key":"digital_identity_management","title":"Digital identity management"},{"key":"digital_wellbeing","title":"Digital wellbeing"}]}
    ]';
    DECLARE @themes nvarchar(max)=(SELECT [key],title FROM OPENJSON(@previous,N'$.standards') WITH([key] nvarchar(100),title nvarchar(300)) FOR JSON PATH);
    DECLARE @next nvarchar(max)=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@previous,N'$.version',@version+1),N'$.skillsScanPillars',JSON_QUERY(@pillars)),N'$.actionThemes',JSON_QUERY(@themes));
    SET @next=JSON_MODIFY(@next,N'$.settings',JSON_QUERY(N'{"formJourney":"activate_growth_v2"}'));
    SET @next=JSON_MODIFY(@next,N'$.fieldLabels',JSON_QUERY(N'{"meetingMinutes":"Meeting minutes","strengths":"Strengths","development":"Areas for development","recordDate":"Review conducted","followUpDate":"Follow-up review date"}'));
    INSERT INTO quality.process_review_configurations(process_key,version,configuration_json)
    VALUES(N'activate_growth_review',@version+1,@next);
END;
GO
