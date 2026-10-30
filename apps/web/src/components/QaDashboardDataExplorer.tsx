import { useCallback } from "react";
import { api } from "../services/api";
import { DashboardDataExplorer } from "./DashboardDataExplorer";

type QaDashboardDataExplorerProps = {
  reviewId: string;
  academicYear: string;
  facultyOrgUnitId?: string;
  teamOrgUnitId?: string;
  onOpenEvidence: (evidenceId: string) => void;
};

/** Uses the review export's submitted-only dataset, reporting exclusions and evidence access checks in one bulk request. */
export function QaDashboardDataExplorer({ reviewId, academicYear, facultyOrgUnitId, teamOrgUnitId, onOpenEvidence }: QaDashboardDataExplorerProps) {
  const loadData = useCallback(() => api.qaDashboardRecordData(reviewId, facultyOrgUnitId, teamOrgUnitId), [reviewId, facultyOrgUnitId, teamOrgUnitId]);
  return <DashboardDataExplorer key={reviewId} processKey="qa_review" academicYear={academicYear} loadData={loadData} onOpenEntry={onOpenEvidence} />;
}
