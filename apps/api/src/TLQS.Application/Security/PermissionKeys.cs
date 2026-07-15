namespace TLQS.Application.Security;

public static class PermissionKeys
{
    public const string StaffRead = "staff.read";
    public const string StaffManage = "staff.manage";
    public const string UsersManage = "users.manage";
    public const string PermissionsManage = "permissions.manage";
    public const string FormsManage = "forms.manage";
    public const string LearningWalkSubmit = "learning_walk.submit";
    public const string WorkScrutinySubmit = "work_scrutiny.submit";
    public const string CpdManage = "cpd.manage";
    public const string EvidenceSubmit = "evidence.submit";
    public const string EvidenceReview = "evidence.review";
    public const string ActionsManage = "actions.manage";
    public const string MyTeamView = "my_team.view";
    public const string OrganisationManage = "organisation.manage";
    public const string ListsManage = "lists.manage";
    public const string RecordsManage = "records.manage";
    public const string LivSubmit = "liv.submit";
    public const string LivManage = "liv.manage";
    public const string LivSensitiveRead = "liv.sensitive.read";
    public const string ElevateSubmit = "elevate.submit";
    public const string ElevateManage = "elevate.manage";
    public const string ElevatePracticeSubmit = "elevate_practice.submit";
    public const string CoachingSubmit = "coaching.submit";
    public const string CoachingManage = "coaching.manage";
    public const string ReportsViewAll = "reports.view_all";
    public const string ReportsViewScoped = "reports.view_scoped";

    public static readonly string[] All =
    [
        StaffRead,
        StaffManage,
        UsersManage,
        PermissionsManage,
        FormsManage,
        LearningWalkSubmit,
        WorkScrutinySubmit,
        CpdManage,
        EvidenceSubmit,
        EvidenceReview,
        ActionsManage,
        MyTeamView,
        OrganisationManage,
        ListsManage,
        RecordsManage,
        LivSubmit,
        LivManage,
        LivSensitiveRead,
        ElevateSubmit,
        ElevateManage,
        ElevatePracticeSubmit,
        CoachingSubmit,
        CoachingManage,
        ReportsViewAll,
        ReportsViewScoped
    ];
}
