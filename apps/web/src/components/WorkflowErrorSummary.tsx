import { useEffect, useRef } from "react";
import { focusWorkflowControl, type WorkflowFieldError } from "../services/workflowExperience";

export function WorkflowErrorSummary({ errors }: { errors: WorkflowFieldError[] }) {
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => { if (errors.length) summary.current?.focus(); }, [errors]);
  if (!errors.length) return null;
  const errorLink = (error: WorkflowFieldError) => <li id={`${error.id}-summary-error`} key={error.id}><button className="quiet-link" onClick={() => focusWorkflowControl(error.id)} type="button">{error.message}</button></li>;
  return <div className="workflow-error-summary" ref={summary} role="alert" tabIndex={-1}>
    <strong>{errors.length === 1 ? "Check this field" : `Check these ${errors.length} fields`} before continuing</strong>
    <ul>{errors.slice(0, 5).map(errorLink)}</ul>
    {errors.length > 5 ? <details><summary>Show {errors.length - 5} more fields to check</summary><ul>{errors.slice(5).map(errorLink)}</ul></details> : null}
  </div>;
}
