namespace TLQS.Application.Security;

public static class PermissionKeys
{
    public const string StaffRead = "staff.read";
    public const string StaffManage = "staff.manage";
    public const string UsersManage = "users.manage";
    public const string PermissionsManage = "permissions.manage";
    public const string FormsManage = "forms.manage";
    public const string LearningWalkSubmit = "learning_walk.submit";
    public const string AlsLearningWalkSubmit = "als_learning_walk.submit";
    public const string WorkScrutinySubmit = "work_scrutiny.submit";
    public const string CpdManage = "cpd.manage";
    public const string CpdSelfLog = "cpd.self_log";
    public const string ElevateStatusManage = "elevate_status.manage";
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
    public const string AlsLivSubmit = "als_liv.submit";
    public const string AlsLivManage = "als_liv.manage";
    public const string ElevateSubmit = "elevate.submit";
    public const string ElevateManage = "elevate.manage";
    public const string ElevatePracticeSubmit = "elevate_practice.submit";
    public const string CoachingSubmit = "coaching.submit";
    public const string CoachingManage = "coaching.manage";
    public const string ProbationSubmit = "probation.submit";
    public const string ProbationManage = "probation.manage";
    public const string ReportsViewAll = "reports.view_all";
    public const string ReportsViewScoped = "reports.view_scoped";
    public const string MessagingManage = "messaging.manage";
    public const string MessagingSend = "messaging.send";
    public const string ExportsCreate = "exports.create";
    public const string QaReviewsViewAll = "qa_reviews.view_all";
    public const string QaReviewsViewScoped = "qa_reviews.view_scoped";
    public const string QaReviewsViewAssigned = "qa_reviews.view_assigned";
    public const string QaReviewsSubmitAll = "qa_reviews.submit_all";
    public const string QaReviewsSubmitScoped = "qa_reviews.submit_scoped";
    public const string QaReviewsSubmitAssigned = "qa_reviews.submit_assigned";
    public const string QaReviewsManage = "qa_reviews.manage";
    public const string QaReviewsCorrect = "qa_reviews.correct";
    public const string QaReviewsRemove = "qa_reviews.remove";
    public const string QaReviewsActionsAdmin = "qa_reviews.actions_admin";

    public static readonly string[] All =
    [
        StaffRead,
        StaffManage,
        UsersManage,
        PermissionsManage,
        FormsManage,
        LearningWalkSubmit,
        AlsLearningWalkSubmit,
        WorkScrutinySubmit,
        CpdManage,
        CpdSelfLog,
        ElevateStatusManage,
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
        AlsLivSubmit,
        AlsLivManage,
        ElevateSubmit,
        ElevateManage,
        ElevatePracticeSubmit,
        CoachingSubmit,
        CoachingManage,
        ProbationSubmit,
        ProbationManage,
        ReportsViewAll,
        ReportsViewScoped,
        MessagingManage,
        MessagingSend,
        ExportsCreate,
        QaReviewsViewAll,
        QaReviewsViewScoped,
        QaReviewsViewAssigned,
        QaReviewsSubmitAll,
        QaReviewsSubmitScoped,
        QaReviewsSubmitAssigned,
        QaReviewsManage,
        QaReviewsCorrect,
        QaReviewsRemove,
        QaReviewsActionsAdmin
    ];
}
