import { ChevronDown, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

type WorkflowFiltersProps = {
  children: ReactNode;
  primary: ReactNode;
  activeCount: number;
  onClear: () => void;
  label?: string;
  hasQuery?: boolean;
};

/** Search and order stay visible; the complete set of optional filters is one step away. */
export function WorkflowFilters({ children, primary, activeCount, onClear, label = "More filters", hasQuery = false }: WorkflowFiltersProps) {
  return <div className="workflow-filter-panel">
    <div className="workflow-filter-primary">{primary}</div>
    <div className="workflow-filter-options">
      <details className="workflow-filter-disclosure">
        <summary><SlidersHorizontal size={16} aria-hidden="true" /><span>{label}</span>{activeCount > 0 ? <span className="workflow-filter-count">{activeCount} active</span> : null}<ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="filter-toolbar">{children}</div>
      </details>
      {activeCount > 0 || hasQuery ? <button className="quiet-link" onClick={onClear} type="button">Clear filters</button> : null}
    </div>
  </div>;
}
