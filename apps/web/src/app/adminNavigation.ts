export const legacyFormLocations: Record<string, { family: string; panel: string }> = {
  lists: { family: "all_lists", panel: "lists" },
  "qa-reviews": { family: "qa", panel: "questions" },
  themes: { family: "learning_walks", panel: "settings" },
  "als-themes": { family: "als_learning_walk", panel: "settings" },
  "als-liv": { family: "als_liv", panel: "settings" },
  coaching: { family: "coaching", panel: "settings" }
};

export { adminSections, accessibleAdminSections, resolveAdminSectionKey } from "./adminSettingsCatalog";
export type { AdminSectionKey, AdminSection } from "./adminSettingsCatalog";
