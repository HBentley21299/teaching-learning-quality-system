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

    SELECT staff.id
    INTO #dashboard_colleagues
    FROM people.staff staff
    WHERE staff.external_id LIKE N'LOCAL_DASH[_]____'
      AND TRY_CONVERT(int, RIGHT(staff.external_id, 4)) BETWEEN 1 AND 160
      AND staff.display_name = CONCAT(N'Dashboard Colleague ', RIGHT(CONCAT(N'000', TRY_CONVERT(nvarchar(4), TRY_CONVERT(int, RIGHT(staff.external_id, 4)))), 3))
      AND staff.email = CONCAT(N'local.dashboard.', RIGHT(CONCAT(N'000', TRY_CONVERT(nvarchar(4), TRY_CONVERT(int, RIGHT(staff.external_id, 4)))), 3), N'@example.test');

    DECLARE @targetCount int = (SELECT COUNT(*) FROM #dashboard_colleagues);
    IF @targetCount <> 160
        THROW 51000, 'Safety check failed: expected exactly Dashboard Colleague 001 through 160.', 1;

    IF EXISTS (
        SELECT 1
        FROM auth.user_accounts account
        JOIN #dashboard_colleagues target ON target.id = account.staff_id
    )
        THROW 51000, 'Safety check failed: one or more dashboard fixtures has a sign-in account.', 1;

    DECLARE @membershipCount int = (
        SELECT COUNT(*)
        FROM org.staff_org_memberships membership
        JOIN #dashboard_colleagues target ON target.id = membership.staff_id
    );

    DELETE membership
    FROM org.staff_org_memberships membership
    JOIN #dashboard_colleagues target ON target.id = membership.staff_id;

    DELETE staff
    FROM people.staff staff
    JOIN #dashboard_colleagues target ON target.id = staff.id;

    IF @@ROWCOUNT <> @targetCount
        THROW 51000, 'Safety check failed: the expected dashboard staff rows were not all deleted.', 1;

    COMMIT TRANSACTION;
    PRINT CONCAT('Removed ', @targetCount, ' Dashboard Colleague staff profiles and ', @membershipCount, ' organisation memberships.');
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
