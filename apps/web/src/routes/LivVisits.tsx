import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, CheckCircle2, Edit3, Eye, FilePlus2, Plus, RotateCcw, Save, Search, Send, X } from "lucide-react";
import { Button } from "../design-system/Button";
import { KpiStrip } from "../components/KpiStrip";
import { api } from "../services/api";
import type {
  ActionSummary,
  CurrentUser,
  LivRecordSummary,
  OrgUnitSummary,
  SaveLivRecordRequest,
  StaffSummary
} from "../services/types";

type LivVisitsProps = {
  staff: StaffSummary[];
  user: CurrentUser;
  onActionsChanged?: () => Promise<void>;
};

type LivFormState = {
  courseSeen: string;
  livDate: string;
  livTime: string;
  preConversation: string;
  livOverview: string;
  postConversation: string;
  followUpProjectedDate: string;
  secondLivOverview: string;
};

const emptyForm: LivFormState = {
  courseSeen: "",
  livDate: "",
  livTime: "",
  preConversation: "",
  livOverview: "",
  postConversation: "",
  followUpProjectedDate: "",
  secondLivOverview: ""
};

const MAX_STAFF_RESULTS = 8;

export function LivVisits({ staff, user, onActionsChanged }: LivVisitsProps) {
  const [records, setRecords] = useState<LivRecordSummary[]>([]);
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [staffQuery, setStaffQuery] = useState("");
  const [isStaffResultsOpen, setIsStaffResultsOpen] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [form, setForm] = useState<LivFormState>(emptyForm);
  const [statusMessage, setStatusMessage] = useState("");
  const [isCreatingAction, setIsCreatingAction] = useState(false);
  const [actionTitle, setActionTitle] = useState("");
  const [actionDetail, setActionDetail] = useState("");
  const [actionDueDate, setActionDueDate] = useState("");
  const staffInputRef = useRef<HTMLInputElement>(null);

  const canSubmitLiv = user.permissions.includes("liv.submit") || user.permissions.includes("liv.manage");
  const canManageLiv = user.permissions.includes("liv.manage");
  const canManageActions = user.permissions.includes("actions.manage");

  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? null;

  useEffect(() => {
    void refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshData() {
    try {
      const [nextRecords, nextActions, nextOrgUnits] = await Promise.all([
        api.livRecords(),
        api.actions(),
        api.orgUnits()
      ]);
      setRecords(nextRecords);
      setActions(nextActions);
      setOrgUnits(nextOrgUnits.filter((orgUnit) => orgUnit.isActive));
    } catch {
      setStatusMessage("LIV records could not be loaded from the API.");
    }
  }

  const filteredStaff = useMemo(() => {
    const query = staffQuery.trim().toLowerCase();
    return staff
      .filter(
        (staffMember) =>
          !query ||
          staffMember.displayName.toLowerCase().includes(query) ||
          staffMember.email.toLowerCase().includes(query) ||
          staffMember.externalId.toLowerCase().includes(query)
      )
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .slice(0, MAX_STAFF_RESULTS);
  }, [staff, staffQuery]);

  const selectedStaff = staff.find((staffMember) => staffMember.id === selectedStaffId);

  const livRecordIds = useMemo(() => new Set(records.map((record) => record.recordId)), [records]);
  const livActions = useMemo(
    () => actions.filter((action) => action.sourceRecordId && livRecordIds.has(action.sourceRecordId)),
    [actions, livRecordIds]
  );
  const openActionCount = livActions.filter((action) => !action.completedDate).length;
  const closedActionCount = livActions.filter((action) => Boolean(action.completedDate)).length;
  const overdueActionCount = livActions.filter((action) => action.isOverdue).length;
  const openRecordCount = records.filter((record) => record.status === "open").length;

  function selectStaff(staffMember: StaffSummary) {
    setSelectedStaffId(staffMember.id);
    setStaffQuery(staffMember.displayName);
    setIsStaffResultsOpen(false);
  }

  function clearStaffSearch() {
    setStaffQuery("");
    setSelectedStaffId("");
    setIsStaffResultsOpen(true);
    staffInputRef.current?.focus();
  }

  function clearActionForm() {
    setActionTitle("");
    setActionDetail("");
    setActionDueDate("");
  }

  function toggleActionForm() {
    setIsCreatingAction((current) => {
      if (current) {
        clearActionForm();
      }
      return !current;
    });
    setStatusMessage("");
  }

  function buildRequest(saveAsDraft: boolean, staffId: string): SaveLivRecordRequest {
    const subjectStaff = staff.find((staffMember) => staffMember.id === staffId);
    return {
      subjectStaffId: staffId,
      orgUnitId: subjectStaff?.primaryOrgUnitId,
      courseSeen: form.courseSeen || undefined,
      livDate: form.livDate || undefined,
      livTime: form.livTime || undefined,
      preConversation: form.preConversation || undefined,
      livOverview: form.livOverview || undefined,
      postConversation: form.postConversation || undefined,
      followUpProjectedDate: form.followUpProjectedDate || undefined,
      secondLivOverview: form.secondLivOverview || undefined,
      saveAsDraft
    };
  }

  async function createRecord(saveAsDraft: boolean) {
    if (!selectedStaffId) {
      setStatusMessage("Search for and select a staff member before saving the LIV record.");
      return;
    }

    if (!saveAsDraft && !form.livDate) {
      setStatusMessage("A LIV date is required before submitting. Save as draft to keep partial work.");
      return;
    }

    setIsSaving(true);
    const result = await api.createLivRecord(buildRequest(saveAsDraft, selectedStaffId));
    setIsSaving(false);

    if (result.ok) {
      setStatusMessage(saveAsDraft ? "LIV record saved as draft." : "LIV record created.");
      setIsCreating(false);
      setForm(emptyForm);
      setSelectedStaffId("");
      setStaffQuery("");
      setIsStaffResultsOpen(false);
      await refreshData();
    } else {
      setStatusMessage(result.message ?? "The LIV record could not be saved.");
    }
  }

  function startEdit() {
    if (!selectedRecord) {
      return;
    }

    setForm({
      courseSeen: selectedRecord.courseSeen ?? "",
      livDate: selectedRecord.livDate ?? "",
      livTime: selectedRecord.livTime ?? "",
      preConversation: selectedRecord.preConversation ?? "",
      livOverview: selectedRecord.livOverview ?? "",
      postConversation: selectedRecord.postConversation ?? "",
      followUpProjectedDate: selectedRecord.followUpProjectedDate ?? "",
      secondLivOverview: selectedRecord.secondLivOverview ?? ""
    });
    setSelectedStaffId(selectedRecord.subjectStaffId);
    setIsEditing(true);
    setIsCreating(false);
    setStatusMessage("");
  }

  async function saveEdit() {
    if (!selectedRecord) {
      return;
    }

    setIsSaving(true);
    const result = await api.updateLivRecord(selectedRecord.id, buildRequest(false, selectedStaffId || selectedRecord.subjectStaffId));
    setIsSaving(false);

    if (result.ok) {
      setStatusMessage("LIV record updated.");
      setIsEditing(false);
      await refreshData();
    } else {
      setStatusMessage(result.message ?? "The LIV record could not be updated.");
    }
  }

  async function changeStatus(action: "submit" | "close" | "reopen" | "archive") {
    if (!selectedRecord) {
      return;
    }

    if (action === "archive" && !window.confirm("Archive this LIV record? It will be hidden from lists and reporting.")) {
      return;
    }

    setIsSaving(true);
    const result = await api.changeLivStatus(selectedRecord.id, action);
    setIsSaving(false);

    if (result.ok) {
      setStatusMessage(
        action === "submit" ? "LIV record opened." :
        action === "close" ? "LIV record closed." :
        action === "reopen" ? "LIV record reopened." :
        "LIV record archived."
      );
      if (action === "archive") {
        setSelectedRecordId("");
      }
      await refreshData();
    } else {
      setStatusMessage(result.message ?? "The LIV status could not be changed.");
    }
  }

  async function createLivAction() {
    if (!selectedRecord || !actionTitle.trim() || !actionDetail.trim() || !actionDueDate) {
      setStatusMessage("Complete the action title, description and review date.");
      return;
    }

    setIsSaving(true);
    const result = await api.createAction({
      sourceRecordId: selectedRecord.recordId,
      subjectStaffId: selectedRecord.subjectStaffId,
      ownerStaffId: selectedRecord.subjectStaffId,
      title: actionTitle.trim(),
      detail: actionDetail.trim() || undefined,
      dueDate: actionDueDate || undefined,
      publishedToStaff: true
    });
    setIsSaving(false);

    if (result.ok) {
      setStatusMessage("LIV action created and assigned to the staff member.");
      setIsCreatingAction(false);
      clearActionForm();
      await refreshData();
      await onActionsChanged?.();
    } else {
      setStatusMessage(result.message ?? "The LIV action could not be created.");
    }
  }

  async function completeLivAction(actionId: string) {
    const result = await api.updateAction(actionId, { status: "complete" });
    if (result.ok) {
      setStatusMessage("LIV action completed.");
      await refreshData();
      await onActionsChanged?.();
    } else {
      setStatusMessage(result.message ?? "The action could not be completed.");
    }
  }

  const selectedRecordActions = selectedRecord
    ? livActions.filter((action) => action.sourceRecordId === selectedRecord.recordId)
    : [];

  return (
    <div className="route-stack">
      <div className="route-header">
        <div>
          <p className="eyebrow">Learning Improvement Visits</p>
          <h1>LIV</h1>
        </div>
        <div className="toolbar">
          {canSubmitLiv ? (
            <Button
              icon={FilePlus2}
              onClick={() => {
                setIsCreating((current) => !current);
                setIsEditing(false);
                setForm(emptyForm);
                setStaffQuery("");
                setSelectedStaffId("");
                setIsStaffResultsOpen(false);
                setStatusMessage("");
              }}
              variant="primary"
            >
              New LIV record
            </Button>
          ) : null}
        </div>
      </div>

      {statusMessage ? <div className="notice-row">{statusMessage}</div> : null}

      <KpiStrip
        items={[
          { label: "Open LIV records", value: openRecordCount, tone: "blue" },
          { label: "Open actions", value: openActionCount, tone: "amber" },
          { label: "Overdue actions", value: overdueActionCount, tone: overdueActionCount > 0 ? "red" : "green" },
          { label: "Closed actions", value: closedActionCount, tone: "green" }
        ]}
      />

      {isCreating ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>New LIV record</h2>
            <span>Draft saves keep partial work</span>
          </div>
          <div className="entry-form">
            <div className="entry-field-grid">
              <div className="entry-field entry-field-wide">
                <span id="liv-staff-label">Staff member <strong>Required</strong></span>
                <div className="staff-search liv-staff-search">
                  <div className="search-box staff-search-input">
                    <Search size={16} aria-hidden="true" />
                    <input
                      aria-autocomplete="list"
                      aria-controls="liv-staff-options"
                      aria-expanded={isStaffResultsOpen}
                      aria-labelledby="liv-staff-label"
                      onChange={(event) => {
                        setStaffQuery(event.target.value);
                        setSelectedStaffId("");
                        setIsStaffResultsOpen(true);
                      }}
                      onFocus={() => setIsStaffResultsOpen(true)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && filteredStaff.length > 0) {
                          event.preventDefault();
                          selectStaff(filteredStaff[0]);
                        }

                        if (event.key === "Escape") {
                          setIsStaffResultsOpen(false);
                        }
                      }}
                      placeholder="Type a name, email or staff ID"
                      ref={staffInputRef}
                      role="combobox"
                      type="text"
                      value={staffQuery}
                    />
                    {staffQuery || selectedStaffId ? (
                      <button className="icon-button" onClick={clearStaffSearch} title="Clear staff selection" type="button">
                        <X size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>

                  {isStaffResultsOpen ? (
                    <div
                      className="staff-search-results"
                      id="liv-staff-options"
                      onMouseDown={(event) => event.preventDefault()}
                      role="listbox"
                    >
                      {filteredStaff.length === 0 ? (
                        <div className="staff-search-empty">No staff match "{staffQuery.trim()}".</div>
                      ) : (
                        filteredStaff.map((staffMember) => (
                          <button
                            aria-selected={staffMember.id === selectedStaffId}
                            className="staff-search-result"
                            key={staffMember.id}
                            onClick={() => selectStaff(staffMember)}
                            role="option"
                            type="button"
                          >
                            <strong>{staffMember.displayName}</strong>
                            <span>
                              {staffMember.externalId}
                              {staffMember.jobTitle ? ` - ${staffMember.jobTitle}` : ""}
                            </span>
                            <small>{staffMember.email}</small>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
                <small>
                  {selectedStaff
                    ? `Selected: ${selectedStaff.externalId} - ${selectedStaff.email}`
                    : "Start typing, then choose a staff member from the same list."}
                </small>
              </div>
              <LivFormFields form={form} setForm={setForm} />
            </div>
            <div className="toolbar">
              <Button icon={X} onClick={() => setIsCreating(false)}>Cancel</Button>
              <Button disabled={isSaving} icon={Save} onClick={() => void createRecord(true)}>Save draft</Button>
              <Button disabled={isSaving} icon={Send} onClick={() => void createRecord(false)} variant="primary">
                Create LIV record
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <h2>LIV records</h2>
          <span>{records.length} visible to you</span>
        </div>
        <div className="record-list">
          {records.length === 0 ? (
            <div className="empty-row">
              No LIV records yet. {canSubmitLiv ? "Use \"New LIV record\" to add the first one." : "Records relating to you will appear here."}
            </div>
          ) : (
            records.map((record) => (
              <div className="record-row" key={record.id}>
                <div>
                  <strong>{record.subjectStaffName}</strong>
                  <span>
                    {record.parentOrgUnitCode ? `${record.parentOrgUnitCode} / ` : ""}
                    {record.orgUnitCode ?? "No team"} · {record.courseSeen ?? "No course"}
                  </span>
                </div>
                <span className={`status-pill status-${record.status}`}>{formatLivStatus(record.status)}</span>
                <span>{record.livDate ?? "No date"}{record.livTime ? ` ${record.livTime}` : ""}</span>
                <button
                  className="icon-button"
                  onClick={() => {
                    setSelectedRecordId(record.id);
                    setIsEditing(false);
                    setIsCreating(false);
                    setIsCreatingAction(false);
                    clearActionForm();
                  }}
                  type="button"
                  title="Open LIV record"
                >
                  <Eye size={16} aria-hidden="true" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {selectedRecord ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>LIV - {selectedRecord.subjectStaffName}</h2>
            <span>Reviewer: {selectedRecord.reviewerStaffName ?? "Not recorded"}</span>
          </div>
          <div className="record-detail-meta">
            <span>
              {selectedRecord.parentOrgUnitCode ? `${selectedRecord.parentOrgUnitCode} / ` : ""}
              {selectedRecord.orgUnitCode ?? "No team"}
            </span>
            <span>{selectedRecord.livDate ?? "No date"}{selectedRecord.livTime ? ` ${selectedRecord.livTime}` : ""}</span>
            <span className={`status-pill status-${selectedRecord.status}`}>{formatLivStatus(selectedRecord.status)}</span>
          </div>

          {isEditing ? (
            <div className="entry-form">
              <div className="entry-field-grid">
                <LivFormFields form={form} setForm={setForm} />
              </div>
              <div className="toolbar">
                <Button icon={X} onClick={() => setIsEditing(false)}>Cancel</Button>
                <Button disabled={isSaving} icon={Save} onClick={() => void saveEdit()} variant="primary">Save changes</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="answer-section-list">
                <div className="answer-section">
                  <h3>Visit</h3>
                  <div className="answer-grid">
                    <div className="answer-item"><span>Course seen</span><strong>{selectedRecord.courseSeen ?? "Not recorded"}</strong></div>
                    <div className="answer-item"><span>Date and time</span><strong>{selectedRecord.livDate ?? "Not recorded"}{selectedRecord.livTime ? ` ${selectedRecord.livTime}` : ""}</strong></div>
                    <div className="answer-item"><span>Projected follow-up</span><strong>{selectedRecord.followUpProjectedDate ?? "Not recorded"}</strong></div>
                  </div>
                </div>
                <div className="answer-section">
                  <h3>Conversations</h3>
                  <div className="answer-grid">
                    <div className="answer-item answer-item-wide"><span>Pre-visit conversation</span><strong>{selectedRecord.preConversation ?? "Not recorded"}</strong></div>
                    <div className="answer-item answer-item-wide"><span>LIV overview</span><strong>{selectedRecord.livOverview ?? "Not recorded"}</strong></div>
                    <div className="answer-item answer-item-wide"><span>Post-visit conversation</span><strong>{selectedRecord.postConversation ?? "Not recorded"}</strong></div>
                    <div className="answer-item answer-item-wide"><span>Second LIV overview</span><strong>{selectedRecord.secondLivOverview ?? "Not recorded"}</strong></div>
                  </div>
                </div>
              </div>
              <div className="toolbar">
                {selectedRecord.canEdit && selectedRecord.status !== "closed" ? (
                  <Button icon={Edit3} onClick={startEdit} variant="primary">Edit record</Button>
                ) : null}
                {selectedRecord.canEdit && selectedRecord.status === "draft" ? (
                  <Button disabled={isSaving} icon={Send} onClick={() => void changeStatus("submit")} variant="primary">Open LIV</Button>
                ) : null}
                {selectedRecord.canEdit && selectedRecord.status === "open" ? (
                  <Button disabled={isSaving} icon={CheckCircle2} onClick={() => void changeStatus("close")}>Close LIV</Button>
                ) : null}
                {canManageLiv && selectedRecord.status === "closed" ? (
                  <Button disabled={isSaving} icon={RotateCcw} onClick={() => void changeStatus("reopen")}>Reopen</Button>
                ) : null}
                {canManageLiv ? (
                  <Button disabled={isSaving} icon={Archive} onClick={() => void changeStatus("archive")} variant="quiet">Archive</Button>
                ) : null}
              </div>
            </>
          )}

          <div className="liv-actions-heading">
            <div>
              <h3>Actions</h3>
              <span>{selectedRecordActions.length} linked to this LIV</span>
            </div>
            {canManageActions || canSubmitLiv ? (
              <Button icon={Plus} onClick={toggleActionForm} variant="primary">Add action</Button>
            ) : null}
          </div>

          {isCreatingAction ? (
            <div className="entry-form">
              <div className="entry-field-grid">
                <label className="entry-field entry-field-wide">
                  <span>Action title <strong>Required</strong></span>
                  <input onChange={(event) => setActionTitle(event.target.value)} type="text" value={actionTitle} />
                </label>
                <label className="entry-field entry-field-wide">
                  <span>Description <strong>Required</strong></span>
                  <textarea onChange={(event) => setActionDetail(event.target.value)} rows={3} value={actionDetail} />
                </label>
                <label className="entry-field">
                  <span>Review date <strong>Required</strong></span>
                  <input onChange={(event) => setActionDueDate(event.target.value)} type="date" value={actionDueDate} />
                </label>
              </div>
              <div className="toolbar">
                <Button
                  icon={X}
                  onClick={() => {
                    setIsCreatingAction(false);
                    clearActionForm();
                  }}
                >
                  Cancel
                </Button>
                <Button disabled={isSaving} icon={Plus} onClick={() => void createLivAction()} variant="primary">Save action</Button>
              </div>
            </div>
          ) : null}

          <div className="record-list">
            {selectedRecordActions.length === 0 ? (
              <div className="empty-row">No actions for this LIV record</div>
            ) : (
              selectedRecordActions.map((action) => (
                <div className="record-row" key={action.id}>
                  <div>
                    <strong>{action.title}</strong>
                    <span>{action.detail ?? ""}</span>
                  </div>
                  <span className={`status-pill ${action.completedDate ? "status-closed" : "status-open"}`}>
                    {action.completedDate ? "Closed" : action.isOverdue ? "Overdue" : "Open"}
                  </span>
                  <span>{action.dueDate ?? "No date"}</span>
                  {!action.completedDate && (canManageActions || action.ownerStaffId === user.staffId || canSubmitLiv) ? (
                    <button className="icon-button" onClick={() => void completeLivAction(action.id)} type="button" title="Mark complete">
                      <CheckCircle2 size={16} aria-hidden="true" />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function LivFormFields({
  form,
  setForm
}: {
  form: LivFormState;
  setForm: (updater: (current: LivFormState) => LivFormState) => void;
}) {
  function update(key: keyof LivFormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <>
      <label className="entry-field">
        <span>Course seen</span>
        <input onChange={(event) => update("courseSeen", event.target.value)} type="text" value={form.courseSeen} />
      </label>
      <label className="entry-field">
        <span>LIV date</span>
        <input onChange={(event) => update("livDate", event.target.value)} type="date" value={form.livDate} />
      </label>
      <label className="entry-field">
        <span>LIV time</span>
        <input onChange={(event) => update("livTime", event.target.value)} type="time" value={form.livTime} />
      </label>
      <label className="entry-field">
        <span>Projected follow-up date</span>
        <input onChange={(event) => update("followUpProjectedDate", event.target.value)} type="date" value={form.followUpProjectedDate} />
      </label>
      <label className="entry-field entry-field-wide">
        <span>Pre-visit conversation</span>
        <textarea onChange={(event) => update("preConversation", event.target.value)} rows={3} value={form.preConversation} />
      </label>
      <label className="entry-field entry-field-wide">
        <span>LIV overview</span>
        <textarea onChange={(event) => update("livOverview", event.target.value)} rows={3} value={form.livOverview} />
      </label>
      <label className="entry-field entry-field-wide">
        <span>Post-visit conversation</span>
        <textarea onChange={(event) => update("postConversation", event.target.value)} rows={3} value={form.postConversation} />
      </label>
      <label className="entry-field entry-field-wide">
        <span>Second LIV overview (follow-up visit)</span>
        <textarea onChange={(event) => update("secondLivOverview", event.target.value)} rows={3} value={form.secondLivOverview} />
      </label>
    </>
  );
}

function formatLivStatus(status: string) {
  switch (status) {
    case "draft":
      return "Draft";
    case "open":
      return "Open";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}
