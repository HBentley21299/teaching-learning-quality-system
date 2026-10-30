export const qaAdminSections = [
  { key: "overview", group: "Start", label: "QA admin home", description: "Find a QA setting or follow the steps for setting up a review.", permissions: [], keywords: ["quality assurance", "configuration", "settings"] },
  { key: "questions", group: "Evidence forms", label: "Questions, guidance & tags", description: "Maintain the question bank, question sets, required answers and question-level options.", permissions: ["qa_reviews.manage"], keywords: ["criteria", "wording", "weeks", "themes", "archive", "restore", "not applicable", "comments"], steps: ["Choose an activity and filter by tag or status to find the criterion.", "Add or edit a question, its guidance, question tag and answer requirements.", "Save the new version, then select it when configuring a future review."], impact: "Question changes affect future review setups. Published reviews retain their question snapshots." },
  { key: "question-import", group: "Evidence forms", label: "Import QA questions from CSV", description: "Download a question-bank template, check reference activities and preview new criteria before importing.", permissions: ["qa_reviews.manage"], administratorOnly: true, keywords: ["CSV", "bulk", "upload", "question bank", "guidance", "criteria"], steps: ["Download the CSV template and check the current activity reference values.", "Upload the new questions and correct any row errors in the preview.", "Confirm the new question batch, then review it in the question bank."], impact: "Adds new criteria, using the import's default draft status. Existing questions and published review snapshots are retained." },
  { key: "outcomes", group: "Evidence forms", label: "Outcome labels", description: "Rename the four shared QA outcomes shown on forms, dashboards and new exports.", permissions: ["qa_reviews.manage"], keywords: ["scale", "rating", "below", "at", "above", "not applicable", "wording"], steps: ["Find the outcome whose display wording needs changing.", "Enter four distinct labels that retain their existing meanings.", "Save outcome labels and check a QA form or dashboard."], impact: "Display wording updates across existing and new QA evidence. Outcome meanings and reporting calculations are fixed." },
  { key: "not-seen", group: "Evidence forms", label: "Not seen availability", description: "Choose which QA form templates offer the neutral Not seen response.", permissions: ["qa_reviews.manage"], keywords: ["scale", "rating", "neutral", "missing evidence", "enable", "disable"], steps: ["Find the activity and form template to change.", "Enable or turn off Not seen for that template.", "Save availability and check the response scale on that form."], impact: "Applies wherever the template is used. Existing Not seen answers are retained; Not seen is excluded from rated totals." },
  { key: "form-access", group: "Access & participation", label: "Form access for QA Staff", description: "Allow all QA Staff or selected QA Staff to complete and edit each QA form.", permissions: ["qa_reviews.manage"], keywords: ["roles", "permissions", "submission", "restrict", "staff", "who can", "access"], steps: ["Choose the form template.", "Allow all QA Staff, or choose selected QA Staff and search for the people needed.", "Save form access. Review allocations and role membership still determine review access."], impact: "Affects new forms and further edits to existing evidence, including drafts. It does not allocate review teams or assign roles." },
  { key: "action-themes", group: "Lists & reference data", label: "QA action themes", description: "Maintain the themes offered when creating QA review actions.", permissions: ["lists.manage"], keywords: ["follow-up", "improvement", "choices", "dropdown", "categories", "lists"], steps: ["Expand the QA review action themes list.", "Add or rename a theme, change its order, or deactivate a choice no longer needed.", "Save edited wording. Add, reorder and availability actions save immediately."], impact: "Changes the available QA action choices. Deactivation retains the value for existing records." },
  { key: "delivery-areas", group: "Lists & reference data", label: "Shared delivery areas", description: "Maintain delivery-area choices shared by QA evidence and other teaching review forms.", permissions: ["lists.manage"], keywords: ["curriculum", "course", "dropdown", "liv", "learning walks", "work scrutiny", "probation", "lists"], steps: ["Expand the shared delivery areas list and review where it is used.", "Add or rename a delivery area, change its order, or deactivate an old choice.", "Save edited wording. Add, reorder and availability actions save immediately."], impact: "This is a shared list used outside QA Hub, including LIV and Learning Walks. Review its usage before making a change." },
  { key: "dashboard-faculties", group: "Reporting", label: "QA reporting faculties", description: "Choose the faculties included in QA reporting totals, coverage and exports.", permissions: ["records.manage"], keywords: ["dashboard", "dataset", "faculty", "include", "exclude", "reports", "teams"], steps: ["Review the faculties included in the QA Hub dataset.", "Select or clear faculties; teams follow their faculty selection.", "Save faculty selections, then refresh the dashboard or export."], impact: "Changes QA reporting inclusion. Organisation-wide exclusions and existing access permissions still apply." },
  { key: "workflow", group: "Review setup & workflow", label: "How to set up or amend a review", description: "Find the right place for a review's owner, dates, teams, activities, questions and publication.", permissions: [], keywords: ["new", "review", "owner", "allocation", "opening", "closing", "date", "publish", "reopen", "archive", "configuration", "global", "defaults"], steps: ["Use QA admin for shared questions, scale wording, form access and reference lists.", "Open a review's Configuration page to change its own setup and allocations.", "Check the review summary before publishing. Publishing fixes that review's questions."], impact: "Review setup belongs to each review. Global settings do not replace review allocation, ownership or lifecycle controls." }
] as const;

export type QaAdminSectionKey = typeof qaAdminSections[number]["key"];

export function accessibleQaAdminSections(permissions: readonly string[], isAdministrator = false) {
  const eligible = qaAdminSections.filter(section => !("administratorOnly" in section && section.administratorOnly) || isAdministrator);
  const canAdmin = eligible.some(section => section.permissions.some(permission => permissions.includes(permission)));
  return canAdmin ? eligible.filter(section => section.permissions.length === 0 || section.permissions.some(permission => permissions.includes(permission))) : [];
}

const legacyQaAdminSections: Readonly<Record<string, QaAdminSectionKey>> = {
  "question-bank": "questions", "qa-reviews": "questions", ratings: "outcomes", access: "form-access"
};

export function resolveQaAdminSectionKey(key: string): QaAdminSectionKey | undefined {
  return Object.hasOwn(legacyQaAdminSections, key) ? legacyQaAdminSections[key] : qaAdminSections.find(section => section.key === key)?.key;
}

export function qaAdminPath(key: string = "overview") {
  const section = resolveQaAdminSectionKey(key) ?? key;
  return section === "overview" ? "/qa-hub/admin" : `/qa-hub/admin/${encodeURIComponent(section)}`;
}

export function qaAdminSectionFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "admin" && parts[1] === "qa-reviews") return "questions";
  if (parts[0] !== "qa-hub") return null;
  if (parts[1] === "question-bank") return "questions";
  if (parts[1] !== "admin") return null;
  try { return resolveQaAdminSectionKey(decodeURIComponent(parts[2] ?? "overview")) ?? decodeURIComponent(parts[2] ?? "overview"); }
  catch { return "unavailable"; }
}
