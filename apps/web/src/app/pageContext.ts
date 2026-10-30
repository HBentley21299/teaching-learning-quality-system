import type { AppRoute } from "./navigation";

/** Only show a shared year control on pages that actually consume that value. */
export function pageUsesAcademicYear(route: AppRoute): boolean {
  return ["dashboard", "staff", "profile", "learning", "digital", "activate", "als_learning", "elevate", "scrutiny", "cpd", "actions", "uco"].includes(route);
}

/** Probation cases span years; their linked actions must span the same history. */
export function actionsAcademicYear(route: AppRoute, academicYear: string): string | undefined {
  return route === "probation" ? undefined : academicYear || undefined;
}
