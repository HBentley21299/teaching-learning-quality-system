SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

IF COL_LENGTH(N'quality.probation_observation_visits', N'unobserved_focus_keys_json') IS NULL
BEGIN
    ALTER TABLE quality.probation_observation_visits
        ADD unobserved_focus_keys_json nvarchar(max) NULL;
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = N'ck_probation_visits_unobserved_focus_keys'
)
BEGIN
    EXEC(N'
        ALTER TABLE quality.probation_observation_visits
            ADD CONSTRAINT ck_probation_visits_unobserved_focus_keys
            CHECK (
                unobserved_focus_keys_json IS NULL
                OR ISJSON(unobserved_focus_keys_json) = 1
            );
    ');
END;

COMMIT TRANSACTION;
