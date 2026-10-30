export type ProcessReviewKey = "digital_learning_walk" | "activate_growth_review";
export type ProcessReviewStatement = { key: string; text: string };
export type ProcessReviewStandard = { key: string; title: string; statements: ProcessReviewStatement[] };
export type ProcessReviewRatingOption = { key: string; label: string };
export type ProcessReviewSkillSubArea = { key: string; title: string };
export type ProcessReviewSkillsPillar = { key: string; title: string; subAreas: ProcessReviewSkillSubArea[] };
export type ProcessReviewActionTheme = { key: string; title: string };
export type ProcessReviewLink = { recordId: string; title: string; academicYear: string; recordDate?: string | null; status: "draft" | "submitted"; canEdit: boolean };
export type CreateActivateFollowUpRequest = { academicYear: string; recordDate?: string | null; rowVersion?: string | null };
export type ActivatePreviousReviewContext = {
  review: ProcessReviewLink; configuration: ProcessReviewConfiguration; skillsScanScores: Record<string, number | null>;
  meetingMinutes?: string | null; strengths?: string | null; development?: string | null;
  selectedSubTeams: ProcessReviewOrgScope[]; participants: ProcessReviewParticipant[];
};
export type ProcessReviewOrgScope = { orgUnitId: string; name: string; parentOrgUnitId?: string | null; parentName?: string | null; orgUnitType?: string | null };
export type ProcessReviewResponsibleStaff = { staffId: string; displayName: string };
export type ProcessReviewParticipant = { staffId: string; displayName: string; roles: string[]; isLocked: boolean; orgUnitNames: string[] };
export type ActivateGrowthReviewData = {
  allSubTeams: boolean; subTeamOrgUnitIds: string[]; participantStaffIds: string[];
  removedProgrammeLeaderStaffIds: string[]; skillsScanScores: Record<string, number | null>;
  headOfFacultyStaffIds?: string[] | null; programmeLeaderStaffIds?: string[] | null;
  automaticParticipants?: ProcessReviewParticipant[] | null;
  followUpDate?: string | null; meetingMinutes?: string | null; strengths?: string | null; development?: string | null;
};
export type ResolveActivateReviewContextRequest = {
  facultyOrgUnitId: string; allSubTeams: boolean; subTeamOrgUnitIds: string[]; recordId?: string | null; recordDate?: string | null;
};
export type ActivateReviewContext = {
  facultyOrgUnitId: string; facultyName: string; availableSubTeams: ProcessReviewOrgScope[];
  selectedSubTeamOrgUnitIds: string[]; participants: ProcessReviewParticipant[]; warnings: string[];
};
export type ProcessReviewConfiguration = {
  processKey: ProcessReviewKey; title: string; version: number; rowVersion?: string | null;
  standards: ProcessReviewStandard[]; ratingOptions: ProcessReviewRatingOption[];
  fieldLabels: Record<string, string>; settings: Record<string, string>;
  skillsScanPillars?: ProcessReviewSkillsPillar[] | null; actionThemes?: ProcessReviewActionTheme[] | null;
};
export type ProcessReviewSample = {
  id: string; title: string; sampleType: string; sampleDate?: string | null; course?: string | null;
  staffIds: string[]; evidenceLink?: string | null; notes?: string | null;
};
export type ProcessReviewResponse = {
  statementKey: string; ratingKey?: string | null; sampleIds: string[]; rationale?: string | null;
};
export type ProcessReviewData = {
  fields: Record<string, string>; samples: ProcessReviewSample[]; responses: ProcessReviewResponse[]; activate?: ActivateGrowthReviewData | null;
};
export type SaveProcessReviewRequest = {
  title: string; academicYear: string; facultyOrgUnitId?: string | null; teamOrgUnitId?: string | null;
  recordDate?: string | null; data: ProcessReviewData; submit: boolean; rowVersion?: string | null;
};
export type ProcessReviewSummary = {
  recordId: string; processKey: ProcessReviewKey; title: string; academicYear: string;
  facultyOrgUnitId?: string | null; facultyName?: string | null; teamOrgUnitId?: string | null; teamName?: string | null;
  recordDate?: string | null; ownerStaffId: string; ownerName: string; status: "draft" | "submitted";
  updatedAt: string; rowVersion: string; sampleCount: number; ratedStatementCount: number;
  statementCount: number; openActionCount: number; snapshotAsOf?: string | null;
  selectedSubTeams?: ProcessReviewOrgScope[] | null; participants?: ProcessReviewParticipant[] | null;
  skillsScanScores?: Record<string, number | null> | null; followUpDate?: string | null; allSubTeams?: boolean | null;
  isFollowUp?: boolean; parentReview?: ProcessReviewLink | null; followUpReviews?: ProcessReviewLink[] | null;
};
export type ProcessReviewSnapshot = {
  snapshotId: string; asOfDate: string; recordedAt: string; recordedByName: string;
  sourceMeeting: string; teamsLink: string; data: ProcessReviewData;
};
export type ProcessReviewActionUpdate = {
  updateId: string; updatedAt: string; updatedByName: string; progress: string;
  progressNote?: string | null; evidenceLink?: string | null; barriers?: string | null;
  nextStep?: string | null; dueDate: string; deadlineChangeReason?: string | null;
  impactStatus: string; impactEvidence?: string | null; impactEvidenceLink?: string | null;
};
export type ProcessReviewAction = {
  actionId: string; recordId: string; processKey: ProcessReviewKey; recordTitle: string; academicYear: string;
  facultyName?: string | null; teamName?: string | null; title: string; themeKey: string;
  ownerStaffId: string; ownerName: string; dueDate: string; supportRequired: string;
  successEvidence: string; progress: string; impactStatus: string; impactEvidence?: string | null;
  impactEvidenceLink?: string | null; rowVersion: string; updates: ProcessReviewActionUpdate[]; canEdit: boolean; themeLabel?: string | null;
  responsibleStaffIds?: string[] | null; responsibleStaff?: ProcessReviewResponsibleStaff[] | null;
  impactAreaKey?: string | null; impactAreaLabel?: string | null; detail?: string | null; reviewDate?: string | null;
  associatedReviewIds?: string[] | null;
};
export type SaveProcessReviewActionRequest = {
  title: string; themeKey: string; ownerStaffId: string; dueDate: string; supportRequired: string;
  successEvidence: string; progress: string; progressNote?: string | null; evidenceLink?: string | null;
  barriers?: string | null; nextStep?: string | null; impactStatus: string; impactEvidence?: string | null;
  impactEvidenceLink?: string | null; deadlineChangeReason?: string | null; rowVersion?: string | null;
  responsibleStaffIds?: string[] | null; impactAreaKey?: string | null; detail?: string | null; reviewDate?: string | null;
};
export type ProcessReviewDetail = Omit<ProcessReviewSummary, "sampleCount" | "ratedStatementCount" | "statementCount" | "openActionCount" | "snapshotAsOf"> & {
  configuration: ProcessReviewConfiguration; data: ProcessReviewData; snapshots: ProcessReviewSnapshot[];
  actions: ProcessReviewAction[]; canEdit: boolean; legacyConfiguration?: ProcessReviewConfiguration | null;
  parentReviewContext?: ActivatePreviousReviewContext | null;
};

