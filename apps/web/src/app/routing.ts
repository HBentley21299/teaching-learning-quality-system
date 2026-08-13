import type { AppRoute } from "./navigation";

export type AppLocation = {
  route: AppRoute;
  profileStaffId: string;
  actionStaffId: string;
  actionDetailId: string;
  sourceRecordId: string;
  pendingRecordId: string;
  adminTab: string;
};

const routePaths: Record<AppRoute, string> = {
  home: "/home",
  dashboard: "/dashboard",
  staff: "/staff",
  team: "/my-team",
  admin: "/admin",
  learning: "/learning-walks",
  liv: "/liv",
  als_learning: "/als-learning-walks",
  als_liv: "/als-liv",
  probation: "/probationary-observations",
  elevate: "/learning-environments",
  practice: "/learning-innovation",
  coaching: "/coaching-mentoring",
  scrutiny: "/work-scrutiny",
  cpd: "/cpd",
  profile: "/profile",
  actions: "/actions"
};

const pathRoutes = new Map(Object.entries(routePaths).map(([route, path]) => [path, route as AppRoute]));

export function routePath(route: AppRoute) {
  return routePaths[route];
}

export function staffPath(staffId: string) {
  return `/staff/${encodeURIComponent(staffId)}`;
}

export function staffActionsPath(staffId: string) {
  return `/staff/${encodeURIComponent(staffId)}/actions`;
}

export function actionPath(actionId: string) {
  return `/actions/${encodeURIComponent(actionId)}`;
}

export function recordPath(recordId: string) {
  return `/records/${encodeURIComponent(recordId)}`;
}

export function adminPath(tab: string) {
  return tab && tab !== "overview" ? `/admin/${encodeURIComponent(tab)}` : "/admin";
}

export function parseAppLocation(pathname = window.location.pathname): AppLocation {
  const normalized = normalizePath(pathname);
  const empty = {
    profileStaffId: "",
    actionStaffId: "",
    actionDetailId: "",
    sourceRecordId: "",
    pendingRecordId: "",
    adminTab: "overview"
  };

  if (normalized === "/" || normalized === "/index.html") {
    return { ...empty, route: "home" };
  }

  const segments = normalized.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] === "records" && segments[1]) {
    return { ...empty, route: "dashboard", sourceRecordId: segments[1], pendingRecordId: segments[1] };
  }
  if (segments[0] === "actions" && segments[1]) {
    return { ...empty, route: "actions", actionDetailId: segments[1] };
  }
  if (segments[0] === "staff" && segments[1] && segments[2] === "actions") {
    return { ...empty, route: "actions", actionStaffId: segments[1] };
  }
  if (segments[0] === "staff" && segments[1]) {
    return { ...empty, route: "profile", profileStaffId: segments[1] };
  }
  if (segments[0] === "admin") {
    return { ...empty, route: "admin", adminTab: segments[1] || "overview" };
  }

  return { ...empty, route: pathRoutes.get(normalized) ?? "dashboard" };
}

function normalizePath(pathname: string) {
  const withoutTrailingSlash = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return withoutTrailingSlash.toLowerCase();
}
