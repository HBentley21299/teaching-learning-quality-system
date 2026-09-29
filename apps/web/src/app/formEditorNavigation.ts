// Explicit dependencies: form definitions do not expose managed lookup keys.
export const formFamilies = [
  { key: "work_scrutiny", label: "Work Scrutiny", templateModule: "work_scrutiny", lists: ["action_theme_work_scrutiny"] },
  { key: "learning_walks", label: "Learning Walk", templateModule: "learning_walks", lists: ["liv_delivery_area", "action_theme_learning_walk"], settings: "Themes & focus areas" },
  { key: "als_learning_walk", label: "ALS Learning Walk", lists: ["als_liv_delivery_area", "action_theme_als_learning_walk"], settings: "Themes & focus areas" },
  { key: "cpd", label: "CPD", templateModule: "cpd", lists: ["cpd_theme", "action_theme_cpd"] },
  { key: "qa", label: "QA reviews", lists: ["action_theme_qa_review"] },
  { key: "elevate_environment", label: "Learning Environment", lists: ["elevate_environment_purpose", "action_theme_elevate_environment"] },
  { key: "coaching", label: "Coaching & Mentoring", lists: ["coaching_focus_area", "coaching_support_type", "action_theme_coaching_mentoring"], settings: "Session settings" },
  { key: "liv", label: "LIV", lists: ["liv_delivery_area", "liv_course_level", "liv_visit_focus_area", "liv_development_opportunity", "liv_notice_preference", "liv_focus_area", "action_theme_liv"], settings: "Themes & focus areas" },
  { key: "als_liv", label: "ALS LIV", lists: ["als_liv_delivery_area", "als_liv_course_level", "als_liv_visit_focus_area", "als_liv_development_opportunity", "action_theme_als_liv"], settings: "Practitioner areas" },
  { key: "probation", label: "Probation observation", lists: ["action_theme_probation_observation"] },
  { key: "uco", label: "UCO TLA review", lists: ["action_theme_uco_tla_review"] },
  { key: "actions", label: "Standalone actions", lists: ["action_theme_standalone"] },
  { key: "all_lists", label: "All shared lists", lists: [] }
] satisfies Array<{ key: string; label: string; templateModule?: string; lists: string[]; settings?: string }>;

export function availableFormFamilies(permissions: readonly string[]) {
  return formFamilies.filter((family) => permissions.includes("lists.manage")
    || (family.templateModule && permissions.includes("forms.manage"))
    || (family.settings && family.key !== "coaching" && permissions.includes("forms.manage"))
    || (family.key === "qa" && permissions.includes("qa_reviews.manage")));
}
