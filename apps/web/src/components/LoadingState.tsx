type LoadingStateProps = {
  label: string;
  size?: "page" | "section" | "inline";
  detail?: string;
  className?: string;
};

/** Mount only while a real request is pending. The illustration is decorative. */
export function LoadingState({ label, size = "section", detail, className = "" }: LoadingStateProps) {
  return <div className={`loading-state loading-state-${size} ${className}`.trim()} role="status" aria-live="polite" aria-atomic="true">
    {size !== "inline" ? <span className="loading-state-art" aria-hidden="true" /> : null}
    <div className="loading-state-copy"><strong>{label}</strong>{detail ? <p>{detail}</p> : null}</div>
    <span className="loading-state-dots" aria-hidden="true"><i /><i /><i /></span>
  </div>;
}
