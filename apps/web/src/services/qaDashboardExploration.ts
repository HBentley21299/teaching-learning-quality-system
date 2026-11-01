import type { QaDashboardQuestionBreakdown } from "./types";

export type QaCriterionOutcome = "all" | "below" | "at" | "above" | "not_seen" | "not_applicable";
export type QaCriterionSort = "attention" | "strength" | "responses" | "question";
export type QaDashboardExploration = {
  process: string; theme: string; outcome: QaCriterionOutcome; search: string; criterion: string; sort: QaCriterionSort;
};
export const emptyQaDashboardExploration: QaDashboardExploration = { process: "all", theme: "all", outcome: "all", search: "", criterion: "all", sort: "attention" };
export const qaCriterionKey = (question: QaDashboardQuestionBreakdown) => `${question.activityKey}:${question.questionId}`;
export const qaCriterionTheme = (question: QaDashboardQuestionBreakdown) => question.themeOrWeek?.trim() || "Other";
export const qaRatedPercentage = (count: number, rated: number) => rated > 0 ? Math.round(count * 1000 / rated) / 10 : null;

export function qaOutcomeCount(question: QaDashboardQuestionBreakdown, outcome: QaCriterionOutcome) {
  if (outcome === "not_seen") return question.notSeen ?? 0;
  if (outcome === "not_applicable") return question.notApplicable;
  return outcome === "all" ? question.rated + question.notApplicable + (question.notSeen ?? 0) : question[outcome];
}

export function filterQaDashboardCriteria(questions: QaDashboardQuestionBreakdown[], exploration: QaDashboardExploration) {
  const terms = exploration.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return questions.filter(question => {
    const haystack = `${question.activityLabel} ${qaCriterionTheme(question)} ${question.questionText}`.toLocaleLowerCase();
    return (exploration.process === "all" || question.activityKey === exploration.process)
      && (exploration.theme === "all" || qaCriterionTheme(question) === exploration.theme)
      && (exploration.criterion === "all" || qaCriterionKey(question) === exploration.criterion)
      && (exploration.outcome === "all" || qaOutcomeCount(question, exploration.outcome) > 0)
      && terms.every(term => haystack.includes(term));
  }).sort((left, right) => {
    if (exploration.sort === "attention") return right.below - left.below || (qaRatedPercentage(right.below, right.rated) ?? -1) - (qaRatedPercentage(left.below, left.rated) ?? -1) || right.rated - left.rated || left.questionText.localeCompare(right.questionText);
    if (exploration.sort === "strength") return right.at + right.above - left.at - left.above || (qaRatedPercentage(right.at + right.above, right.rated) ?? -1) - (qaRatedPercentage(left.at + left.above, left.rated) ?? -1) || right.rated - left.rated || left.questionText.localeCompare(right.questionText);
    if (exploration.sort === "responses") return right.rated - left.rated || left.questionText.localeCompare(right.questionText);
    return left.questionText.localeCompare(right.questionText);
  });
}

// A response belongs to one criterion. Team aggregates can overlap for shared
// submissions, so totals are deliberately calculated from criteria, never teams.
export function qaCriteriaTotals(questions: QaDashboardQuestionBreakdown[]) {
  const totals = questions.reduce((sum, question) => ({
    below: sum.below + question.below, at: sum.at + question.at, above: sum.above + question.above,
    notSeen: sum.notSeen + (question.notSeen ?? 0), notApplicable: sum.notApplicable + question.notApplicable,
    rated: sum.rated + question.rated
  }), { below: 0, at: 0, above: 0, notSeen: 0, notApplicable: 0, rated: 0 });
  return { ...totals, atOrAbovePercentage: qaRatedPercentage(totals.at + totals.above, totals.rated) };
}

export function qaThemeBreakdown(questions: QaDashboardQuestionBreakdown[]) {
  const groups = new Map<string, QaDashboardQuestionBreakdown[]>();
  for (const question of questions) {
    const theme = qaCriterionTheme(question);
    groups.set(theme, [...(groups.get(theme) ?? []), question]);
  }
  return [...groups].map(([key, items]) => ({ key, label: key, criteria: items.length, ...qaCriteriaTotals(items) }))
    .sort((left, right) => right.below - left.below || right.rated - left.rated || left.label.localeCompare(right.label));
}
