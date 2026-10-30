import {
  BookOpenCheck,
  Building2,
  ClipboardCheck,
  ClipboardPenLine,
  Footprints,
  GraduationCap,
  House,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  School,
  Sparkles,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  UsersRound
} from "lucide-react";

export const navigationItems = [
  { key: "home", label: "Home", icon: House },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "staff", label: "Staff", icon: Users },
  { key: "team", label: "My Team", icon: UsersRound },
  { key: "admin", label: "Admin Centre", icon: Settings },
  { key: "learning", label: "Learning Walks", icon: Footprints },
  { key: "digital", label: "Digital Learning Walks", icon: ClipboardCheck },
  { key: "activate", label: "Activate+ Growth Reviews", icon: BookOpenCheck },
  { key: "liv", label: "LIV", icon: ClipboardPenLine },
  { key: "probation", label: "Probationary Observations", icon: ClipboardCheck },
  { key: "uco", label: "UCO TLA Reviews", icon: School },
  { key: "elevate", label: "Elevate Environments", icon: Building2 },
  { key: "practice", label: "Elevate Learning and Innovation", icon: Sparkles },
  { key: "coaching", label: "Coaching & Mentoring", icon: MessagesSquare },
  { key: "scrutiny", label: "Work Scrutiny", icon: BookOpenCheck },
  { key: "cpd", label: "CPD", icon: GraduationCap },
  { key: "profile", label: "Staff Profile", icon: UserRound },
  { key: "actions", label: "Actions", icon: ListChecks },
  { key: "als_learning", label: "ALS Learning Walks", icon: Footprints },
  { key: "als_liv", label: "ALS LIV", icon: ClipboardPenLine },
  { key: "qa", label: "QA Hub", icon: ShieldCheck, hidden: true }
] as const;

export type AppRoute = (typeof navigationItems)[number]["key"];


export const navigationGroups: { id: string; title: string; description: string; routes: AppRoute[] }[] = [
    { id: "forms", title: "Forms & observations", description: "Record teaching practice and review learning.", routes: ["learning", "digital", "activate", "liv", "scrutiny", "elevate", "probation"] },
    { id: "staff", title: "Staff information", description: "Find your profile, colleagues and team.", routes: ["profile", "staff", "team"] },
    { id: "development", title: "Professional development", description: "Plan your learning, coaching and next steps.", routes: ["practice", "cpd", "coaching"] },
    { id: "tracking", title: "Actions", description: "Follow up on actions and see progress.", routes: ["actions"] },
    { id: "specialist", title: "Specialist provision", description: "University Centre Oldham and Additional Learning Support.", routes: ["uco", "als_learning", "als_liv"] },
    { id: "administration", title: "Administration", description: "Manage access, forms and system settings.", routes: ["admin"] }
];

const routePermissions: Partial<Record<AppRoute, readonly string[]>> = {
  dashboard: ["reports.view_all", "reports.view_scoped", "uco_tla.manage", "forms.manage", "digital_learning_walk.view_all", "digital_learning_walk.view_scoped", "digital_learning_walk.manage", "digital_learning_walk.submit", "activate_growth_review.view_all", "activate_growth_review.view_scoped", "activate_growth_review.manage", "activate_growth_review.submit"],
  staff: ["reports.view_all", "reports.view_scoped", "staff.manage", "users.manage"],
  team: ["my_team.view"],
  admin: [
    "users.manage",
    "permissions.manage",
    "organisation.manage",
    "lists.manage",
    "forms.manage",
    "records.manage",
    "messaging.manage",
    "elevate_status.manage",
    "qa_reviews.manage"
  ],
  learning: ["learning_walk.submit", "forms.manage"],
  digital: ["digital_learning_walk.submit", "digital_learning_walk.view_all", "digital_learning_walk.view_scoped", "digital_learning_walk.manage", "forms.manage"],
  activate: ["activate_growth_review.submit", "activate_growth_review.view_all", "activate_growth_review.view_scoped", "activate_growth_review.manage", "forms.manage"],
  als_learning: ["als_learning_walk.submit", "forms.manage"],
  probation: ["probation.submit", "probation.manage"],
  uco: ["uco_tla.manage", "records.manage"],
  elevate: ["elevate.submit", "elevate.manage", "forms.manage", "reports.view_all", "reports.view_scoped"],
  practice: ["elevate_practice.submit"],
  coaching: ["coaching.submit", "coaching.manage"],
  scrutiny: ["work_scrutiny.submit", "forms.manage", "reports.view_all", "reports.view_scoped"],
  cpd: ["cpd.self_log", "cpd.manage", "cpd.mandatory_log"],
  qa: ["qa_reviews.view_all", "qa_reviews.view_scoped", "qa_reviews.view_assigned", "qa_reviews.manage", "lists.manage", "records.manage"]
};

/**
 * Keeps the sidebar and home tiles aligned with the API permission model.
 * Home, a user's own profile, assigned actions and LIV workspaces remain available
 * to every provisioned account. The API scopes LIV records to the current user;
 * creating or managing reviews still requires the corresponding grant.
 */
export function canAccessRoute(route: AppRoute, permissions: readonly string[]) {
  const required = routePermissions[route];
  return !required || required.some((permission) => permissions.includes(permission));
}
