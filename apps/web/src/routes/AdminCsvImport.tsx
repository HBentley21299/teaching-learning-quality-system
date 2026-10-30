import { ScrollableTableRegion } from "../components/ScrollableTableRegion";
import { LoadingState } from "../components/LoadingState";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Search, Upload, X } from "lucide-react";
import { Button } from "../design-system/Button";
import { ModalDialog } from "../components/ModalDialog";
import { Pagination } from "../components/CollapsibleSection";
import { useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { api } from "../services/api";
import { canUseAdminCsvImport, csvImportDownloadText, readCsvImportFile, saveCsvImportDownload } from "../services/csvImportPresentation";
import type { AdminCsvImportKind, AdminCsvImportMetadata, AdminCsvImportPreview, AdminCsvImportResult, CurrentUser } from "../services/types";
import { AdminListSort } from "../components/AdminListSort";
import { matchesListSearch, sortListRows } from "../services/listQuery";

type Props = {
  kind: AdminCsvImportKind;
  user: CurrentUser;
  onDirtyChange?: (dirty: boolean, saving?: boolean) => void;
  onOpenDestination?: (path: string) => void | Promise<void>;
};
type SelectedCsv = { scope: string; version: number; name: string; csv: string };
const pageSize = 20;

export function AdminCsvImport({ kind, user, onDirtyChange, onOpenDestination }: Props) {
  const allowed = canUseAdminCsvImport(user, kind);
  const scope = JSON.stringify([kind, user.userAccountId, user.isAdministrator, user.permissions]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const mounted = useRef(true);
  const operation = useRef(0), metadataRequest = useRef(0), templateRequest = useRef(0), applyInFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [metadataState, setMetadata] = useState<{ scope: string; value: AdminCsvImportMetadata } | null>(null);
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [metadataError, setMetadataError] = useState<{ scope: string; message: string } | null>(null);
  const [selection, setSelection] = useState<SelectedCsv | null>(null);
  const [previewState, setPreview] = useState<{ scope: string; version: number; value: AdminCsvImportPreview } | null>(null);
  const [busy, setBusy] = useState<"file" | "preview" | "apply" | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [error, setError] = useState("");
  const [completion, setCompletion] = useState<AdminCsvImportResult | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("row-asc");
  const [page, setPage] = useState(1);
  const [referenceQueries, setReferenceQueries] = useState<Record<number, string>>({});
  const [referenceSorts, setReferenceSorts] = useState<Record<number, string>>({});
  const metadata = metadataState?.scope === scope ? metadataState.value : null;
  const file = selection?.scope === scope ? selection : null;
  const preview = previewState?.scope === scope && previewState.version === file?.version ? previewState.value : null;
  const dirty = Boolean(file) || busy === "file" || busy === "preview";
  const applying = busy === "apply";

  function clearFile() {
    ++operation.current; setSelection(null); setPreview(null); setBusy(null); setError(""); setConfirmation(false); setQuery(""); setFilter("all"); setPage(1);
    if (fileInput.current) fileInput.current.value = "";
  }
  // A staged import deliberately has no onSave: navigation must never commit a batch on the user's behalf.
  const clearGuard = useUnsavedChanges({ label: "CSV import preview", dirty, saving: applying, onDiscard: clearFile });
  useEffect(() => { onDirtyChange?.(dirty || applying, applying); }, [dirty, applying, onDirtyChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++operation.current; ++metadataRequest.current; ++templateRequest.current; }; }, []);

  useEffect(() => {
    const request = ++metadataRequest.current;
    clearFile(); setCompletion(null); setMetadata(null); setMetadataError(null); setTemplateBusy(false); setReferenceQueries({});
    if (!allowed) return;
    void api.csvImportMetadata(kind).then(value => {
      if (value.kind !== kind) throw new Error("The import definition did not match this page. Reload and try again.");
      if (mounted.current && request === metadataRequest.current && currentScope.current === scope) setMetadata({ scope, value });
    }).catch(reason => {
      if (mounted.current && request === metadataRequest.current && currentScope.current === scope) setMetadataError({ scope, message: reason instanceof Error ? reason.message : "The import template and reference values could not be loaded." });
    });
  }, [scope, allowed, metadataAttempt, kind]);

  function current(request: number, requestedScope = scope) { return mounted.current && request === operation.current && currentScope.current === requestedScope; }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    if (applyInFlight.current) return;
    const next = event.target.files?.[0];
    const request = ++operation.current;
    setSelection(null); setPreview(null); setError(""); setCompletion(null); setConfirmation(false); setQuery(""); setFilter("all"); setPage(1);
    if (!next) { setBusy(null); return; }
    setBusy("file");
    try {
      const csv = await readCsvImportFile(next);
      if (current(request)) setSelection({ scope, version: request, name: next.name, csv });
    } catch (reason) {
      if (current(request)) { setError(reason instanceof Error ? reason.message : "The file could not be read. Choose it again."); if (fileInput.current) fileInput.current.value = ""; }
    } finally { if (current(request)) setBusy(null); }
  }

  async function validate() {
    if (!file || !metadata || applying) return;
    const selected = file, request = ++operation.current;
    setBusy("preview"); setPreview(null); setError(""); setConfirmation(false); setCompletion(null);
    try {
      const result = await api.previewCsvImport(kind, selected.csv);
      if (!current(request)) return;
      if (!result.ok || !result.data) { setError(result.message ?? "The file could not be checked. Your selected file is still here; retry the preview."); return; }
      if (result.data.kind !== kind) { setError("The preview did not match this import. Check the file again."); return; }
      setPreview({ scope, version: selected.version, value: result.data }); setPage(1);
    } catch (reason) { if (current(request)) setError(reason instanceof Error ? reason.message : "The file could not be checked. Retry the preview."); }
    finally { if (current(request)) setBusy(null); }
  }

  async function apply() {
    if (!file || !preview?.canImport || !preview.previewToken || !confirmation || busy || applyInFlight.current) return;
    const selected = file, token = preview.previewToken, request = ++operation.current;
    applyInFlight.current = true; setBusy("apply"); setError("");
    try {
      const result = await api.applyCsvImport(kind, selected.csv, token);
      if (!current(request)) return;
      if (!result.ok || !result.data) { setError(result.message ?? "The import could not be completed. Keep this file and preview, then retry."); return; }
      const completed = result.data;
      clearFile(); clearGuard(); setCompletion(completed);
    } catch (reason) { if (current(request)) setError(reason instanceof Error ? reason.message : "The import could not be completed. Keep this preview and retry."); }
    finally { applyInFlight.current = false; if (current(request)) setBusy(null); }
  }

  async function downloadTemplate() {
    const request = ++templateRequest.current, requestedScope = scope;
    setTemplateBusy(true); setError("");
    try {
      const result = await api.csvImportTemplate(kind);
      if (mounted.current && request === templateRequest.current && currentScope.current === requestedScope && !result.ok) setError(result.message ?? "The blank template could not be downloaded. Retry the download.");
    } catch { if (mounted.current && currentScope.current === requestedScope) setError("The blank template could not be downloaded. Retry the download."); }
    finally { if (mounted.current && request === templateRequest.current && currentScope.current === requestedScope) setTemplateBusy(false); }
  }

  const errors = preview?.issues.filter(issue => issue.severity === "error") ?? [];
  const warnings = preview?.issues.filter(issue => issue.severity === "warning") ?? [];
  const information = preview?.issues.filter(issue => issue.severity === "info") ?? [];
  const problemRows = new Set(errors.map(issue => issue.rowNumber));
  const matchingRows = useMemo(() => {
    return sortListRows((preview?.rows ?? []).filter(row => (filter === "all" || (filter === "errors" ? problemRows.has(row.rowNumber) : row.operation.toLocaleLowerCase() === filter))
      && matchesListSearch(query, row.reference, row.rowNumber, row.operation, Object.values(row.values))), row => sort.startsWith("reference") ? row.reference : sort.startsWith("operation") ? row.operation : row.rowNumber, sort.endsWith("desc") ? "desc" : "asc", row => row.rowNumber);
  }, [preview, query, filter, sort]);
  const totalPages = Math.max(1, Math.ceil(matchingRows.length / pageSize)), currentPage = Math.min(page, totalPages);
  const rows = matchingRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const returnPath = kind === "qa-questions" ? "/qa-hub/admin/questions" : kind === "cpd-events" ? "/cpd" : "/admin/all-lists";
  const returnLabel = kind === "qa-questions" ? "Open question bank" : kind === "cpd-events" ? "Open CPD records" : "Open managed lists";

  if (!allowed) return <section className="access-denied-panel"><AlertTriangle size={22}  aria-hidden="true"/><div><h2>CSV import unavailable</h2><p>An administrator account with permission to manage this data is required.</p></div></section>;
  if (!metadata) return <section className="panel admin-csv-import"><h2>CSV import</h2>{metadataError?.scope === scope ? <><p role="alert">{metadataError.message}</p><Button icon={RefreshCw} onClick={() => setMetadataAttempt(value => value + 1)}>Retry import setup</Button></> : <LoadingState label="Loading import setup" detail="Retrieving the template and current reference values." />}</section>;

  return <div className="route-stack admin-csv-import">
    <section className="panel csv-import-introduction"><div className="panel-heading"><div><p className="eyebrow">Administrator import</p><h2>{metadata.title}</h2><p>{metadata.description}</p></div><FileSpreadsheet size={28} aria-hidden="true" /></div>
      <ol className="csv-import-steps"><li>Download the template and check reference values.</li><li>Upload your file and review every row.</li><li>Confirm the batch to add the new entries.</li></ol>
      {metadata.notes.length ? <ul className="csv-import-notes">{metadata.notes.map((note, index) => <li key={index}>{note}</li>)}</ul> : null}
      <div className="toolbar"><Button icon={Download} disabled={templateBusy || applying} onClick={() => void downloadTemplate()}>{templateBusy ? "Downloading template…" : "Download blank template"}</Button><Button disabled={applying} icon={Download} onClick={() => saveCsvImportDownload(`${kind}-example.csv`, csvImportDownloadText(metadata.columns.map(column => column.key), [metadata.columns.map(column => column.example ?? "")]))}>Download example row</Button></div><p className="muted-copy">Use CSV UTF-8, up to 1 MiB and 1,000 data rows. Keep the template column headings. Example values show the format; replace them with your own reference values.</p>
      <details className="csv-import-column-guide"><summary>Column guide · {metadata.columns.length} columns</summary><ScrollableTableRegion label="CSV import data"><table aria-label="CSV import data"><thead><tr><th scope="col">CSV column</th><th scope="col">Field</th><th scope="col">Required</th><th scope="col">How to complete it</th><th scope="col">Example</th></tr></thead><tbody>{metadata.columns.map(column => <tr key={column.key}><td><code>{column.key}</code></td><td>{column.label}</td><td>{column.required ? "Yes" : "No"}</td><td>{column.description}</td><td>{column.example || "—"}</td></tr>)}</tbody></table></ScrollableTableRegion></details>
    </section>

    {metadata.references.length ? <section className="panel csv-import-references"><h3>Current reference values</h3><p>Use these codes and names when preparing the file. Downloads include all supplied rows; each reference list identifies any source limit.</p>{metadata.references.map((reference, index) => {
      const search = referenceQueries[index] ?? "";
      const referenceSort = referenceSorts[index] ?? "source";
      const matches = referenceSort === "source" ? reference.rows.filter(row => matchesListSearch(search, row))
        : sortListRows(reference.rows.filter(row => matchesListSearch(search, row)), row => row[0], referenceSort.endsWith("desc") ? "desc" : "asc");
      return <details key={`${index}:${reference.label}`}><summary>{reference.label}<span>{reference.rows.length.toLocaleString()}</span></summary><div className="csv-import-reference-tools"><label className="search-box"><Search size={15} aria-hidden="true" /><input aria-label={`Search ${reference.label}`} placeholder="Find a reference value" value={referenceQueries[index] ?? ""} onChange={event => setReferenceQueries(current => ({ ...current, [index]: event.target.value }))} /></label><AdminListSort label={`Sort ${reference.label} by`} value={referenceSort} onChange={value => setReferenceSorts(current => ({ ...current, [index]: value }))} options={[["source","Reference order"],["value-asc",`${reference.columns[0] ?? "Value"}: A–Z`],["value-desc",`${reference.columns[0] ?? "Value"}: Z–A`]]} /><Button icon={Download} onClick={() => saveCsvImportDownload(`${kind}-reference-${index + 1}.csv`, csvImportDownloadText(reference.columns, reference.rows))}>Download reference values</Button></div><ScrollableTableRegion label="CSV import data"><table aria-label="CSV import data"><thead><tr>{reference.columns.map((column, columnIndex) => <th key={columnIndex} scope="col">{column}</th>)}</tr></thead><tbody>{matches.slice(0, 100).map((row, rowIndex) => <tr key={rowIndex}>{reference.columns.map((_, columnIndex) => <td key={columnIndex}>{row[columnIndex] || "—"}</td>)}</tr>)}</tbody></table></ScrollableTableRegion><p className="muted-copy">{matches.length.toLocaleString()} matching values{matches.length > 100 ? "; first 100 shown. Download the full reference list for all values." : "."}</p></details>;
    })}</section> : null}

    {completion ? <section className="panel csv-import-completion" role="status"><CheckCircle2 size={24} aria-hidden="true" /><div><h3>Import completed</h3><p>{completion.message}</p><p>{completion.createdCount.toLocaleString()} created · {completion.skippedCount.toLocaleString()} existing entries skipped</p>{kind === "qa-questions" ? <p>New questions default to Draft. In the question bank, choose the Draft or All statuses filter to find and review them. Questions imported as active appear under Active.</p> : null}<small>Import reference: {completion.batchId}</small></div>{onOpenDestination ? <Button onClick={() => void onOpenDestination(returnPath)}>{returnLabel}</Button> : null}</section> : null}
    {error ? <div className="notice-row" role="alert"><AlertTriangle size={18} aria-hidden="true" />{error}</div> : null}

    <section className="panel csv-import-upload"><h3>Choose and check your CSV</h3><label className="csv-import-file"><span>CSV file</span><input ref={fileInput} type="file" accept=".csv,text/csv" disabled={applying} onChange={event => void chooseFile(event)} /></label>{file ? <p><strong>{file.name}</strong> · selected locally; nothing is imported until you confirm.</p> : null}<div className="toolbar"><Button icon={Upload} disabled={!file || Boolean(busy)} onClick={() => void validate()} variant="primary">{busy === "file" ? "Reading CSV…" : busy === "preview" ? "Checking rows…" : "Check and preview CSV"}</Button>{file || busy === "file" || busy === "preview" ? <Button icon={X} disabled={applying} onClick={clearFile}>Clear selected file</Button> : null}</div></section>

    {preview ? <section className="panel csv-import-preview"><div className="panel-heading"><div><h3>Review the import</h3><p>{preview.rowsRead.toLocaleString()} CSV rows · {preview.createCount.toLocaleString()} new entries · {preview.skipCount.toLocaleString()} existing entries skipped · {errors.length.toLocaleString()} errors · {warnings.length.toLocaleString()} warnings · {information.length.toLocaleString()} notes</p></div>{preview.issues.length ? <Button icon={Download} onClick={() => saveCsvImportDownload(`${kind}-row-issues.csv`, csvImportDownloadText(["Row", "Column", "Severity", "Message", "Value"], preview.issues.map(issue => [issue.rowNumber || "File", issue.column, issue.severity, issue.message, preview.rows.find(row => row.rowNumber === issue.rowNumber)?.values[issue.column]])))}>Download row issues</Button> : null}</div>
      {preview.issues.length ? <details className="csv-import-issues" open><summary>{errors.length} errors · {warnings.length} warnings · {information.length} notes</summary><ScrollableTableRegion label="CSV import data"><table aria-label="CSV import data"><thead><tr><th scope="col">Row</th><th scope="col">Column</th><th scope="col">Severity</th><th scope="col">Details</th></tr></thead><tbody>{preview.issues.map((issue, index) => <tr key={index} className={`csv-import-issue-${issue.severity}`}><td>{issue.rowNumber || "File"}</td><td>{issue.column || "—"}</td><td>{issue.severity === "error" ? "Error" : issue.severity === "warning" ? "Warning" : "Info"}</td><td>{issue.message}</td></tr>)}</tbody></table></ScrollableTableRegion></details> : null}
      <div className="csv-import-preview-tools"><label className="search-box"><Search size={16} aria-hidden="true" /><input aria-label="Search CSV preview rows" placeholder="Find a row or value" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label><label><span>Rows to show</span><select aria-label="Filter CSV preview rows" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}><option value="all">All rows</option><option value="create">New entries</option><option value="skip">Skipped rows</option><option value="errors">Rows with errors</option></select></label><AdminListSort value={sort} onChange={value => { setSort(value); setPage(1); }} options={[["row-asc","CSV row: first to last"],["row-desc","CSV row: last to first"],["reference-asc","Reference: A–Z"],["reference-desc","Reference: Z–A"],["operation-asc","Result: A–Z"]]} /></div>
      <p role="status">{matchingRows.length.toLocaleString()} matching preview rows · page {currentPage} of {totalPages}</p><ScrollableTableRegion label="CSV import data" className="csv-import-preview-table"><table aria-label="CSV import data"><thead><tr><th scope="col">CSV row</th><th scope="col">Reference</th><th scope="col">Result</th>{metadata.columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.reference}</td><td><span className={`status-pill csv-import-operation-${row.operation.toLocaleLowerCase()}`}>{operationLabel(row.operation)}</span></td>{metadata.columns.map(column => <td key={column.key}>{row.values[column.key] || "—"}</td>)}</tr>)}{!rows.length ? <tr><td colSpan={metadata.columns.length + 3}>No preview rows match this view.</td></tr> : null}</tbody></table></ScrollableTableRegion><Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
      {errors.length ? <p role="alert">Correct the errors in your CSV, select the corrected file and check it again. No rows have been imported.</p> : null}
      <div className="toolbar"><Button disabled={!preview.canImport || !preview.previewToken || preview.createCount === 0 || Boolean(busy)} variant="primary" onClick={() => { setError(""); setConfirmation(true); }}>Review and confirm import</Button></div>{preview.createCount === 0 && errors.length === 0 ? <p>There are no new entries to import. Existing entries are retained.</p> : null}
    </section> : null}

    {confirmation && preview && file ? <ModalDialog label="Confirm CSV import" className="csv-import-confirmation" busy={applying} onClose={() => { if (!applying) setConfirmation(false); }}><h2>Confirm this import</h2><p><strong>{file.name}</strong></p><p>Add {preview.createCount.toLocaleString()} new {preview.createCount === 1 ? "entry" : "entries"} from {preview.rowsRead.toLocaleString()} CSV {preview.rowsRead === 1 ? "row" : "rows"}. {preview.skipCount.toLocaleString()} existing {preview.skipCount === 1 ? "entry will" : "entries will"} be skipped.</p>{warnings.length ? <p>{warnings.length.toLocaleString()} warnings are listed in the preview. Review them before confirming.</p> : null}{information.length ? <div className="csv-import-confirmation-notes"><h3>{kind === "cpd-events" ? "Attendance effects" : "Import notes"}</h3><ul>{information.slice(0, 5).map((note, index) => <li key={index}>{note.message}</li>)}</ul>{information.length > 5 ? <p>{information.length - 5} further notes are listed in the preview.</p> : null}</div> : null}<p>The server checks the file again and applies the batch together. Existing records are retained.</p>{error ? <p role="alert">{error}</p> : null}<div className="toolbar"><Button disabled={applying} onClick={() => setConfirmation(false)}>Back to preview</Button><Button disabled={applying} variant="primary" onClick={() => void apply()}>{applying ? "Importing…" : `Import ${preview.createCount.toLocaleString()} new ${preview.createCount === 1 ? "entry" : "entries"}`}</Button></div></ModalDialog> : null}
  </div>;
}

function operationLabel(value: string) {
  const labels: Record<string, string> = { create: "New entry", skip: "Skip", error: "Needs correction", invalid: "Needs correction" };
  return labels[value.toLocaleLowerCase()] ?? value;
}
