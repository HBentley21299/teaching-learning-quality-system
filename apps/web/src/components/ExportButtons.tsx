import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../design-system/Button";
import { api, type ExportFilters } from "../services/api";
import type { OrgUnitSummary } from "../services/types";

export function DashboardReportButton({ moduleKey, filters }: { moduleKey: string; filters: ExportFilters }) {
  const [isExporting, setIsExporting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const firstOption = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setIsOpen(false);
    setMessage("");
  }, [moduleKey]);

  useEffect(() => {
    if (isOpen) firstOption.current?.focus();
  }, [isOpen]);

  function closeMenu() {
    setIsOpen(false);
    trigger.current?.focus();
  }

  async function download(format: "pdf" | "xlsx") {
    setIsExporting(true);
    setMessage("");
    setIsOpen(false);
    try {
      const result = await api.exportDashboard(moduleKey, format, filters);
      if (!result.ok) setMessage(result.message ?? `The ${format === "pdf" ? "PDF" : "Excel"} report could not be created.`);
    } catch {
      setMessage("The report could not be created. Please try again.");
    } finally {
      setIsExporting(false);
      trigger.current?.focus();
    }
  }

  return <div className="export-control dashboard-report-control">
    <div className="qa-report-menu" onKeyDown={(event) => {
      if (event.key === "Escape" && isOpen) { event.preventDefault(); closeMenu(); }
    }}>
      <button aria-expanded={isOpen} className="button button-secondary qa-report-trigger" disabled={isExporting} onClick={() => setIsOpen((current) => !current)} ref={trigger} type="button">
        <Download aria-hidden="true" size={16} /><span>{isExporting ? "Preparing report…" : "Report"}</span><ChevronDown aria-hidden="true" size={15} />
      </button>
      {isOpen ? <>
        <button aria-label="Close report menu" className="qa-report-menu-backdrop" onClick={closeMenu} tabIndex={-1} type="button" />
        <div aria-label="Dashboard report formats" className="qa-report-menu-list">
          <button onClick={() => void download("pdf")} ref={firstOption} type="button"><FileText aria-hidden="true" size={18} /><span><strong>PDF dashboard report</strong><small>Dashboard measures and every drill-down expanded</small></span></button>
          <button onClick={() => void download("xlsx")} type="button"><FileSpreadsheet aria-hidden="true" size={18} /><span><strong>Excel form data</strong><small>One entry per row, with an answer column for each question</small></span></button>
          <p>Uses the dashboard filters and includes every page of results. Searching the detail table does not limit the export.</p>
        </div>
      </> : null}
    </div>
    {message ? <small className="error-copy" role="alert">{message}</small> : null}
  </div>;
}

type ExportExcelButtonProps = {
  moduleKey: string;
  filters?: ExportFilters;
  orgUnits?: OrgUnitSummary[];
};

