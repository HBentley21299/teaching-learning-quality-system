import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "../design-system/Button";
import { paginateWorkflowRows } from "../services/workflowExperience";

export function useWorkflowPagination<T>(rows: readonly T[], queryKey: string) {
  const [position, setPosition] = useState({ page: 1, queryKey });
  const result = paginateWorkflowRows(rows, position.queryKey === queryKey ? position.page : 1);
  return { ...result, setPage: (page: number) => setPosition({ page, queryKey }) };
}

type WorkflowPaginationProps = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  setPage: (page: number) => void;
  label: string;
};

export function WorkflowPagination({ page, pageSize, totalPages, totalCount, setPage, label }: WorkflowPaginationProps) {
  if (totalPages <= 1) return null;
  return <nav className="pagination-controls workflow-pagination" aria-label={`${label} pages`}>
    <span role="status" aria-live="polite">Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} of {totalCount}</span>
    <div className="toolbar">
      <Button disabled={page <= 1} icon={ChevronLeft} onClick={() => setPage(page - 1)}>Previous</Button>
      <label><span className="sr-only">{label} page</span><select aria-label={`${label} page`} value={page} onChange={event => setPage(Number(event.target.value))}>{Array.from({ length: totalPages }, (_, index) => <option key={index + 1} value={index + 1}>Page {index + 1} of {totalPages}</option>)}</select></label>
      <Button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next <ChevronRight size={16} aria-hidden="true" /></Button>
    </div>
  </nav>;
}
