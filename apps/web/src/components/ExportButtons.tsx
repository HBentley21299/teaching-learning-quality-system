import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../design-system/Button";
import { api, type ApiResult, type ExportFilters } from "../services/api";
import type { OrgUnitSummary } from "../services/types";
import { matchesListSearch, sortListRows } from "../services/listQuery";
import { ModalDialog } from "./ModalDialog";

export function DashboardReportButton({ moduleKey, filters }: { moduleKey: string; filters: ExportFilters }) {
  return <ReportButton scopeKey={JSON.stringify([moduleKey, filters])} downloadReport={format => api.exportDashboard(moduleKey, format, filters)} />;
}

export function ReportButton({ scopeKey, downloadReport, triggerLabel = "Export", pdfLabel = "PDF dashboard report", pdfDescription = "Dashboard measures and expanded details", excelLabel = "Excel form data", excelDescription = "Form columns, named people and linked details", hint = "Uses the dashboard filters and includes every page of results. Searching the detail table does not limit the export." }: {
  scopeKey: string;
  downloadReport: (format: "pdf" | "xlsx") => Promise<ApiResult>;
  triggerLabel?: string;
  pdfLabel?: string;
  pdfDescription?: string;
  excelLabel?: string;
  excelDescription?: string;
  hint?: string;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const firstOption = useRef<HTMLButtonElement>(null);
  const lastOption = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const request = useRef(0);
  const menuId = useId();

  useEffect(() => {
    setIsOpen(false);
    setMessage("");
    setIsExporting(false);
    request.current += 1;
    return () => { request.current += 1; };
  }, [scopeKey]);

  useEffect(() => {
    if (isOpen) (focusLast.current ? lastOption : firstOption).current?.focus();
  }, [isOpen]);

  function closeMenu() {
    setIsOpen(false);
    trigger.current?.focus();
  }

  async function download(format: "pdf" | "xlsx") {
    const currentRequest = ++request.current;
    setIsExporting(true);
    setMessage("");
    setIsOpen(false);
    try {
      const result = await downloadReport(format);
      if (!result.ok && request.current === currentRequest) setMessage(result.message ?? `The ${format === "pdf" ? "PDF" : "Excel"} report could not be created.`);
    } catch {
      if (request.current === currentRequest) setMessage("The report could not be created. Please try again.");
    } finally {
      if (request.current === currentRequest) { setIsExporting(false); trigger.current?.focus(); }
    }
  }

  return <div className="export-control dashboard-report-control">
    <div className="qa-report-menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }} onKeyDown={(event) => {
      if (event.key === "Escape" && isOpen) { event.preventDefault(); event.stopPropagation(); closeMenu(); }
      if (!isOpen || !menu.current?.contains(event.target as Node)) return;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const last = event.key === "End" || event.key === "ArrowUp" && document.activeElement === firstOption.current
          || event.key === "ArrowDown" && document.activeElement === firstOption.current;
        (last ? lastOption : firstOption).current?.focus();
      }
    }}>
      <button aria-expanded={isOpen} aria-haspopup="menu" aria-controls={isOpen ? menuId : undefined} className="button button-secondary qa-report-trigger" disabled={isExporting} onClick={() => { focusLast.current = false; setIsOpen((current) => !current); }} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); focusLast.current = event.key === "ArrowUp";
          if (isOpen) (focusLast.current ? lastOption : firstOption).current?.focus();
          setIsOpen(true);
        }
      }} ref={trigger} type="button">
        <Download aria-hidden="true" size={16} /><span>{isExporting ? "Preparing report…" : triggerLabel}</span><ChevronDown aria-hidden="true" size={15} />
      </button>
      {isOpen ? <>
        <button aria-label="Close report menu" className="qa-report-menu-backdrop" onClick={closeMenu} tabIndex={-1} type="button" />
        <div aria-label="Report formats" className="qa-report-menu-list" id={menuId} role="menu" ref={menu}>
          <button onClick={() => void download("pdf")} ref={firstOption} role="menuitem" type="button"><FileText aria-hidden="true" size={18} /><span><strong>{pdfLabel}</strong><small>{pdfDescription}</small></span></button>
          <button onClick={() => void download("xlsx")} ref={lastOption} role="menuitem" type="button"><FileSpreadsheet aria-hidden="true" size={18} /><span><strong>{excelLabel}</strong><small>{excelDescription}</small></span></button>
          {hint ? <p role="none">{hint}</p> : null}
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
  const [areaSearch, setAreaSearch] = useState("");
  const [areaStatus, setAreaStatus] = useState("");
  const [areaSort, setAreaSort] = useState("code");
  const [areaDirection, setAreaDirection] = useState<"asc" | "desc">("asc");
  const options = useMemo(() => orgUnits
    .filter((unit) => ["faculty", "team", "faculty_child", "faculty_child_code"].includes(unit.orgUnitType)), [orgUnits]);
  const visibleOptions = sortListRows(options.filter(unit => matchesListSearch(areaSearch, unit.code, unit.name,
    orgUnits.find(parent => parent.id === unit.parentOrgUnitId)?.name, unit.isActive ? "Active" : "Inactive")
    && (!areaStatus || unit.isActive === (areaStatus === "active"))), unit => areaSort === "name" ? unit.name : unit.code, areaDirection, unit => unit.id);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function open() {
    const facultyIds = options.filter((option) => option.orgUnitType === "faculty").map((option) => option.id);
    setSelectedIds(facultyIds.length > 0 ? facultyIds : options.map((option) => option.id));
    setMessage("");
    setAreaSearch(""); setAreaStatus("");
    setIsOpen(true);
  }

  async function download() {
    setIsExporting(true);
    setMessage("");
    const selected = options.filter((option) => selectedIds.includes(option.id));
    const facultyCode = selected.filter((option) => option.orgUnitType === "faculty").map((option) => option.code).join(",");
    const teamCode = selected.filter((option) => option.orgUnitType !== "faculty").map((option) => option.code).join(",");
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

  const faculties = visibleOptions.filter((option) => option.orgUnitType === "faculty");
  const teams = visibleOptions.filter((option) => option.orgUnitType !== "faculty");
  const dialog = isOpen ? (
    <ModalDialog label="Choose records to export" className="export-selection-dialog" busy={isExporting} onClose={() => { if (!isExporting) setIsOpen(false); }}>
      <div className="export-selection-content">
        <div className="panel-heading">
          <div><h2 tabIndex={-1} data-dialog-heading>Export Excel</h2><span>Select the faculties and teams to include. A faculty includes all of its teams; clear faculties to choose individual teams.</span></div>
        </div>
        {options.length > 0 ? <div className="profile-list-controls">
          <label><span>Search export areas</span><input type="search" value={areaSearch} onChange={event => setAreaSearch(event.target.value)} placeholder="Code, name or parent area" /></label>
          <label><span>Area status</span><select value={areaStatus} onChange={event => setAreaStatus(event.target.value)}><option value="">Active and historical</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
          <label><span>Sort by</span><select value={areaSort} onChange={event => setAreaSort(event.target.value)}><option value="code">Area code</option><option value="name">Area name</option></select></label>
          <label><span>Direction</span><select value={areaDirection} onChange={event => setAreaDirection(event.target.value as "asc" | "desc")}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
          <small role="status">{visibleOptions.length} matching areas. Selected areas outside this search remain included.</small>
        </div> : null}
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
          <Button busy={isExporting} disabled={options.length > 0 && selectedIds.length === 0} icon={Download} onClick={() => void download()} variant="primary">
            {isExporting ? "Preparing..." : "Export selected records"}
          </Button>
        </div>
        {message ? <small role="alert" className="error-copy">{message}</small> : null}
      </div>
    </ModalDialog>
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
          <span><strong>{option.code}</strong>{option.name}{!option.isActive ? " · Inactive" : ""}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function ExportWordButton({ recordId }: { recordId: string }) {
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef(0);
  useEffect(() => {
    request.current += 1; setIsExporting(false); setMessage("");
    return () => { request.current += 1; };
  }, [recordId]);

  async function download() {
    const currentRequest = ++request.current;
    setIsExporting(true);
    setMessage("");
    try {
      const result = await api.exportRecordWord(recordId);
      if (!result.ok && request.current === currentRequest) setMessage(result.message ?? "The report could not be created.");
    } catch {
      if (request.current === currentRequest) setMessage("The report could not be created. Please try again.");
    } finally {
      if (request.current === currentRequest) setIsExporting(false);
    }
  }

  return (
    <span className="export-control">
      <Button busy={isExporting} icon={FileText} onClick={() => void download()}>
        {isExporting ? "Preparing..." : "Export Word"}
      </Button>
      {message ? <small role="alert" className="error-copy">{message}</small> : null}
    </span>
  );
}
