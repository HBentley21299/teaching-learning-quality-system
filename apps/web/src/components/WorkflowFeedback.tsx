import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

type WorkflowFeedbackProps = {
  message?: string;
  tone?: "neutral" | "success" | "error";
  onDismiss?: () => void;
};

/** Keep feedback in one predictable place and announce updates without stealing focus. */
export function WorkflowFeedback({ message, tone = "neutral", onDismiss }: WorkflowFeedbackProps) {
  if (!message) return null;
  const Icon = tone === "error" ? TriangleAlert : tone === "success" ? CheckCircle2 : Info;
  return <div className={`notice-row workflow-feedback is-${tone}`} role={tone === "error" ? "alert" : "status"} aria-atomic="true">
    <Icon size={18} aria-hidden="true" />
    <span>{message}</span>
    {onDismiss ? <button aria-label="Dismiss message" className="icon-button" onClick={onDismiss} type="button"><X size={16} aria-hidden="true" /></button> : null}
  </div>;
}
