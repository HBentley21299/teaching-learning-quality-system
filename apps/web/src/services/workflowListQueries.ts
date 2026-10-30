import type { ElevatePracticeProgress, ElevatePracticeValidationProgress, OrgUnitSummary, RecordSummary, UcoTlaReviewSummary } from "./types";
import { matchesListSearch, sortListRows } from "./listQuery";

export type UcoReviewFilters = { search: string; status: string; observer: string; course: string; followUp: string; sort: string };
export function selectUcoReviews(reviews: readonly UcoTlaReviewSummary[], filters: UcoReviewFilters) {
  const rows = reviews.filter(review => (filters.status === "all" || review.workflowStatus === filters.status)
    && (filters.observer === "all" || review.observerStaffId === filters.observer)
    && (filters.course === "all" || review.courseTitle === filters.course)
    && (filters.followUp === "all" || (review.followUpStatus || "not_scheduled") === filters.followUp)
    && matchesListSearch(filters.search, review.title, review.lecturerName, review.observerName, review.courseTitle, review.moduleTitle,
      review.academicYear, review.workflowStatus.replaceAll("_", " "), ({ observer_draft: "Observer review", awaiting_lecturer: "With lecturer", awaiting_finalisation: "Final sign-off", completed: "Complete" } as Record<string, string>)[review.workflowStatus], review.followUpStatus?.replaceAll("_", " "),
      review.observationAt, review.professionalDiscussionAt, review.followUpAt));
  return sortListRows(rows, review => filters.sort === "lecturer" ? review.lecturerName : filters.sort === "observer" ? review.observerName
    : filters.sort === "course" ? review.courseTitle : filters.sort === "status" ? review.workflowStatus
    : review.observationAt ? new Date(review.observationAt) : undefined,
  filters.sort === "newest" ? "desc" : "asc", review => review.recordId);
}

export type PracticeListFilters = { search: string; status: string; faculty: string; team: string; reviewer?: string; sort: string };
export function selectPracticeStaff<T extends ElevatePracticeProgress>(records: readonly T[], filters: PracticeListFilters, validation = false): T[] {
  const rows = records.filter(record => {
    const review = record as ElevatePracticeProgress & Partial<ElevatePracticeValidationProgress>;
    return (filters.status === "all" || (validation ? review.validationStatus : record.status) === filters.status)
      && (filters.faculty === "all" || (record.facultyCode || "unassigned") === filters.faculty)
      && (filters.team === "all" || (record.teamCode || "unassigned") === filters.team)
      && (!filters.reviewer || filters.reviewer === "all" || (review.reviewedByName || "not_reviewed") === filters.reviewer)
      && matchesListSearch(filters.search, record.staffName, record.externalId, record.email, record.facultyCode, record.facultyName,
        record.teamCode, record.teamName, record.academicYear, record.status.replaceAll("_", " "),
        validation ? [review.validationStatus?.replaceAll("_", " "), ({ pending: "Awaiting validation", returned: "Returned for amendments", validated: "Validated", draft: "Not yet submitted" } as Record<string, string>)[review.validationStatus || ""], review.reviewedByName, review.feedback] : []);
  });
  return sortListRows(rows, record => {
    const review = record as ElevatePracticeProgress & Partial<ElevatePracticeValidationProgress>;
    if (filters.sort === "faculty") return record.facultyName || record.facultyCode;
    if (filters.sort === "team") return record.teamName || record.teamCode;
    if (filters.sort === "status") return validation ? review.validationStatus : record.status;
    if (filters.sort === "reviewer") return review.reviewedByName;
    if (["newest", "oldest"].includes(filters.sort)) {
      const date = validation ? review.reviewedAt : record.submittedAt || record.updatedAt;
      return date ? new Date(date) : undefined;
    }
    return record.staffName;
  }, filters.sort === "newest" ? "desc" : "asc", record => record.staffId);
}

export type WorkspaceRecordFilters = { search: string; status: string; area: string; type: string; theme: string; person: string; participant: string; deliveryArea: string; room: string; from: string; to: string; sort: string; mine: boolean };
export function selectWorkspaceRecords(records: readonly RecordSummary[], units: readonly OrgUnitSummary[], filters: WorkspaceRecordFilters) {
  const areaLabel = (record: RecordSummary) => {
    const area = units.find(unit => unit.id === record.orgUnitId), parent = units.find(unit => unit.id === area?.parentOrgUnitId);
    return [parent?.code, parent?.name, area?.code, area?.name].filter(Boolean).join(" / ");
  };
  const rows = records.filter(record => {
    const date = (record.recordDate || record.createdAt || "").slice(0, 10);
    return (!filters.mine || record.isCreatedByCurrentUser)
      && (filters.status === "all" || record.submissionStatus === filters.status)
      && (filters.area === "all" || (record.orgUnitId || "unassigned") === filters.area)
      && (filters.type === "all" || record.templateKey === filters.type)
      && (filters.theme === "all" || record.themeNames?.includes(filters.theme))
      && (filters.person === "all" || [record.ownerDisplayName, record.subjectDisplayName, record.submitterDisplayName].includes(filters.person))
      && (filters.participant === "all" || record.participantNames?.includes(filters.participant))
      && (filters.deliveryArea === "all" || record.deliveryAreaName === filters.deliveryArea)
      && (filters.room === "all" || (record.roomCode || record.roomName || "unassigned") === filters.room)
      && (!filters.from || Boolean(date) && date >= filters.from)
      && (!filters.to || Boolean(date) && date <= filters.to)
      && matchesListSearch(filters.search, record.title, record.summary, record.ownerDisplayName, record.subjectDisplayName, record.submitterDisplayName,
        record.templateName, record.themeNames, record.participantNames, record.roomCode, record.roomName, areaLabel(record),
        record.deliveryAreaName, record.submissionStatus.replaceAll("_", " "), record.recordDate, record.academicYear);
  });
  return sortListRows(rows, record => filters.sort === "title" ? record.title : filters.sort === "person" ? record.subjectDisplayName || record.ownerDisplayName
    : filters.sort === "area" ? areaLabel(record) : filters.sort === "status" ? record.submissionStatus : filters.sort === "type" ? record.templateName
    : filters.sort === "room" ? record.roomCode || record.roomName : (record.recordDate || record.createdAt) ? new Date(record.recordDate || record.createdAt) : undefined,
  filters.sort === "newest" ? "desc" : "asc", record => record.id);
}
