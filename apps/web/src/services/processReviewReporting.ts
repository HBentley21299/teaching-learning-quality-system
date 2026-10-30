import type { ProcessReviewAction, ProcessReviewConfiguration, ProcessReviewSummary } from "./processReviewTypes";
import { compareListValues, matchesListSearch } from "./listQuery";

export type ProcessReviewReportQuery = {
  search: string;
  faculty: string;
  owner: string;
  status: string;
  fromDate: string;
  toDate: string;
  sort: string;
  subTeam?: string;
  participant?: string;
  impactArea?: string;
  reviewKind?: string;
};

export const emptyProcessReviewReportQuery: ProcessReviewReportQuery = {
  search: "", faculty: "", owner: "", status: "", fromDate: "", toDate: "", sort: "date_desc", subTeam: "", participant: "", impactArea: "", reviewKind: ""
};

export function selectProcessReviewRows(rows: readonly ProcessReviewSummary[], query: ProcessReviewReportQuery) {
  return rows.filter(row => (!query.faculty || row.facultyOrgUnitId === query.faculty)
    && (!query.owner || row.ownerStaffId === query.owner)
    && (!query.subTeam || row.selectedSubTeams?.some(team => team.orgUnitId === query.subTeam))
    && (!query.participant || row.participants?.some(person => person.staffId === query.participant))
    && (!query.status || row.status === query.status)
    && (!query.reviewKind || (query.reviewKind === "follow_up" ? row.isFollowUp : !row.isFollowUp))
    && (!query.fromDate || Boolean(row.recordDate && row.recordDate >= query.fromDate))
    && (!query.toDate || Boolean(row.recordDate && row.recordDate <= query.toDate))
    && matchesListSearch(query.search, row.title, row.facultyName, row.teamName, row.ownerName, row.academicYear, row.status,
      row.selectedSubTeams?.map(team => team.name), row.participants?.map(person => [person.displayName, person.roles]),
      row.isFollowUp ? "Follow-up review" : "Initial review", row.parentReview?.title, row.followUpReviews?.map(review => review.title)))
    .slice().sort((a, b) => {
      const order = query.sort === "title" ? compareListValues(a.title, b.title)
        : query.sort === "owner" ? compareListValues(a.ownerName, b.ownerName)
        : query.sort === "faculty" ? compareListValues(a.facultyName, b.facultyName)
        : query.sort === "follow_up" ? compareListValues(latestFollowUpDate(a), latestFollowUpDate(b), "desc")
        : query.sort === "updated" ? compareListValues(a.updatedAt, b.updatedAt, "desc")
        : query.sort === "date_asc" ? compareListValues(a.recordDate, b.recordDate)
        : compareListValues(a.recordDate, b.recordDate, "desc");
      return order || compareListValues(a.title, b.title) || a.recordId.localeCompare(b.recordId);
    });
}

function latestFollowUpDate(review: ProcessReviewSummary) {
  return review.followUpReviews?.map(child => child.recordDate).filter((value): value is string => Boolean(value)).sort().at(-1);
}

export function selectProcessReviewActions(rows: readonly ProcessReviewAction[], query: ProcessReviewReportQuery, recordIds: ReadonlySet<string> | null = null) {
  return rows.filter(row => (!recordIds || recordIds.has(row.recordId) || row.associatedReviewIds?.some(id => recordIds.has(id)))
    && (!query.owner || row.ownerStaffId === query.owner || row.responsibleStaffIds?.includes(query.owner))
    && (!query.impactArea || row.impactAreaKey === query.impactArea)
    && (!query.status || row.progress === query.status)
    && (!query.fromDate || row.dueDate >= query.fromDate)
    && (!query.toDate || row.dueDate <= query.toDate)
    && matchesListSearch(query.search, row.title, row.facultyName, row.teamName, row.ownerName,
      row.recordTitle, row.themeKey, row.themeLabel, row.supportRequired, row.successEvidence, row.progress, row.impactStatus, row.impactEvidence,
      row.responsibleStaff?.map(person => person.displayName), row.impactAreaLabel, row.detail))
    .slice().sort((a, b) => {
      const order = query.sort === "title" ? compareListValues(a.title, b.title)
        : query.sort === "owner" ? compareListValues(a.ownerName, b.ownerName)
        : query.sort === "faculty" ? compareListValues(a.facultyName, b.facultyName)
        : query.sort === "date_desc" ? compareListValues(a.dueDate, b.dueDate, "desc")
        : compareListValues(a.dueDate, b.dueDate);
      return order || compareListValues(a.title, b.title) || a.actionId.localeCompare(b.actionId);
    });
}

export function processReviewEvidenceHref(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value);
    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}

export function processReviewCodeLabel(value: string | undefined) {
  if (!value) return "Not recorded";
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ActivateSkillsPillar = NonNullable<ProcessReviewConfiguration["skillsScanPillars"]>[number];

/** A blank or invalid manual average is missing evidence; it never represents a zero. */
export function activateSkillsScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
}

const activatePillarMeanFormat = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Match the workbook's decimal rounding rather than exposing binary toFixed tie errors. */
export function formatActivatePillarMean(value: number): string {
  return activatePillarMeanFormat.format(value);
}

/** Pillars use an equal-weight mean of their complete, entered sub-area averages. */
export function activateSkillsPillarResults(pillars: readonly ActivateSkillsPillar[], scores: Readonly<Record<string, number | null>>, allowMeans = true) {
  return pillars.map(pillar => {
    const subAreas = pillar.subAreas.map(area => ({ ...area, score: activateSkillsScore(scores[area.key]) }));
    const entered = subAreas.filter(area => area.score !== null);
    const complete = subAreas.length > 0 && entered.length === subAreas.length;
    return { ...pillar, subAreas, enteredCount: entered.length, complete,
      mean: allowMeans && complete ? entered.reduce((total, area) => total + area.score!, 0) / subAreas.length : null };
  });
}

