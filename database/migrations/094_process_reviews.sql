SET XACT_ABORT ON;
GO
-- Configuration/catalog data only: no staff, reviews, fixtures or test records.
IF OBJECT_ID(N'quality.process_review_configurations', N'U') IS NULL
BEGIN
    CREATE TABLE quality.process_review_configurations(
        process_key nvarchar(100) NOT NULL,
        version int NOT NULL,
        configuration_json nvarchar(max) NOT NULL,
        created_by_user_account_id uniqueidentifier NULL REFERENCES auth.user_accounts(id),
        created_at datetimeoffset NOT NULL DEFAULT sysutcdatetime(),
        row_version rowversion NOT NULL,
        CONSTRAINT pk_process_review_configurations PRIMARY KEY(process_key,version),
        CONSTRAINT ck_process_review_configurations_json CHECK(ISJSON(configuration_json)=1),
        CONSTRAINT ck_process_review_configurations_key CHECK(process_key IN (N'digital_learning_walk',N'activate_growth_review'))
    );
END;
IF OBJECT_ID(N'quality.process_reviews', N'U') IS NULL
BEGIN
    CREATE TABLE quality.process_reviews(
        record_id uniqueidentifier NOT NULL PRIMARY KEY REFERENCES core.records(id),
        process_key nvarchar(100) NOT NULL,
        configuration_json nvarchar(max) NOT NULL,
        data_json nvarchar(max) NOT NULL,
        faculty_org_unit_id uniqueidentifier NULL REFERENCES org.org_units(id),
        team_org_unit_id uniqueidentifier NULL REFERENCES org.org_units(id),
        status nvarchar(30) NOT NULL DEFAULT N'draft',
        row_version rowversion NOT NULL,
        CONSTRAINT ck_process_reviews_key CHECK(process_key IN (N'digital_learning_walk',N'activate_growth_review')),
        CONSTRAINT ck_process_reviews_status CHECK(status IN (N'draft',N'submitted')),
        CONSTRAINT ck_process_reviews_data_json CHECK(ISJSON(data_json)=1),
        CONSTRAINT ck_process_reviews_config_json CHECK(ISJSON(configuration_json)=1)
    );
    CREATE INDEX ix_process_reviews_process ON quality.process_reviews(process_key,faculty_org_unit_id,status);
END;
IF OBJECT_ID(N'quality.process_review_snapshots', N'U') IS NULL
BEGIN
    CREATE TABLE quality.process_review_snapshots(
        id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT newsequentialid(),
        record_id uniqueidentifier NOT NULL REFERENCES quality.process_reviews(record_id),
        as_of_date date NOT NULL,
        source_meeting nvarchar(100) NOT NULL,
        teams_link nvarchar(2000) NOT NULL,
        data_json nvarchar(max) NOT NULL,
        recorded_by_user_account_id uniqueidentifier NOT NULL REFERENCES auth.user_accounts(id),
        recorded_at datetimeoffset NOT NULL DEFAULT sysutcdatetime(),
        CONSTRAINT ck_process_review_snapshots_json CHECK(ISJSON(data_json)=1)
    );
    CREATE INDEX ix_process_review_snapshots_record ON quality.process_review_snapshots(record_id,recorded_at DESC);
END;
IF OBJECT_ID(N'quality.process_review_actions', N'U') IS NULL
BEGIN
    CREATE TABLE quality.process_review_actions(
        action_id uniqueidentifier NOT NULL PRIMARY KEY REFERENCES quality.actions(id),
        theme_key nvarchar(100) NOT NULL,
        support_required nvarchar(4000) NOT NULL,
        success_evidence nvarchar(4000) NOT NULL,
        impact_status nvarchar(30) NOT NULL DEFAULT N'awaiting_evidence',
        impact_evidence nvarchar(4000) NULL,
        impact_evidence_link nvarchar(2000) NULL,
        CONSTRAINT ck_process_review_actions_impact CHECK(impact_status IN (N'awaiting_evidence',N'assessing',N'demonstrated',N'further_change'))
    );
END;
IF OBJECT_ID(N'quality.process_review_action_updates', N'U') IS NULL
BEGIN
    CREATE TABLE quality.process_review_action_updates(
        id uniqueidentifier NOT NULL PRIMARY KEY DEFAULT newsequentialid(),
        action_id uniqueidentifier NOT NULL REFERENCES quality.process_review_actions(action_id),
        updated_by_user_account_id uniqueidentifier NOT NULL REFERENCES auth.user_accounts(id),
        updated_at datetimeoffset NOT NULL DEFAULT sysutcdatetime(),
        update_json nvarchar(max) NOT NULL,
        CONSTRAINT ck_process_review_action_updates_json CHECK(ISJSON(update_json)=1)
    );
    CREATE INDEX ix_process_review_action_updates_action ON quality.process_review_action_updates(action_id,updated_at DESC);
END;
GO
INSERT INTO core.modules(id,module_key,name,description,route_prefix,display_order,is_enabled)
SELECT NEWID(),v.process_key,v.title,v.description,v.route_prefix,v.display_order,1
FROM (VALUES
    (N'digital_learning_walk',N'Digital Learning Walks',N'Team and area digital learning reviews with linked evidence samples.',N'/digital-learning-walks',38),
    (N'activate_growth_review',N'Activate+ Growth Reviews',N'Faculty review tracking, Teams source links and native actions.',N'/activate-growth-reviews',39)
) v(process_key,title,description,route_prefix,display_order)
WHERE NOT EXISTS(SELECT 1 FROM core.modules m WHERE m.module_key=v.process_key);
INSERT INTO auth.permissions(id,permission_key,name,description,category,is_system)
SELECT NEWID(),p.process_key+N'.'+g.permission_suffix,p.title+N': '+g.permission_name,
       g.description,p.title,1
FROM (VALUES(N'digital_learning_walk',N'Digital Learning Walks'),(N'activate_growth_review',N'Activate+ Growth Reviews'))p(process_key,title)
CROSS JOIN (VALUES
    (N'submit',N'Create reviews',N'Create and maintain reviews you own within your assigned organisation scope.'),
    (N'view_scoped',N'View scoped reviews',N'View reviews within your assigned organisation scope.'),
    (N'view_all',N'View all reviews',N'View and report on all reviews for this process.'),
    (N'manage',N'Manage reviews',N'Maintain reviews and actions within your assigned organisation scope.')
) g(permission_suffix,permission_name,description)
WHERE NOT EXISTS(SELECT 1 FROM auth.permissions existing WHERE existing.permission_key=p.process_key+N'.'+g.permission_suffix);
GO
