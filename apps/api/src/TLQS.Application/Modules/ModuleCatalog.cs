namespace TLQS.Application.Modules;

public sealed record ModuleManifest(
    string ModuleKey,
    string Name,
    string RoutePrefix,
    string[] Permissions,
    string[] RecordTypes,
    bool HasConfigurableForms);

public static class ModuleCatalog
{
    public static readonly ModuleManifest[] InitialModules =
    [
        new("staff", "Staff Management", "/staff", ["staff.read", "staff.manage"], ["staff_profile"], false),
        new("identity_access", "User Accounts & Permissions", "/admin/users", ["users.manage", "permissions.manage"], ["user_account"], false),
        new("learning_walks", "Learning Walks", "/learning-walks", ["learning_walk.submit"], ["learning_walk"], true),
        new("work_scrutiny", "Work Scrutiny", "/work-scrutiny", ["work_scrutiny.submit"], ["work_scrutiny"], true),
        new("cpd", "CPD Management", "/cpd", ["cpd.manage", "cpd.self_log"], ["cpd_event"], false),
        new("elevate_practice", "Elevate Learning and Innovation", "/elevate-your-practice", ["elevate_practice.submit"], ["elevate_practice_assessment"], false),
        new("coaching_mentoring", "Coaching and Mentoring", "/coaching-mentoring", ["coaching.submit", "coaching.manage"], ["coaching_session"], false),
        new("evidence", "Staff Development Evidence", "/evidence", ["evidence.submit", "evidence.review"], ["impact_evidence"], true),
        new("actions", "Actions", "/actions", ["actions.manage"], ["action"], false),
        new("reporting", "Reporting", "/reports", ["reports.view_all", "reports.view_scoped"], ["dashboard"], false)
    ];
}
