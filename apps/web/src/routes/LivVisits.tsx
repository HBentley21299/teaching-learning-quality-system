import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CheckCircle2,
  Edit3,
  Eye,
  FilePlus2,
  Plus,
  RotateCcw,
  Save,
  Search,
  X
} from "lucide-react";
import { Button } from "../design-system/Button";
import { KpiStrip } from "../components/KpiStrip";
import { StaffSearchSelect } from "../components/StaffSearchSelect";
import { api } from "../services/api";
import type {
  ActionSummary,
  CurrentUser,
  LivRecordSummary,
  LivVisitSummary,
  SaveLivRecordRequest,
  SaveLivVisitRequest,
  SharedThemeGroup,
  StaffSummary
} from "../services/types";

type LivVisitsProps = {
  staff: StaffSummary[];
  user: CurrentUser;
  onActionsChanged?: () => Promise<void>;
  initialSourceRecordId?: string;
};

type CaseFormState = {
  preConversation: string;
  elevatePractitioner: "" | "yes" | "no";
  areaOfPracticeThemeIds: string[];
  areaOfPracticeOther: string;
};

type VisitFormState = {
  visitDate: string;
  visitTime: string;
  courseName: string;
  courseGroup: string;
  courseLevel: string;
  reflectionNotes: string;
  findings: string;
};

const emptyCaseForm: CaseFormState = {
  preConversation: "",
  elevatePractitioner: "",
  areaOfPracticeThemeIds: [],
  areaOfPracticeOther: ""
};

const emptyVisitForm: VisitFormState = {
  visitDate: "",
  visitTime: "",
  courseName: "",
  courseGroup: "",
  courseLevel: "",
  reflectionNotes: "",
  findings: ""
};

