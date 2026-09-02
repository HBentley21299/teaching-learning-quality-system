import {
  Activity,
  Building2,
  ClipboardCheck,
  GraduationCap,
  House,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  MessagesSquare,
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
  { key: "learning", label: "Learning Walks", icon: Activity },
  { key: "liv", label: "LIV", icon: Lightbulb },
  { key: "probation", label: "Probationary Observations", icon: ClipboardCheck },
  { key: "uco", label: "UCO TLA Reviews", icon: ClipboardCheck },
  { key: "elevate", label: "Elevate Environments", icon: Building2 },
  { key: "practice", label: "Elevate Learning and Innovation", icon: Sparkles },
  { key: "coaching", label: "Coaching & Mentoring", icon: MessagesSquare },
  { key: "scrutiny", label: "Work Scrutiny", icon: ClipboardCheck },
  { key: "cpd", label: "CPD", icon: GraduationCap },
  { key: "profile", label: "Staff Profile", icon: UserRound },
  { key: "actions", label: "Actions", icon: ListChecks },
  { key: "als_learning", label: "ALS Learning Walks", icon: Activity },
  { key: "als_liv", label: "ALS LIV", icon: Lightbulb },
  { key: "qa", label: "QA Hub", icon: ShieldCheck, hidden: true }
] as const;

export type AppRoute = (typeof navigationItems)[number]["key"];

const routePermissions: Partial<Record<AppRoute, readonly string[]>> = {
  dashboard: ["reports.view_all", "reports.view_scoped", "uco_tla.manage"],
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
    "qa_reviews.manage"
  ],
  learning: ["learning_walk.submit", "forms.manage"],
  liv: ["liv.submit", "liv.manage"],
  als_learning: ["als_learning_walk.submit", "forms.manage"],
  als_liv: ["als_liv.submit", "als_liv.manage"],
  probation: ["probation.submit", "probation.manage"],
  uco: ["uco_tla.manage", "records.manage"],
  elevate: ["elevate.submit", "elevate.manage", "forms.manage", "reports.view_all", "reports.view_scoped"],
  practice: ["elevate_practice.submit"],
  coaching: ["coaching.submit", "coaching.manage"],
  scrutiny: ["work_scrutiny.submit", "forms.manage", "reports.view_all", "reports.view_scoped"],
  cpd: ["cpd.self_log", "cpd.manage"],
  qa: ["qa_reviews.view_all", "qa_reviews.view_scoped", "qa_reviews.view_assigned"]
};

/**
 * Keeps the sidebar and home tiles aligned with the API permission model.
 * Home, a user's own profile and their assigned actions remain available to
 * every provisioned account; all other workspaces require one matching grant.
 */
export function canAccessRoute(route: AppRoute, permissions: readonly string[]) {
  const required = routePermissions[route];
  return !required || required.some((permission) => permissions.includes(permission));
}