export function processReviewResponsibleNames(action: ProcessReviewAction): string[] {
  return action.responsibleStaff?.length ? action.responsibleStaff.map(person => person.displayName) : [action.ownerName];
}

const fieldLabels: Record<string, string> = {
  scope: "Scope and context", teamsUrl: "Full review in Teams", headOfFacultyStaffId: "Head of faculty",
  initialPlannedDate: "Initial review · planned", initialHeldDate: "Initial review · held",
  progressPlannedDate: "Progress review · planned", progressHeldDate: "Progress review · held",
  attendeeStaffIds: "Actual attendees", skillsScanTargetDate: "Skills Scan · target closure",
  skillsScanCompletedDate: "Skills Scan · actual closure", skillsScanPeriod: "Skills Scan reporting period",
  skillsScanSummaryUrl: "Skills Scan summary", responsesReceived: "Skills Scan responses received",
  eligibleStaff: "Confirmed eligible staff", specialistReady: "Specialist contributions ready",
  initialPackTargetDate: "Initial preparation pack · target circulation", initialPackCompletedDate: "Initial preparation pack · actual circulation",
  preparationGaps: "Preparation gaps", snapshotDate: "Snapshot as of", sourceCheckedDate: "Teams source checked on",
  sourceMeeting: "Source meeting", area_immersive: "Immersive Technology", area_assistive: "Assistive Technology",
  area_digital_tla: "Digital Teaching & Learning", area_it: "IT", area_mis: "MIS", reportedNeeds: "Reported needs",
  supportRequested: "Support requested", supportAgreed: "Support agreed", impactSummary: "Impact evidenced so far",
  progressPackTargetDate: "Progress preparation pack · target circulation", progressPackCompletedDate: "Progress preparation pack · actual circulation",
  changedPriorities: "Changed priorities", impactEvidence: "Impact evidence", impactLinks: "Impact evidence links",
  actionOutcomes: "Action review outcomes", carryForward: "Priorities for next cycle", escalationIssue: "Escalation · issue and effect",
  escalationSupport: "Escalation · support or decision needed", escalationOutcome: "Escalation · outcome and next steps",
  strengths: "Strengths and effective practice"
};

export function processReviewFieldLabel(configuration: ProcessReviewConfiguration, key: string) {
  return configuration.fieldLabels[key] || configuration.standards.find(standard => `${standard.key}_summary` === key)?.title
    || fieldLabels[key] || processReviewCodeLabel(key.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

export function validateProcessReviewConfiguration(configuration: ProcessReviewConfiguration): string[] {
  const errors: string[] = [];
  if (!configuration.title.trim()) errors.push("Enter the process title.");
  const digital = configuration.processKey === "digital_learning_walk";
  if (digital && !configuration.standards.length) errors.push("Add at least one review area or standard.");
  const standardKeys = new Set<string>();
  const statementKeys = new Set<string>();
  for (const standard of configuration.standards) {
    if (!standard.title.trim()) errors.push("Name every review area or standard.");
    if (!standard.key || standardKeys.has(standard.key)) errors.push("Each review area needs a distinct reporting reference.");
    standardKeys.add(standard.key);
    if (configuration.processKey === "digital_learning_walk" && !standard.statements.length) errors.push(`Add a statement to ${standard.title || "every standard"}.`);
    for (const statement of standard.statements) {
      if (!statement.text.trim()) errors.push("Enter the wording for every statement.");
      if (!statement.key || statementKeys.has(statement.key)) errors.push("Each statement needs a distinct reporting reference.");
      statementKeys.add(statement.key);
    }
  }
  const ratingKeys = new Set<string>(), ratingLabels = new Set<string>();
  for (const rating of configuration.ratingOptions) {
    if (!rating.label.trim()) errors.push("Enter a label for every rating category.");
    if (!rating.key || ratingKeys.has(rating.key)) errors.push("Each rating category needs a distinct reporting reference.");
    if (ratingLabels.has(rating.label.trim().toLocaleLowerCase())) errors.push("Rating category labels must be distinct.");
    ratingKeys.add(rating.key); ratingLabels.add(rating.label.trim().toLocaleLowerCase());
  }
  if (!digital) {
    const pillars = configuration.skillsScanPillars ?? [];
    const themes = configuration.actionThemes ?? [];
    if (pillars.length !== 6 || pillars.reduce((count, pillar) => count + pillar.subAreas.length, 0) !== 15)
      errors.push("Activate+ Skills Scan uses six pillars and fifteen sub-areas. Reload the current framework before saving.");
    const keys = new Set<string>();
    for (const pillar of pillars) {
      if (!pillar.title.trim()) errors.push("Name every Skills Scan pillar.");
      if (!pillar.key || keys.has(pillar.key)) errors.push("Skills Scan pillar references must be distinct.");
      keys.add(pillar.key);
      for (const area of pillar.subAreas) {
        if (!area.title.trim()) errors.push("Name every Skills Scan sub-area.");
        if (!area.key || keys.has(area.key)) errors.push("Skills Scan sub-area references must be distinct.");
        keys.add(area.key);
      }
    }
    if (themes.length !== 5 || themes.some(theme => !theme.title.trim()) || new Set(themes.map(theme => theme.key)).size !== themes.length)
      errors.push("Name all five specialist action themes, retaining their distinct references.");
    if (configuration.ratingOptions.length) errors.push("Activate+ uses manual Skills Scan averages from 1 to 5; it has no configurable maturity rating scale.");
  }
  return [...new Set(errors)];
}
