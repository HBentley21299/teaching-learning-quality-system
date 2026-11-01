import type { ProcessReviewAction, ProcessReviewSummary } from "./processReviewTypes";
import { activateSkillsScore } from "./processReviewReporting";

export type ProcessReviewExploration = { category: string; coverage: string; attention: boolean; actionImpact?: string; actionOverdue?: boolean };
export const emptyProcessReviewExploration: ProcessReviewExploration = { category: "", coverage: "", attention: false };
export const categoryIdentity = (key: string, title: string) => JSON.stringify([key, title]);
export function uniqueProcessReviews(rows: readonly ProcessReviewSummary[]) {
  return [...new Map(rows.map(row => [row.recordId, row])).values()];
}
export function reviewActions(rows: readonly ProcessReviewSummary[], actions: readonly ProcessReviewAction[]) {
  const ids = new Set(rows.map(row => row.recordId));
  return [...new Map(actions.filter(action => ids.has(action.recordId) || action.associatedReviewIds?.some(id => ids.has(id))).map(action => [action.actionId, action])).values()];
}
export function isOpenReviewAction(action: ProcessReviewAction) { return !["complete", "cancelled"].includes(action.progress); }
export function isOverdueReviewAction(action: ProcessReviewAction, today: string) {
  const due = action.reviewDate || action.dueDate;
  return isOpenReviewAction(action) && /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today;
}
export function scanEntryCount(review: ProcessReviewSummary) {
  return review.skillsScanScores == null ? null : Object.values(review.skillsScanScores).filter(value => activateSkillsScore(value) !== null).length;
}
export function reviewAttention(review: ProcessReviewSummary, actions: readonly ProcessReviewAction[], today: string) {
  const related = reviewActions([review], actions), overdue = related.filter(action => isOverdueReviewAction(action, today));
  const reasons: string[] = [];
  if (overdue.length) reasons.push(`${overdue.length} overdue ${overdue.length === 1 ? "action" : "actions"}`);
  if (review.processKey === "digital_learning_walk" && review.statementCount > review.ratedStatementCount) reasons.push(`${review.statementCount - review.ratedStatementCount} selected criteria not rated`);
  if (review.status === "draft") reasons.push("Draft to complete");
  if (review.followUpDate && review.followUpDate <= today && !review.followUpReviews?.length) reasons.push("Planned follow-up due");
  return { review, reasons, priority: overdue.length ? 0 : review.status === "draft" ? 1 : 2 };
}
export function filterReviewExploration(rows: readonly ProcessReviewSummary[], exploration: ProcessReviewExploration, actions: readonly ProcessReviewAction[], today: string) {
  return uniqueProcessReviews(rows).filter(review => (!exploration.category || review.selectedStandards?.some(standard => categoryIdentity(standard.key, standard.title) === exploration.category))
    && (!exploration.coverage || (review.processKey === "digital_learning_walk"
      ? exploration.coverage === "complete" ? review.statementCount > 0 && review.ratedStatementCount === review.statementCount : review.statementCount === 0 || review.ratedStatementCount < review.statementCount
      : exploration.coverage === "complete" ? scanEntryCount(review) === 15 : exploration.coverage === "earlier" ? scanEntryCount(review) === null : scanEntryCount(review) !== null && scanEntryCount(review)! < 15))
    && (!exploration.attention || reviewAttention(review, actions, today).reasons.length > 0));
}
export function filterActionExploration(actions: readonly ProcessReviewAction[], exploration: ProcessReviewExploration, today: string) {
  return [...new Map(actions.filter(action => (!exploration.actionImpact || action.impactStatus === exploration.actionImpact)
    && (!exploration.actionOverdue || isOverdueReviewAction(action, today))).map(action => [action.actionId, action])).values()];
}

/** Counts meetings, included criteria and central actions at their own grains; never averages practice or Skills Scan scores. */
export function processReviewInsightModel(source: readonly ProcessReviewSummary[], actions: readonly ProcessReviewAction[], today: string) {
  const rows = uniqueProcessReviews(source), linkedActions = reviewActions(rows, actions);
  const categories = new Map<string, { key: string; label: string; value: number; included: number; partial: number }>();
  for (const review of rows) for (const standard of review.selectedStandards ?? []) {
    const key = categoryIdentity(standard.key, standard.title), group = categories.get(key) || { key, label: standard.title, value: 0, included: 0, partial: 0 };
    group.value++; group.included += standard.selectedStatementCount;
    if (standard.selectedStatementCount < standard.statementCount) group.partial++;
    categories.set(key, group);
  }
  const selectedCriteria = rows.reduce((sum, row) => sum + row.statementCount, 0), ratedCriteria = rows.reduce((sum, row) => sum + row.ratedStatementCount, 0);
  const validCoverage = rows.every(row => row.statementCount >= 0 && row.ratedStatementCount >= 0 && row.ratedStatementCount <= row.statementCount);
  return { rows, total: rows.length, submitted: rows.filter(row => row.status === "submitted").length,
    drafts: rows.filter(row => row.status === "draft").length, initial: rows.filter(row => !row.isFollowUp).length, followUp: rows.filter(row => row.isFollowUp).length,
    selectedCriteria, ratedCriteria, ratingCoverage: validCoverage && selectedCriteria ? Math.round(ratedCriteria * 100 / selectedCriteria) : null,
    fullRatingReviews: rows.filter(row => row.statementCount > 0 && row.ratedStatementCount === row.statementCount).length,
    completeScans: rows.filter(row => scanEntryCount(row) === 15).length,
    partialScans: rows.filter(row => scanEntryCount(row) !== null && scanEntryCount(row)! < 15).length,
    earlierScans: rows.filter(row => scanEntryCount(row) === null).length,
    categories: [...categories.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    unknownCategoryReviews: rows.filter(row => row.selectedStandards == null).length,
    actions: linkedActions, openActions: linkedActions.filter(isOpenReviewAction), overdueActions: linkedActions.filter(action => isOverdueReviewAction(action, today)),
    attention: rows.map(row => reviewAttention(row, actions, today)).filter(item => item.reasons.length).sort((a, b) => a.priority - b.priority || (a.review.recordDate || "9999").localeCompare(b.review.recordDate || "9999") || a.review.recordId.localeCompare(b.review.recordId)) };
}
