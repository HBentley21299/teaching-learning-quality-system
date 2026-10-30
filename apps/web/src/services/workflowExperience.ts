export type WorkflowFieldError = { id: string; message: string };

export function requiredWorkflowMessage(label: string) {
  const questionNumber = label.match(/^(\d+(?:\.\d+)+)\b/)?.[1];
  return questionNumber ? `Choose a response for question ${questionNumber}.`
    : `Complete ${label.trim().replace(/[.!?:]+$/, "")}.`;
}

/** Reveal a field inside a collapsed section before moving the keyboard to it. */
export function focusWorkflowControl(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === "DETAILS") (parent as HTMLDetailsElement).open = true;
  }
  const control = target.matches("input, select, textarea, button, [tabindex]")
    ? target : target.querySelector<HTMLElement>("input, select, textarea, button, [tabindex]");
  (control ?? target).focus({ preventScroll: true });
  target.scrollIntoView?.({ block: "center", behavior: "auto" });
}

/** Associate help and validation with the same control, without empty ARIA references. */
export function workflowDescription(helpId?: string, errorId?: string) {
  return [helpId, errorId].filter(Boolean).join(" ") || undefined;
}

/** Page only after the complete permitted list has been searched, filtered and ordered. */
export function paginateWorkflowRows<T>(rows: readonly T[], requestedPage: number, requestedPageSize = 25) {
  const pageSize = Number.isFinite(requestedPageSize) ? Math.max(1, Math.min(100, Math.trunc(requestedPageSize))) : 25;
  const totalCount = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.min(totalPages, Math.trunc(requestedPage))) : 1;
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalPages, totalCount };
}
