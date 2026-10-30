export type DashboardSection = "summary" | "data" | "actions" | "coverage";
export const dashboardDescriptions: Record<string, string> = {
  overview: "Activity, practice outcomes and follow-up across the college.",
  learning_walk: "Walks, delivery areas, teaching themes and recorded practice.",
  digital_learning_walk: "Team and area digital reviews, statement ratings and linked evidence samples.",
  activate_growth_review: "Faculty growth review cycles, dated Teams summaries, native actions and impact.",
  liv: "Named staff, review cycles, visits, discussions and follow-up.",
  als_learning_walk: "ALS learning walks, focus areas and practice outcomes.",
  als_liv: "ALS staff reviews, practitioner areas, visits and follow-up.",
  eli: "Staff submission coverage, self-assessment responses and development priorities.",
  probation_case: "Staff observation journeys, completed stages and agreed actions.",
  elevate_environment: "Rooms, learning environment assessments, barriers and actions.",
  coaching_session: "Coachees, mentors, session records, support and development actions.",
  work_scrutiny: "Reviewers, learner samples, course context and qualitative findings.",
  cpd_event: "Development events, organisers, staff attendance and learning time.",
  elevate_status: "A named staff register of achieved levels and progress towards the next award.",
  actions: "Action owners, associated staff, due dates, progress and follow-up.",
  uco: "Named lecturers, observers, review evidence and final sign-off."
};
export function dashboardNavigationGroup(key: string) {
  if (key === "overview") return "Overview";
  if (["als_learning_walk", "als_liv", "uco"].includes(key)) return "Specialist provision";
  if (["eli", "activate_growth_review", "coaching_session", "cpd_event", "elevate_status", "actions"].includes(key)) return "People & development";
  return "Teaching & review";
}
export function readDashboardLocation(search: string) {
  const params = new URLSearchParams(search);
  const view = params.get("view") ?? "overview";
  const section = params.get("section") ?? "summary";
  return {
    view: Object.hasOwn(dashboardDescriptions, view) ? view : "overview",
    section: (["summary", "data", "actions", "coverage"].includes(section) ? section : "summary") as DashboardSection
  };
}
export function dashboardLocation(view: string, section: DashboardSection = "summary") {
  const params = new URLSearchParams();
  if (view !== "overview") params.set("view", view);
  if (section !== "summary") params.set("section", section);
  return `/dashboard${params.size ? `?${params}` : ""}`;
}
