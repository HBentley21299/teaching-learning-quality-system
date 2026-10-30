import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LoadingState } from "./LoadingState";

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
  toolbar?: ReactNode;
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
  persistState?: boolean;
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
  toolbar,
  onExpandedChange,
  className = "",
  persistState = true
}: CollapsibleSectionProps) {
  const contentId = useId();
  const expandedChangeRef = useRef(onExpandedChange);
  const [expanded, setExpanded] = useState(() => persistState ? readSessionState(storageKey, defaultExpanded) : defaultExpanded);

  expandedChangeRef.current = onExpandedChange;

  useEffect(() => {
    setExpanded(persistState ? readSessionState(storageKey, defaultExpanded) : defaultExpanded);
  }, [defaultExpanded, persistState, storageKey]);

  useEffect(() => {
    expandedChangeRef.current?.(expanded);
  }, [expanded]);

  function toggle() {
    setExpanded((current) => {
      const next = !current;
      if (persistState) {
        try { window.sessionStorage.setItem(`collapse:${storageKey}`, next ? "open" : "closed"); }
        catch { /* Expanding a section must still work when storage is disabled. */ }
      }
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
        <div className="collapsible-section-content" id={contentId} hidden={!expanded} aria-busy={expanded && isLoading || undefined}>
          {expanded ? <>
          {toolbar}
          {isLoading ? <LoadingState label={`Loading ${title.toLocaleLowerCase()}`} /> : null}
          {!isLoading && error ? <div className="section-state section-state-error" role="alert">{error}</div> : null}
          {!isLoading && !error && isEmpty ? <div className="section-state">{emptyMessage}</div> : null}
          {!isLoading && !error && !isEmpty ? children : null}
          </> : null}
        </div>
    </section>
  );
}

export function Pagination({ page, totalPages, onPageChange, label = "Pagination" }: { page: number; totalPages: number; onPageChange: (page: number) => void; label?: string }) {
  if (totalPages <= 1) return null;
  const currentPage = Math.max(1, Math.min(page, totalPages));
  return (
    <nav aria-label={label} className="pagination-controls">
      <button aria-label="Previous page" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)} type="button"><ChevronLeft aria-hidden="true" size={17} /></button>
      <span aria-live="polite" aria-atomic="true">Page {currentPage} of {totalPages}</span>
      <button aria-label="Next page" disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)} type="button"><ChevronRight aria-hidden="true" size={17} /></button>
    </nav>
  );
}

function readSessionState(storageKey: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.sessionStorage.getItem(`collapse:${storageKey}`);
    return stored === "open" ? true : stored === "closed" ? false : fallback;
  } catch { return fallback; }
}
