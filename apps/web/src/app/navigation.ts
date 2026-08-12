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
  { key: "elevate", label: "Elevate Environments", icon: Building2 },
  { key: "practice", label: "Elevate Learning and Innovation", icon: Sparkles },
  { key: "coaching", label: "Coaching & Mentoring", icon: MessagesSquare },
  { key: "scrutiny", label: "Work Scrutiny", icon: ClipboardCheck },
  { key: "cpd", label: "CPD", icon: GraduationCap },
  { key: "profile", label: "Staff Profile", icon: UserRound },
  { key: "actions", label: "Actions", icon: ListChecks }
] as const;

export type AppRoute = (typeof navigationItems)[number]["key"];

const routePermissions: Partial<Record<AppRoute, readonly string[]>> = {
  dashboard: ["reports.view_all", "reports.view_scoped"],
  staff: ["reports.view_all", "reports.view_scoped", "staff.manage", "users.manage"],
  team: ["my_team.view"],
  admin: [
    "users.manage",
    "permissions.manage",
    "organisation.manage",
    "lists.manage",
    "forms.manage",
    "records.manage",
    "messaging.manage"
  ],
  learning: ["learning_walk.submit", "forms.manage", "reports.view_all", "reports.view_scoped"],
  liv: ["liv.submit", "liv.manage"],
  probation: ["probation.submit", "probation.manage"],
  elevate: ["elevate.submit", "elevate.manage", "forms.manage", "reports.view_all", "reports.view_scoped"],
  practice: ["elevate_practice.submit"],
  coaching: ["coaching.submit", "coaching.manage"],
  scrutiny: ["work_scrutiny.submit", "forms.manage", "reports.view_all", "reports.view_scoped"],
  cpd: ["cpd.self_log", "cpd.manage"]
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
