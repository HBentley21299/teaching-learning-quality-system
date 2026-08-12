SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @recordIds TABLE (id uniqueidentifier PRIMARY KEY);
    DECLARE @assessmentIds TABLE (id uniqueidentifier PRIMARY KEY);
    DECLARE @livSourceRecordIds TABLE (id uniqueidentifier PRIMARY KEY);
    DECLARE @livIds TABLE (id uniqueidentifier PRIMARY KEY);
    DECLARE @livCycleIds TABLE (id uniqueidentifier PRIMARY KEY);
    DECLARE @livVisitIds TABLE (id uniqueidentifier PRIMARY KEY);
    DECLARE @number int = 1;
    WHILE @number <= 12
    BEGIN
        INSERT INTO @recordIds VALUES (
            CONVERT(uniqueidentifier, CONCAT(N'E1000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', @number), 12)))
        );
        INSERT INTO @assessmentIds VALUES (
            CONVERT(uniqueidentifier, CONCAT(N'E2000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', @number), 12)))
        );
        IF @number <= 6
        BEGIN
            INSERT INTO @livSourceRecordIds VALUES (
                CONVERT(uniqueidentifier, CONCAT(N'E3000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', @number), 12)))
            );
            INSERT INTO @livIds VALUES (
                CONVERT(uniqueidentifier, CONCAT(N'E4000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', @number), 12)))
            );
            INSERT INTO @livCycleIds VALUES (
                CONVERT(uniqueidentifier, CONCAT(N'E5000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', @number), 12)))
            );
        END;
        IF @number <= 5
            INSERT INTO @livVisitIds VALUES (
                CONVERT(uniqueidentifier, CONCAT(N'E6000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', @number), 12)))
            );
        SET @number += 1;
    END;

    DELETE FROM quality.actions WHERE liv_visit_id IN (SELECT id FROM @livVisitIds) OR liv_cycle_id IN (SELECT id FROM @livCycleIds);
    DELETE FROM quality.liv_visit_ratings WHERE visit_id IN (SELECT id FROM @livVisitIds);
    DELETE FROM quality.liv_stages WHERE liv_cycle_id IN (SELECT id FROM @livCycleIds);
    DELETE FROM quality.liv_visits WHERE id IN (SELECT id FROM @livVisitIds);
    DELETE FROM quality.liv_cycles WHERE id IN (SELECT id FROM @livCycleIds);
    DELETE FROM quality.liv_record_themes WHERE liv_record_id IN (SELECT id FROM @livIds);
    DELETE FROM quality.liv_records WHERE id IN (SELECT id FROM @livIds);
    DELETE FROM core.records WHERE id IN (SELECT id FROM @livSourceRecordIds);

    DELETE FROM quality.elevate_practice_development_plans WHERE assessment_id IN (SELECT id FROM @assessmentIds);
    DELETE FROM quality.elevate_practice_selections WHERE assessment_id IN (SELECT id FROM @assessmentIds);
    DELETE FROM quality.elevate_practice_reflections WHERE assessment_id IN (SELECT id FROM @assessmentIds);
    DELETE FROM quality.elevate_practice_ratings WHERE assessment_id IN (SELECT id FROM @assessmentIds);
    DELETE FROM quality.elevate_practice_area_ratings WHERE assessment_id IN (SELECT id FROM @assessmentIds);
    DELETE FROM quality.elevate_practice_liv_information WHERE assessment_id IN (SELECT id FROM @assessmentIds);
    DELETE FROM quality.elevate_practice_assessments WHERE id IN (SELECT id FROM @assessmentIds);
    DELETE FROM core.records WHERE id IN (SELECT id FROM @recordIds);

    COMMIT TRANSACTION;
    PRINT 'Dashboard reporting test data removed.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