export const processReviewAreas = [
  { key: "immersive", label: "Immersive Technology" },
  { key: "assistive", label: "Assistive Technology" },
  { key: "digital_tla", label: "Digital Teaching & Learning" },
  { key: "it", label: "IT" },
  { key: "mis", label: "MIS" }
] as const;

export function processReviewDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function emptyProcessReviewRequest(academicYear: string): SaveProcessReviewRequest {
  return { title: "", academicYear, recordDate: processReviewDate(), data: { fields: {}, samples: [], responses: [] }, submit: false };
}

export function processReviewRequest(detail: ProcessReviewDetail): SaveProcessReviewRequest {
  return {
    title: detail.title, academicYear: detail.academicYear, facultyOrgUnitId: detail.facultyOrgUnitId,
    teamOrgUnitId: detail.teamOrgUnitId, recordDate: detail.recordDate,
    data: structuredClone(detail.data), rowVersion: detail.rowVersion, submit: false
  };
}

/** Compare editable content; refreshed concurrency tokens do not create false dirty states. */
export function processReviewFingerprint(request: SaveProcessReviewRequest) {
  const { title, academicYear, facultyOrgUnitId, teamOrgUnitId, recordDate, data } = request;
  return JSON.stringify({ title, academicYear, facultyOrgUnitId: facultyOrgUnitId || null,
    teamOrgUnitId: teamOrgUnitId || null, recordDate: recordDate || null, data });
}

