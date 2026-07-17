import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type CollapsibleSectionProps = {
  storageKey: string;
  title: string;
  count?: number;
  statusSummary?: string;
  defaultExpanded?: boolean;
  isLoading?: boolean;
  error?: string;
  emptyMessage?: string;
  isEmpty?: boolean;
  children: ReactNode;
  actions?: ReactNode;
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
};

export function CollapsibleSection({
  storageKey,
  title,
  count,
  statusSummary,
  defaultExpanded = false,
  isLoading = false,
  error,
  emptyMessage = "No records are available.",
  isEmpty = false,
  children,
  actions,
  onExpandedChange,
  className = ""
}: CollapsibleSectionProps) {
  const contentId = useId();
  const expandedChangeRef = useRef(onExpandedChange);
  const [expanded, setExpanded] = useState(() => readSessionState(storageKey, defaultExpanded));

  expandedChangeRef.current = onExpandedChange;

  useEffect(() => {
    setExpanded(readSessionState(storageKey, defaultExpanded));
  }, [defaultExpanded, storageKey]);

  useEffect(() => {
    expandedChangeRef.current?.(expanded);
  }, [expanded]);

  function toggle() {
    setExpanded((current) => {
      const next = !current;
      window.sessionStorage.setItem(`collapse:${storageKey}`, next ? "open" : "closed");
      return next;
    });
  }

  return (
    <section className={`panel collapsible-section ${expanded ? "is-expanded" : ""} ${className}`.trim()}>
      <div className="collapsible-section-header">
        <button aria-controls={contentId} aria-expanded={expanded} onClick={toggle} type="button">
          <span>
            <strong>{title}</strong>
            {statusSummary ? <small>{statusSummary}</small> : null}
          </span>
          {typeof count === "number" ? <span className="collapsible-count">{count}</span> : null}
          <ChevronDown aria-hidden="true" size={18} />
        </button>
        {actions ? <div className="collapsible-section-actions">{actions}</div> : null}
      </div>
      {expanded ? (
        <div className="collapsible-section-content" id={contentId}>
          {isLoading ? <div className="section-state" role="status">Loading records...</div> : null}
          {!isLoading && error ? <div className="section-state section-state-error" role="alert">{error}</div> : null}
          {!isLoading && !error && isEmpty ? <div className="section-state">{emptyMessage}</div> : null}
          {!isLoading && !error && !isEmpty ? children : null}
        </div>
      ) : null}
    </section>
  );
}

export function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="pagination-controls">
      <button aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)} title="Previous page" type="button"><ChevronLeft size={17} /></button>
      <span>Page {page} of {totalPages}</span>
      <button aria-label="Next page" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} title="Next page" type="button"><ChevronRight size={17} /></button>
    </nav>
  );
}

function readSessionState(storageKey: string, fallback: boolean) {
  const stored = window.sessionStorage.getItem(`collapse:${storageKey}`);
  return stored === "open" ? true : stored === "closed" ? false : fallback;
}