export function LivVisits({ staff, user, onActionsChanged, initialSourceRecordId = "" }: LivVisitsProps) {
  const [records, setRecords] = useState<LivRecordSummary[]>([]);
  const [themeGroups, setThemeGroups] = useState<SharedThemeGroup[]>([]);
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isEditingCase, setIsEditingCase] = useState(false);
  const [editingVisitId, setEditingVisitId] = useState("");
  const [isAddingVisit, setIsAddingVisit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [caseForm, setCaseForm] = useState<CaseFormState>(emptyCaseForm);
  const [visitForm, setVisitForm] = useState<VisitFormState>(emptyVisitForm);
  const [statusMessage, setStatusMessage] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [recordStatus, setRecordStatus] = useState<"all" | "in_progress" | "closed">("all");
  const [isCreatingAction, setIsCreatingAction] = useState(false);
  const [actionVisitId, setActionVisitId] = useState("");
  const [actionText, setActionText] = useState("");
  const [actionDueDate, setActionDueDate] = useState("");
  const [actionOwnerId, setActionOwnerId] = useState("");
  const openedInitialRecord = useRef("");

  const canSubmitLiv = user.permissions.includes("liv.submit") || user.permissions.includes("liv.manage");
  const canManageLiv = user.permissions.includes("liv.manage");
  const canManageActions = user.permissions.includes("actions.manage");
  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? null;

  useEffect(() => {
    void refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialSourceRecordId || records.length === 0 || openedInitialRecord.current === initialSourceRecordId) return;
    openedInitialRecord.current = initialSourceRecordId;
    const record = records.find((candidate) => candidate.recordId === initialSourceRecordId);
    if (record) {
      setSelectedRecordId(record.id);
      setStatusMessage("");
    } else {
      setStatusMessage("The LIV source record is outside your permitted scope.");
    }
  }, [initialSourceRecordId, records]);

  async function refreshData() {
    try {
      const [nextRecords, nextActions, nextThemeGroups] = await Promise.all([
        api.livRecords(),
        api.actions(),
        api.sharedThemes("liv")
      ]);
      setRecords(nextRecords);
      setActions(nextActions);
      setThemeGroups(nextThemeGroups);
    } catch {
      setStatusMessage("LIV records could not be loaded from the API.");
    }
  }

  const livRecordIds = useMemo(() => new Set(records.map((record) => record.recordId)), [records]);
  const livActions = useMemo(
    () => actions.filter((action) => action.sourceRecordId && livRecordIds.has(action.sourceRecordId)),
    [actions, livRecordIds]
  );
  const selectedRecordActions = selectedRecord
    ? livActions.filter((action) => action.sourceRecordId === selectedRecord.recordId)
    : [];
  const visibleRecords = useMemo(() => {
    const query = recordSearch.trim().toLocaleLowerCase();
    return records.filter((record) => {
      const firstVisit = record.visits[0];
      const matchesStatus = recordStatus === "all" || record.status === recordStatus;
      const matchesSearch = !query || [
        record.subjectStaffName,
        record.orgUnitCode ?? "",
        record.parentOrgUnitCode ?? "",
        firstVisit?.courseName ?? "",
        firstVisit?.courseGroup ?? ""
      ].some((value) => value.toLocaleLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [recordSearch, recordStatus, records]);

  const openActionCount = livActions.filter((action) => !action.completedDate).length;
  const closedActionCount = livActions.filter((action) => Boolean(action.completedDate)).length;
  const overdueActionCount = livActions.filter((action) => action.isOverdue).length;
  const inProgressRecordCount = records.filter((record) => record.status === "in_progress").length;

  function resetEditor() {
    setCaseForm(emptyCaseForm);
    setVisitForm(emptyVisitForm);
    setSelectedStaffId("");
    setIsEditingCase(false);
    setEditingVisitId("");
    setIsAddingVisit(false);
  }

  function buildVisitRequest(form: VisitFormState): SaveLivVisitRequest {
    return {
      visitDate: form.visitDate || undefined,
      visitTime: form.visitTime || undefined,
      courseName: form.courseName.trim() || undefined,
      courseGroup: form.courseGroup.trim() || undefined,
      courseLevel: form.courseLevel.trim() || undefined,
      reflectionNotes: form.reflectionNotes.trim() || undefined,
      findings: form.findings.trim() || undefined
    };
  }

  function buildCaseRequest(staffId: string, initialVisit: SaveLivVisitRequest): SaveLivRecordRequest {
    const selectedStaff = staff.find((staffMember) => staffMember.id === staffId);
    return {
      subjectStaffId: staffId,
      orgUnitId: selectedStaff?.primaryOrgUnitId,
      preConversation: caseForm.preConversation.trim() || undefined,
      initialVisit,
      isElevatePractitioner:
        caseForm.elevatePractitioner === "" ? undefined : caseForm.elevatePractitioner === "yes",
      areaOfPracticeKeys: themeGroups
        .flatMap((group) => group.themes)
        .filter((theme) => caseForm.areaOfPracticeThemeIds.includes(theme.id))
        .map((theme) => theme.themeKey),
      areaOfPracticeThemeIds: caseForm.areaOfPracticeThemeIds,
      areaOfPracticeOther: caseForm.areaOfPracticeOther.trim() || undefined
    };
  }

  function validateSensitiveFields() {
    const hasOther = themeGroups
      .flatMap((group) => group.themes)
      .some((theme) => theme.isOther && caseForm.areaOfPracticeThemeIds.includes(theme.id));
    if (hasOther && !caseForm.areaOfPracticeOther.trim()) {
      setStatusMessage("Describe the area of practice when Other is selected.");
      return false;
    }
    return true;
  }

  async function createRecord() {
    if (!selectedStaffId) {
      setStatusMessage("Select a staff member before saving the LIV case.");
      return;
    }
    if (!validateSensitiveFields()) {
      return;
    }

    setIsSaving(true);
    const result = await api.createLivRecord(buildCaseRequest(selectedStaffId, buildVisitRequest(visitForm)));
    setIsSaving(false);
    if (!result.ok) {
      setStatusMessage(result.message ?? "The LIV case could not be saved.");
      return;
    }

    setStatusMessage("LIV case saved as In Progress and made visible to the staff member.");
    setIsCreating(false);
    resetEditor();
    await refreshData();
  }

  function startCaseEdit() {
    if (!selectedRecord) {
      return;
    }
    setCaseForm({
      preConversation: selectedRecord.preConversation ?? "",
      elevatePractitioner:
        selectedRecord.isElevatePractitioner === undefined
          ? ""
          : selectedRecord.isElevatePractitioner
            ? "yes"
            : "no",
      areaOfPracticeThemeIds: selectedRecord.areaOfPracticeThemeIds.length > 0
        ? selectedRecord.areaOfPracticeThemeIds
        : themeGroups
            .flatMap((group) => group.themes)
            .filter((theme) => selectedRecord.areaOfPracticeKeys.includes(theme.themeKey))
            .map((theme) => theme.id),
      areaOfPracticeOther: selectedRecord.areaOfPracticeOther ?? ""
    });
    setIsEditingCase(true);
    setEditingVisitId("");
    setIsAddingVisit(false);
    setStatusMessage("");
  }

  async function saveCaseEdit() {
    if (!selectedRecord || !validateSensitiveFields()) {
      return;
    }
    const initialVisit = selectedRecord.visits.find((visit) => visit.visitNumber === 1);
    setIsSaving(true);
    const result = await api.updateLivRecord(
      selectedRecord.id,
      buildCaseRequest(selectedRecord.subjectStaffId, visitSummaryToRequest(initialVisit))
    );
    setIsSaving(false);
    if (!result.ok) {
      setStatusMessage(result.message ?? "The LIV case could not be updated.");
      return;
    }
    setIsEditingCase(false);
    setStatusMessage("LIV case details updated.");
    await refreshData();
  }

  function startVisitEdit(visit: LivVisitSummary) {
    setVisitForm(visitSummaryToForm(visit));
    setEditingVisitId(visit.id);
    setIsAddingVisit(false);
    setIsEditingCase(false);
    setStatusMessage("");
  }

  async function saveVisitEdit() {
    if (!selectedRecord || !editingVisitId) {
      return;
    }
    setIsSaving(true);
    const result = await api.updateLivVisit(selectedRecord.id, editingVisitId, buildVisitRequest(visitForm));
    setIsSaving(false);
    if (!result.ok) {
      setStatusMessage(result.message ?? "The visit could not be updated.");
      return;
    }
    setEditingVisitId("");
    setVisitForm(emptyVisitForm);
    setStatusMessage("Visit updated.");
    await refreshData();
  }

  function startFollowUpVisit() {
    setVisitForm(emptyVisitForm);
    setIsAddingVisit(true);
    setEditingVisitId("");
    setIsEditingCase(false);
    setStatusMessage("");
  }

  async function addFollowUpVisit() {
    if (!selectedRecord) {
      return;
    }
    setIsSaving(true);
    const result = await api.addLivVisit(selectedRecord.id, buildVisitRequest(visitForm));
    setIsSaving(false);
    if (!result.ok) {
      setStatusMessage(result.message ?? "The follow-up visit could not be added.");
      return;
    }
    setIsAddingVisit(false);
    setVisitForm(emptyVisitForm);
    setStatusMessage(`Visit ${result.data?.visitNumber ?? ""} added.`.trim());
    await refreshData();
  }

  async function changeStatus(action: "close" | "reopen" | "archive") {
    if (!selectedRecord) {
      return;
    }
    if (action === "archive" && !window.confirm("Archive this LIV case? It will be hidden from lists and reporting.")) {
      return;
    }
    setIsSaving(true);
    const result = await api.changeLivStatus(selectedRecord.id, action);
    setIsSaving(false);
    if (!result.ok) {
      setStatusMessage(result.message ?? "The LIV status could not be changed.");
      return;
    }
    setStatusMessage(action === "close" ? "LIV case completed." : action === "reopen" ? "LIV case reopened." : "LIV case archived.");
    if (action === "archive") {
      setSelectedRecordId("");
    }
    await refreshData();
  }

  function openActionForm(visitId = "") {
    setActionVisitId(visitId);
    setActionText("");
    setActionDueDate("");
    setActionOwnerId(selectedRecord?.subjectStaffId ?? "");
    setIsCreatingAction(true);
    setStatusMessage("");
  }

  async function createLivAction() {
    if (!selectedRecord || !actionText.trim() || !actionDueDate || !actionOwnerId) {
      setStatusMessage("Complete the action, owner and implementation date.");
      return;
    }
    setIsSaving(true);
    const result = await api.createAction({
      sourceRecordId: selectedRecord.recordId,
      livVisitId: actionVisitId || undefined,
      subjectStaffId: selectedRecord.subjectStaffId,
      ownerStaffId: actionOwnerId,
      title: actionText.trim(),
      dueDate: actionDueDate,
      publishedToStaff: true
    });
    setIsSaving(false);
    if (!result.ok) {
      setStatusMessage(result.message ?? "The LIV action could not be created.");
      return;
    }
    setStatusMessage(actionVisitId ? "Action created from the selected visit." : "Case action created.");
    setIsCreatingAction(false);
    await refreshData();
    await onActionsChanged?.();
  }

  async function completeLivAction(actionId: string) {
    const result = await api.updateAction(actionId, { status: "complete" });
    if (!result.ok) {
      setStatusMessage(result.message ?? "The action could not be completed.");
      return;
    }
    setStatusMessage("LIV action completed.");
    await refreshData();
    await onActionsChanged?.();
  }

  return (
    <div className="route-stack">
      <div className="route-header">
        <div>
          <p className="eyebrow">Learning Improvement Visits</p>
          <h1>LIV</h1>
        </div>
        {canSubmitLiv ? (
          <Button
            icon={FilePlus2}
            onClick={() => {
              setIsCreating((current) => !current);
              resetEditor();
              setStatusMessage("");
            }}
            variant="primary"
          >
            New LIV case
          </Button>
        ) : null}
      </div>

      {statusMessage ? <div className="notice-row">{statusMessage}</div> : null}

      <KpiStrip
        items={[
          { label: "In Progress", value: inProgressRecordCount, tone: "blue" },
          { label: "Open actions", value: openActionCount, tone: "amber" },
          { label: "Overdue actions", value: overdueActionCount, tone: overdueActionCount > 0 ? "red" : "green" },
          { label: "Closed actions", value: closedActionCount, tone: "green" }
        ]}
      />

      {isCreating ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>New LIV case</h2>
            <span>Saved records are visible to the staff member</span>
          </div>
          <div className="entry-form">
            <div className="entry-field-grid">
              <label className="entry-field entry-field-wide">
                <span>Staff member <strong>Required</strong></span>
                <StaffSearchSelect id="liv-staff" onChange={setSelectedStaffId} staff={staff} value={selectedStaffId} />
              </label>
              <label className="entry-field entry-field-wide">
                <span>Pre-visit conversation</span>
                <textarea
                  onChange={(event) => setCaseForm((current) => ({ ...current, preConversation: event.target.value }))}
                  rows={3}
                  value={caseForm.preConversation}
                />
              </label>
            </div>
            <div className="form-section-heading">
              <div><span>Initial visit</span><strong>Visit 1</strong></div>
            </div>
            <VisitFields form={visitForm} onChange={setVisitForm} />
            <SensitivePracticeFields form={caseForm} groups={themeGroups} onChange={setCaseForm} />
            <div className="toolbar">
              <Button icon={X} onClick={() => setIsCreating(false)}>Cancel</Button>
              <Button disabled={isSaving} icon={Save} onClick={() => void createRecord()} variant="primary">
                Save as In Progress
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <h2>LIV cases</h2>
          <span>{visibleRecords.length} of {records.length} visible</span>
        </div>
        <div className="liv-record-filters">
          <div className="search-box">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search LIV cases"
              onChange={(event) => setRecordSearch(event.target.value)}
              placeholder="Search staff, faculty, team or course"
              type="search"
              value={recordSearch}
            />
          </div>
          <label>
            <span>Status</span>
            <select onChange={(event) => setRecordStatus(event.target.value as typeof recordStatus)} value={recordStatus}>
              <option value="all">All statuses</option>
              <option value="in_progress">In Progress</option>
              <option value="closed">Completed</option>
            </select>
          </label>
        </div>
        <div className="record-list">
          {visibleRecords.length === 0 ? (
            <div className="empty-row">No LIV cases match the current filters.</div>
          ) : visibleRecords.map((record) => {
            const firstVisit = record.visits[0];
            return (
              <div className="record-row" key={record.id}>
                <div>
                  <strong>{record.subjectStaffName}</strong>
                  <span>
                    {record.parentOrgUnitCode ? `${record.parentOrgUnitCode} / ` : ""}
                    {record.orgUnitCode ?? "No team"} · {firstVisit?.courseName ?? "Course not recorded"}
                  </span>
                </div>
                <span className={`status-pill status-${record.status}`}>{formatLivStatus(record.status)}</span>
                <span>{record.visits.length} {record.visits.length === 1 ? "visit" : "visits"}</span>
                <button
                  className="icon-button"
                  onClick={() => {
                    setSelectedRecordId(record.id);
                    resetEditor();
                    setIsCreating(false);
                    setIsCreatingAction(false);
                  }}
                  title="Open LIV case"
                  type="button"
                >
                  <Eye size={16} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {selectedRecord ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>LIV - {selectedRecord.subjectStaffName}</h2>
            <span>Created by {selectedRecord.reviewerStaffName ?? "Not recorded"}</span>
          </div>
          <div className="record-detail-meta">
            <span>{selectedRecord.parentOrgUnitCode ? `${selectedRecord.parentOrgUnitCode} / ` : ""}{selectedRecord.orgUnitCode ?? "No team"}</span>
            <span>{selectedRecord.visits.length} {selectedRecord.visits.length === 1 ? "visit" : "visits"}</span>
            <span className={`status-pill status-${selectedRecord.status}`}>{formatLivStatus(selectedRecord.status)}</span>
          </div>

          {isEditingCase ? (
            <div className="entry-form liv-case-editor">
              <label className="entry-field entry-field-wide">
                <span>Pre-visit conversation</span>
                <textarea
                  onChange={(event) => setCaseForm((current) => ({ ...current, preConversation: event.target.value }))}
                  rows={3}
                  value={caseForm.preConversation}
                />
              </label>
              {selectedRecord.canViewSensitive ? <SensitivePracticeFields form={caseForm} groups={themeGroups} onChange={setCaseForm} /> : null}
              <div className="toolbar">
                <Button icon={X} onClick={() => setIsEditingCase(false)}>Cancel</Button>
                <Button disabled={isSaving} icon={Save} onClick={() => void saveCaseEdit()} variant="primary">Save case details</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="answer-section">
                <h3>Case context</h3>
                <div className="answer-item answer-item-wide">
                  <span>Pre-visit conversation</span>
                  <strong>{selectedRecord.preConversation ?? "Not recorded"}</strong>
                </div>
              </div>
              {selectedRecord.canViewSensitive ? (
                <div className="liv-sensitive-summary">
                  <div className="liv-sensitive-heading">
                    <span>Restricted</span>
                    <h3>Elevate practitioner information</h3>
                  </div>
                  <div className="answer-grid">
                    <div className="answer-item">
                      <span>Elevate Practitioner</span>
                      <strong>{selectedRecord.isElevatePractitioner === undefined ? "Not recorded" : selectedRecord.isElevatePractitioner ? "Yes" : "No"}</strong>
                    </div>
                    <div className="answer-item answer-item-wide">
                      <span>Area of practice that stood out</span>
                      <strong>{formatPracticeAreas(selectedRecord, themeGroups)}</strong>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="toolbar">
                {selectedRecord.canEdit ? <Button icon={Edit3} onClick={startCaseEdit}>Edit case details</Button> : null}
                {selectedRecord.canEdit ? <Button icon={CheckCircle2} onClick={() => void changeStatus("close")} variant="primary">Complete LIV</Button> : null}
                {canManageLiv && selectedRecord.status === "closed" ? <Button icon={RotateCcw} onClick={() => void changeStatus("reopen")}>Reopen</Button> : null}
                {canManageLiv ? <Button icon={Archive} onClick={() => void changeStatus("archive")} variant="quiet">Archive</Button> : null}
              </div>
            </>
          )}

          <div className="liv-visit-heading">
            <div>
              <h3>Visits</h3>
              <span>Discussion and observations are recorded against each visit</span>
            </div>
            {selectedRecord.canEdit ? (
              <Button icon={Plus} onClick={startFollowUpVisit} variant="primary">Add Follow-up Visit</Button>
            ) : null}
          </div>

          {isAddingVisit ? (
            <div className="entry-form liv-visit-editor">
              <div className="form-section-heading"><div><span>Follow-up visit</span><strong>Visit {selectedRecord.visits.length + 1}</strong></div></div>
              <VisitFields form={visitForm} onChange={setVisitForm} />
              <div className="toolbar">
                <Button icon={X} onClick={() => setIsAddingVisit(false)}>Cancel</Button>
                <Button disabled={isSaving} icon={Save} onClick={() => void addFollowUpVisit()} variant="primary">Save follow-up visit</Button>
              </div>
            </div>
          ) : null}

          <div className="liv-visit-stack">
            {selectedRecord.visits.map((visit) => (
              <article className="liv-visit-card" key={visit.id}>
                <div className="liv-visit-card-heading">
                  <div>
                    <span>{visit.visitType === "initial" ? "Initial visit" : "Follow-up visit"}</span>
                    <h3>Visit {visit.visitNumber}</h3>
                  </div>
                  <span className={`status-pill status-${visit.visitStatus}`}>{visit.visitStatus === "completed" ? "Completed" : "In Progress"}</span>
                </div>
                {editingVisitId === visit.id ? (
                  <div className="entry-form">
                    <VisitFields form={visitForm} onChange={setVisitForm} />
                    <div className="toolbar">
                      <Button icon={X} onClick={() => setEditingVisitId("")}>Cancel</Button>
                      <Button disabled={isSaving} icon={Save} onClick={() => void saveVisitEdit()} variant="primary">Save visit</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="answer-grid">
                      <div className="answer-item"><span>Date and time</span><strong>{formatVisitDate(visit)}</strong></div>
                      <div className="answer-item"><span>Course</span><strong>{visit.courseName ?? "Not recorded"}</strong></div>
                      <div className="answer-item"><span>Group</span><strong>{visit.courseGroup ?? "Not recorded"}</strong></div>
                      <div className="answer-item"><span>Level</span><strong>{visit.courseLevel ?? "Not recorded"}</strong></div>
                      <div className="answer-item answer-item-wide"><span>Reflection and discussion</span><strong>{visit.reflectionNotes ?? "Not recorded"}</strong></div>
                      <div className="answer-item answer-item-wide"><span>Findings and key points</span><strong>{visit.findings ?? "Not recorded"}</strong></div>
                    </div>
                    <div className="toolbar">
                      {selectedRecord.canEdit ? <Button icon={Edit3} onClick={() => startVisitEdit(visit)}>Edit visit</Button> : null}
                      {(selectedRecord.canEdit || canManageActions) && selectedRecord.status === "in_progress" ? (
                        <Button icon={Plus} onClick={() => openActionForm(visit.id)} variant="primary">Create action</Button>
                      ) : null}
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>

          <div className="liv-actions-heading">
            <div>
              <h3>Actions</h3>
              <span>{selectedRecordActions.length} linked to this LIV case</span>
            </div>
            {(selectedRecord.canEdit || canManageActions) && selectedRecord.status === "in_progress" ? (
              <Button icon={Plus} onClick={() => openActionForm()} variant="primary">Add case action</Button>
            ) : null}
          </div>

          {isCreatingAction ? (
            <div className="entry-form liv-action-editor">
              <div className="panel-heading">
                <h3>New action</h3>
                <span>{actionVisitId ? `Linked to Visit ${visitNumberFor(selectedRecord, actionVisitId)}` : "Linked to the overall case"}</span>
              </div>
              <div className="entry-field-grid">
                <label className="entry-field entry-field-wide">
                  <span>Action <strong>Required</strong></span>
                  <textarea onChange={(event) => setActionText(event.target.value)} rows={3} value={actionText} />
                </label>
                <label className="entry-field">
                  <span>Date to be implemented by <strong>Required</strong></span>
                  <input onChange={(event) => setActionDueDate(event.target.value)} type="date" value={actionDueDate} />
                </label>
                <label className="entry-field">
                  <span>Owner <strong>Required</strong></span>
                  <StaffSearchSelect id="liv-action-owner" onChange={setActionOwnerId} staff={staff} value={actionOwnerId} />
                </label>
              </div>
              <div className="toolbar">
                <Button icon={X} onClick={() => setIsCreatingAction(false)}>Cancel</Button>
                <Button disabled={isSaving} icon={Plus} onClick={() => void createLivAction()} variant="primary">Save action</Button>
              </div>
            </div>
          ) : null}

          <div className="record-list">
            {selectedRecordActions.length === 0 ? (
              <div className="empty-row">No actions for this LIV case</div>
            ) : selectedRecordActions.map((action) => (
              <div className="record-row" key={action.id}>
                <div>
                  <strong>{action.title}</strong>
                  <span>
                    {action.livVisitId ? `Visit ${visitNumberFor(selectedRecord, action.livVisitId)} · ` : "Case · "}
                    Owner: {action.ownerStaffName ?? "Not recorded"}
                  </span>
                </div>
                <span className={`status-pill ${action.completedDate ? "status-closed" : "status-in_progress"}`}>
                  {action.completedDate ? "Completed" : action.isOverdue ? "Overdue" : "Open"}
                </span>
                <span>{action.dueDate ?? "No date"}</span>
                {!action.completedDate && (canManageActions || action.ownerStaffId === user.staffId || selectedRecord.canEdit) ? (
                  <button className="icon-button" onClick={() => void completeLivAction(action.id)} title="Mark complete" type="button">
                    <CheckCircle2 size={16} aria-hidden="true" />
                  </button>
                ) : <span />}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function VisitFields({ form, onChange }: { form: VisitFormState; onChange: (form: VisitFormState) => void }) {
  function update(key: keyof VisitFormState, value: string) {
    onChange({ ...form, [key]: value });
  }

  return (
    <div className="entry-field-grid">
      <label className="entry-field"><span>Date</span><input onChange={(event) => update("visitDate", event.target.value)} type="date" value={form.visitDate} /></label>
      <label className="entry-field"><span>Time</span><input onChange={(event) => update("visitTime", event.target.value)} type="time" value={form.visitTime} /></label>
      <label className="entry-field"><span>Course name</span><input onChange={(event) => update("courseName", event.target.value)} type="text" value={form.courseName} /></label>
      <label className="entry-field"><span>Course group</span><input onChange={(event) => update("courseGroup", event.target.value)} type="text" value={form.courseGroup} /></label>
      <label className="entry-field"><span>Course level</span><input onChange={(event) => update("courseLevel", event.target.value)} type="text" value={form.courseLevel} /></label>
      <label className="entry-field entry-field-wide">
        <span>Reflection and discussion</span>
        <textarea onChange={(event) => update("reflectionNotes", event.target.value)} placeholder="Discussion, observations and key points from the visit" rows={4} value={form.reflectionNotes} />
      </label>
      <label className="entry-field entry-field-wide">
        <span>Findings and key points</span>
        <textarea onChange={(event) => update("findings", event.target.value)} rows={3} value={form.findings} />
      </label>
    </div>
  );
}

function SensitivePracticeFields({
  form,
  groups,
  onChange
}: {
  form: CaseFormState;
  groups: SharedThemeGroup[];
  onChange: (form: CaseFormState) => void;
}) {
  function toggleArea(themeId: string, isOther: boolean) {
    const next = form.areaOfPracticeThemeIds.includes(themeId)
      ? form.areaOfPracticeThemeIds.filter((id) => id !== themeId)
      : [...form.areaOfPracticeThemeIds, themeId];
    onChange({
      ...form,
      areaOfPracticeThemeIds: next,
      areaOfPracticeOther: isOther && !next.includes(themeId) ? "" : form.areaOfPracticeOther
    });
  }

  const selectedOther = groups
    .flatMap((group) => group.themes)
    .some((theme) => theme.isOther && form.areaOfPracticeThemeIds.includes(theme.id));

  return (
    <div className="liv-sensitive-fields">
      <div className="liv-sensitive-heading">
        <span>Restricted</span>
        <h3>Elevate practitioner information</h3>
      </div>
      <fieldset className="entry-field">
        <legend>Elevate Practitioner</legend>
        <div className="segmented-options">
          <label><input checked={form.elevatePractitioner === "yes"} name="elevate-practitioner" onChange={() => onChange({ ...form, elevatePractitioner: "yes" })} type="radio" />Yes</label>
          <label><input checked={form.elevatePractitioner === "no"} name="elevate-practitioner" onChange={() => onChange({ ...form, elevatePractitioner: "no" })} type="radio" />No</label>
        </div>
      </fieldset>
      <fieldset className="entry-field entry-field-wide">
        <legend>Area of practice that stood out</legend>
        <div className="liv-theme-groups">
          {groups.map((group) => (
            <div className="liv-theme-group" key={group.id}>
              <strong>{group.name}</strong>
              <div className="liv-practice-checklist">
                {group.themes
                  .filter((theme) => theme.isActive || form.areaOfPracticeThemeIds.includes(theme.id))
                  .map((theme) => (
                    <label className={theme.isActive ? "" : "is-inactive"} key={theme.id}>
                      <input
                        checked={form.areaOfPracticeThemeIds.includes(theme.id)}
                        disabled={!theme.isActive && !form.areaOfPracticeThemeIds.includes(theme.id)}
                        onChange={() => toggleArea(theme.id, theme.isOther)}
                        type="checkbox"
                      />
                      <span>{theme.name}</span>
                    </label>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      {selectedOther ? (
        <label className="entry-field entry-field-wide">
          <span>Other area of practice <strong>Required</strong></span>
          <textarea onChange={(event) => onChange({ ...form, areaOfPracticeOther: event.target.value })} rows={2} value={form.areaOfPracticeOther} />
        </label>
      ) : null}
    </div>
  );
}

function visitSummaryToForm(visit?: LivVisitSummary): VisitFormState {
  return {
    visitDate: visit?.visitDate ?? "",
    visitTime: visit?.visitTime ?? "",
    courseName: visit?.courseName ?? "",
    courseGroup: visit?.courseGroup ?? "",
    courseLevel: visit?.courseLevel ?? "",
    reflectionNotes: visit?.reflectionNotes ?? "",
    findings: visit?.findings ?? ""
  };
}

function visitSummaryToRequest(visit?: LivVisitSummary): SaveLivVisitRequest {
  const form = visitSummaryToForm(visit);
  return {
    visitDate: form.visitDate || undefined,
    visitTime: form.visitTime || undefined,
    courseName: form.courseName || undefined,
    courseGroup: form.courseGroup || undefined,
    courseLevel: form.courseLevel || undefined,
    reflectionNotes: form.reflectionNotes || undefined,
    findings: form.findings || undefined
  };
}

function visitNumberFor(record: LivRecordSummary, visitId: string) {
  return record.visits.find((visit) => visit.id === visitId)?.visitNumber ?? "?";
}

function formatVisitDate(visit: LivVisitSummary) {
  if (!visit.visitDate) {
    return "Not recorded";
  }
  return `${visit.visitDate}${visit.visitTime ? ` ${visit.visitTime}` : ""}`;
}

function formatPracticeAreas(record: LivRecordSummary, groups: SharedThemeGroup[]) {
  const themes = groups.flatMap((group) => group.themes);
  const selected = record.areaOfPracticeThemeIds
    .map((id) => themes.find((theme) => theme.id === id))
    .filter((theme): theme is NonNullable<typeof theme> => Boolean(theme));
  if (selected.length > 0) {
    return selected.map((theme) =>
      theme.isOther && record.areaOfPracticeOther
        ? `Other: ${record.areaOfPracticeOther}`
        : theme.name
    ).join(", ");
  }
  if (record.areaOfPracticeKeys.length === 0) {
    return "Not recorded";
  }
  return record.areaOfPracticeKeys.map((key) => {
    if (key === "other") {
      return record.areaOfPracticeOther ? `Other: ${record.areaOfPracticeOther}` : "Other";
    }
    return themes.find((theme) => theme.themeKey === key)?.name ?? key;
  }).join(", ");
}

function formatLivStatus(status: LivRecordSummary["status"]) {
  return status === "in_progress" ? "In Progress" : "Completed";
}
