export const legacyFormLocations: Record<string, { family: string; panel: string }> = {
  lists: { family: "all_lists", panel: "lists" },
  "qa-reviews": { family: "qa", panel: "questions" },
  themes: { family: "learning_walks", panel: "settings" },
  "als-themes": { family: "als_learning_walk", panel: "settings" },
  "als-liv": { family: "als_liv", panel: "settings" },
  coaching: { family: "coaching", panel: "settings" }
};

export const adminSections = [
  { key: "overview", group: "Start", label: "Admin home", description: "Find a setting or choose an administration task.", permissions: [] },
  { key: "staff-access", group: "People & access", label: "Staff accounts", description: "Create accounts and maintain account status and sign-in access.", permissions: ["users.manage"] },
  { key: "staff-details", group: "People & access", label: "Staff details & scope", description: "Correct staff categories and details, manage assigned scope, or archive an account.", permissions: ["users.manage"] },
  { key: "roles", group: "People & access", label: "Roles & permissions", description: "Review roles and allocate access to staff.", permissions: ["users.manage", "permissions.manage"] },
  { key: "organisation", group: "People & access", label: "Organisation & teams", description: "Maintain faculties, teams, memberships and managers.", permissions: ["organisation.manage"] },
  { key: "forms", group: "Forms & workflows", label: "Form editor", description: "Edit form wording, layout, shared lists, QA questions, rating language and workflow settings.", permissions: ["forms.manage", "lists.manage", "qa_reviews.manage"] },
  { key: "rooms", group: "Lists & reference data", label: "Rooms & locations", description: "Add, edit or deactivate rooms used in learning environment records.", permissions: ["lists.manage"] },
  { key: "records", group: "Records & corrections", label: "All records & audit", description: "Find records, inspect their audit history, archive or restore them.", permissions: ["records.manage"] },
  { key: "work-scrutiny", group: "Records & corrections", label: "Work Scrutiny corrections", description: "Correct submitted work samples, form responses and linked actions.", permissions: ["records.manage"] },
  { key: "elevate", group: "Records & corrections", label: "ELI record corrections", description: "Review and correct Elevate Learning and Innovation records.", permissions: ["records.manage", "users.manage"] },
  { key: "badges", group: "Presentation & communication", label: "Elevate badges", description: "Upload and maintain the badge images shown on staff profiles.", permissions: ["elevate_status.manage"] },
  { key: "dashboards", group: "Presentation & communication", label: "Dashboard settings", description: "Choose faculty inclusion for each dashboard, visible processes and their display order.", permissions: ["records.manage"] },
  { key: "messaging", group: "Presentation & communication", label: "Messages & email", description: "Edit message templates, delivery settings and inspect delivery history.", permissions: ["messaging.manage"] },
  { key: "system", group: "System", label: "System information", description: "Review module availability and understand which settings need college IT.", permissions: [] }
] as const;

export type AdminSectionKey = typeof adminSections[number]["key"];

export function accessibleAdminSections(permissions: readonly string[]) {
  const canAdmin = adminSections.some((section) => section.permissions.some((permission) => permissions.includes(permission)));
  return canAdmin ? adminSections.filter((section) => {
    // The existing correction screen also loads audit and action endpoints restricted to users.manage.
    if (section.key === "work-scrutiny") return permissions.includes("records.manage") && permissions.includes("users.manage");
    return section.permissions.length === 0 || section.permissions.some((permission) => permissions.includes(permission));
  }) : [];
}

export function resolveAdminSectionKey(key: string) {
  return legacyFormLocations[key] ? "forms" : key;
}