export function processReviewSafeLink(value?: string | null) {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}

/** Removing a sample also removes references to it without deleting a statement's rating or rationale. */
export function removeProcessReviewSample(data: ProcessReviewData, id: string): ProcessReviewData {
  return { ...data, samples: data.samples.filter(sample => sample.id !== id),
    responses: data.responses.map(response => ({ ...response, sampleIds: response.sampleIds.filter(sampleId => sampleId !== id) })) };
}

export function processReviewSet(value?: string): string[] {
  if (!value) return [];
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}

export function addProcessReviewDays(value: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return processReviewDate(date);
}

export function emptyActivateGrowthReviewData(subTeamOrgUnitIds: string[] = [], participantStaffIds: string[] = []): ActivateGrowthReviewData {
  return { allSubTeams: subTeamOrgUnitIds.length === 0, subTeamOrgUnitIds: [...subTeamOrgUnitIds],
    participantStaffIds: [...participantStaffIds], removedProgrammeLeaderStaffIds: [], skillsScanScores: {} };
}

/** A pillar result is available only when every sub-area has a valid manual average. */
export function activatePillarAverage(pillar: ProcessReviewSkillsPillar, scores: Record<string, number | null>) {
  if (!pillar.subAreas.length) return null;
  const values = pillar.subAreas.map(area => scores[area.key]);
  if (values.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 5)) return null;
  return values.reduce<number>((sum, value) => sum + (value as number), 0) / values.length;
}

export function activateParticipantIds(context: ActivateReviewContext, selected: string[], removedProgrammeLeaders: string[]) {
  const locked = new Set(context.participants.filter(person => person.isLocked).map(person => person.staffId));
  const removed = new Set(removedProgrammeLeaders);
  return [...new Set([...selected, ...context.participants.map(person => person.staffId)])]
    .filter(id => locked.has(id) || !removed.has(id));
}

/** Refresh derived leadership without reordering unchanged saved selections or creating false edits. */
export function activateContextPatch(request: SaveProcessReviewRequest, context: ActivateReviewContext, previousAutomaticIds: string[] = []): Partial<SaveProcessReviewRequest> {
  const data = request.data.activate || emptyActivateGrowthReviewData();
  const previous = new Set(previousAutomaticIds), automatic = new Set(context.participants.map(person => person.staffId));
  const retained = data.participantStaffIds.filter(id => !previous.has(id) || automatic.has(id));
  const participantStaffIds = activateParticipantIds(context, retained, data.removedProgrammeLeaderStaffIds);
  const sameTeams = data.subTeamOrgUnitIds.length === context.selectedSubTeamOrgUnitIds.length && data.subTeamOrgUnitIds.every(id => context.selectedSubTeamOrgUnitIds.includes(id));
  const subTeamOrgUnitIds = data.allSubTeams && !sameTeams ? context.selectedSubTeamOrgUnitIds : data.subTeamOrgUnitIds;
  if (JSON.stringify(participantStaffIds) === JSON.stringify(data.participantStaffIds) && JSON.stringify(subTeamOrgUnitIds) === JSON.stringify(data.subTeamOrgUnitIds)) return {};
  return { data: { ...request.data, activate: { ...data, participantStaffIds, subTeamOrgUnitIds } } };
}

/** Parent areas group the real hierarchy; no additional organisation layer is invented. */
export function activateSubTeamGroups(context: ActivateReviewContext) {
  const parents = new Set(context.availableSubTeams.map(team => team.parentOrgUnitId).filter(Boolean));
  const leaves = context.availableSubTeams.filter(team => !parents.has(team.orgUnitId));
  const groups = new Map<string, { id: string; name: string; teams: ProcessReviewOrgScope[] }>();
  leaves.forEach(team => {
    const id = team.parentOrgUnitId || context.facultyOrgUnitId;
    const name = team.parentName || context.availableSubTeams.find(area => area.orgUnitId === id)?.name || context.facultyName;
    const group = groups.get(id) || { id, name, teams: [] };
    group.teams.push(team); groups.set(id, group);
  });
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map(group => ({ ...group, teams: group.teams.sort((a, b) => a.name.localeCompare(b.name)) }));
}