export function ExportExcelButton({ moduleKey, filters, orgUnits = [] }: ExportExcelButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const origin = document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal();
    return () => { origin?.focus(); };
  }, [isOpen]);
  const options = useMemo(() => orgUnits
    .filter((unit) => unit.isActive && ["faculty", "team"].includes(unit.orgUnitType))
    .sort((left, right) => left.orgUnitType.localeCompare(right.orgUnitType) || left.code.localeCompare(right.code)), [orgUnits]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function open() {
    const facultyIds = options.filter((option) => option.orgUnitType === "faculty").map((option) => option.id);
    setSelectedIds(facultyIds.length > 0 ? facultyIds : options.map((option) => option.id));
    setMessage("");
    setIsOpen(true);
  }

  async function download() {
    setIsExporting(true);
    setMessage("");
    const selected = options.filter((option) => selectedIds.includes(option.id));
    const facultyCode = selected.filter((option) => option.orgUnitType === "faculty").map((option) => option.code).join(",");
    const teamCode = selected.filter((option) => option.orgUnitType === "team").map((option) => option.code).join(",");
    const result = await api.exportExcel(moduleKey, {
      ...filters,
      facultyCode: facultyCode || undefined,
      teamCode: teamCode || undefined
    }).catch(() => ({ ok: false, message: "The export could not be created. Please try again." }));
    setIsExporting(false);
    if (!result.ok) {
      setMessage(result.message ?? "The export could not be created.");
      return;
    }
    setIsOpen(false);
  }

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  const faculties = options.filter((option) => option.orgUnitType === "faculty");
  const teams = options.filter((option) => option.orgUnitType === "team");
  const dialog = isOpen ? (
    <dialog ref={dialogRef} aria-label="Choose records to export" aria-modal="true" className="export-filter-dialog" onCancel={event => { event.preventDefault(); if (!isExporting) setIsOpen(false); }}>
      <div className="export-filter-card">
        <div className="panel-heading">
          <div><h2>Export Active records</h2><span>Select the faculties and teams to include. A faculty includes all of its teams; clear faculties to choose individual teams.</span></div>
        </div>
        {options.length === 0 ? (
          <label className="export-scope-option"><input checked disabled type="checkbox" /><span>All records in my permitted scope</span></label>
        ) : (
          <div className="export-filter-groups">
            <ExportOptionGroup label="Faculties" onToggle={toggle} options={faculties} selectedIds={selectedIds} />
            <ExportOptionGroup label="Teams" onToggle={toggle} options={teams} selectedIds={selectedIds} />
          </div>
        )}
        <div className="export-filter-summary">
          <span>{options.length === 0 ? "Your existing record permissions will be applied." : `${selectedIds.length} of ${options.length} areas selected`}</span>
          {options.length > 0 ? (
            <span className="export-filter-shortcuts">
              <button onClick={() => setSelectedIds(options.map((option) => option.id))} type="button">Select all</button>
              <button onClick={() => setSelectedIds([])} type="button">Clear</button>
            </span>
          ) : null}
        </div>
        <div className="toolbar toolbar-end">
          <Button disabled={isExporting} onClick={() => setIsOpen(false)}>Cancel</Button>
          <Button disabled={isExporting || (options.length > 0 && selectedIds.length === 0)} icon={Download} onClick={() => void download()} variant="primary">
            {isExporting ? "Preparing..." : "Export selected records"}
          </Button>
        </div>
        {message ? <small aria-live="polite" className="error-copy">{message}</small> : null}
      </div>
    </dialog>
  ) : null;

  return (
    <>
      <span className="export-control">
        <Button disabled={isExporting} icon={Download} onClick={(event) => { event.preventDefault(); event.stopPropagation(); open(); }}>
          Export Excel
        </Button>
        {message ? <small aria-live="polite" className="error-copy">{message}</small> : null}
      </span>
      {dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}

function ExportOptionGroup({ label, onToggle, options, selectedIds }: {
  label: string;
  onToggle: (id: string) => void;
  options: OrgUnitSummary[];
  selectedIds: string[];
}) {
  if (options.length === 0) return null;
  return (
    <fieldset className="export-option-group">
      <legend>{label}</legend>
      {options.map((option) => (
        <label className="export-scope-option" key={option.id}>
          <input checked={selectedIds.includes(option.id)} onChange={() => onToggle(option.id)} type="checkbox" />
          <span><strong>{option.code}</strong>{option.name}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function ExportWordButton({ recordId }: { recordId: string }) {
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState("");

  async function download() {
    setIsExporting(true);
    setMessage("");
    const result = await api.exportRecordWord(recordId);
    setIsExporting(false);
    if (!result.ok) setMessage(result.message ?? "The report could not be created.");
  }

  return (
    <span className="export-control">
      <Button disabled={isExporting} icon={FileText} onClick={() => void download()}>
        {isExporting ? "Preparing..." : "Export Word"}
      </Button>
      {message ? <small aria-live="polite" className="error-copy">{message}</small> : null}
    </span>
  );
}
