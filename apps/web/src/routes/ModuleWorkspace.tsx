import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Archive, CalendarPlus, CheckCircle2, ChevronDown, Edit3, Eye, FilePlus2, Plus, RotateCcw, Save, Send, X } from "lucide-react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  ActionSummary,
  CurrentUser,
  FormDefinition,
  FormFieldDefinition,
  LearningWalkThemeMappingSummary,
  OrgUnitSummary,
  RecordDetail,
  RecordSummary,
  StaffSummary
} from "../services/types";

type WorkspaceMode = "learning" | "scrutiny" | "cpd";

type ModuleWorkspaceProps = {
  title: string;
  eyebrow: string;
  mode: WorkspaceMode;
  staff?: StaffSummary[];
  user: CurrentUser;
  onActionsChanged?: () => Promise<void>;
};

const workspaceConfig: Record<WorkspaceMode, {
  templateKey: string;
  recordType: string;
  recordLabel: string;
  createLabel: string;
  submitLabel: string;
}> = {
  learning: {
    templateKey: "learning_walk_core",
    recordType: "learning_walk",
    recordLabel: "Learning Walk",
    createLabel: "Create record",
    submitLabel: "Submit form"
  },
  scrutiny: {
    templateKey: "work_scrutiny_cudcpa",
    recordType: "work_scrutiny",
    recordLabel: "Work Scrutiny record",
    createLabel: "Create record",
    submitLabel: "Submit record"
  },
  cpd: {
    templateKey: "cpd_core",
    recordType: "cpd_event",
    recordLabel: "CPD event",
    createLabel: "Create event",
    submitLabel: "Submit event"
  }
};

export function ModuleWorkspace({ title, eyebrow, mode, staff = [], user, onActionsChanged }: ModuleWorkspaceProps) {
  const config = workspaceConfig[mode];
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [definitionError, setDefinitionError] = useState("");
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [themeMappings, setThemeMappings] = useState<LearningWalkThemeMappingSummary[]>([]);
  const [records, setRecords] = useState<RecordSummary[]>([]);
  const [isActiveRecordsOpen, setIsActiveRecordsOpen] = useState(true);
  const [recordSearch, setRecordSearch] = useState("");
  const [recordStatusFilter, setRecordStatusFilter] = useState("all");
  const [recordAreaFilter, setRecordAreaFilter] = useState("all");
  const [recordSort, setRecordSort] = useState<"newest" | "oldest" | "area" | "status">("newest");
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<RecordDetail | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [editResponses, setEditResponses] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [isCreatingAction, setIsCreatingAction] = useState(false);
  const [actionTitle, setActionTitle] = useState("");
  const [actionOwnerId, setActionOwnerId] = useState(user.staffId ?? "");
  const [actionDueDate, setActionDueDate] = useState("");

  const canManageForms = user.permissions.includes("forms.manage");
  const canManageActions = user.permissions.includes("actions.manage");
  const primaryIcon = mode === "cpd" ? CalendarPlus : FilePlus2;

  const createSections = definition?.sections ?? [];
  const selectedFacultyId = getResponseValue(createSections, responses, "faculty_area");
  const selectedTeamId = getResponseValue(createSections, responses, "team_level");
  const selectedTeam = useMemo(
    () => orgUnits.find((orgUnit) => orgUnit.id === selectedTeamId),
    [orgUnits, selectedTeamId]
  );
  const selectedFaculty = useMemo(
    () => orgUnits.find((orgUnit) => orgUnit.id === selectedFacultyId),
    [orgUnits, selectedFacultyId]
  );
  const agreedTheme = useMemo(
    () => getAgreedTheme(themeMappings, selectedFacultyId, selectedTeamId),
    [selectedFacultyId, selectedTeamId, themeMappings]
  );

  const editSections = selectedDetail?.sections ?? [];
  const editFacultyId = getResponseValue(editSections, editResponses, "faculty_area");
  const editTeamId = getResponseValue(editSections, editResponses, "team_level");
  const editTeam = useMemo(() => orgUnits.find((orgUnit) => orgUnit.id === editTeamId), [orgUnits, editTeamId]);
  const editFaculty = useMemo(
    () => orgUnits.find((orgUnit) => orgUnit.id === editFacultyId),
    [orgUnits, editFacultyId]
  );
  const editAgreedTheme = useMemo(
    () => getAgreedTheme(themeMappings, editFacultyId, editTeamId),
    [editFacultyId, editTeamId, themeMappings]
  );

  const recordAreaOptions = useMemo(
    () =>
      orgUnits
        .filter((orgUnit) => records.some((record) => record.orgUnitId === orgUnit.id))
        .map((orgUnit) => {
          const parent = orgUnits.find((candidate) => candidate.id === orgUnit.parentOrgUnitId);
          return {
            id: orgUnit.id,
            label: parent?.code ? `${parent.code} / ${orgUnit.code}` : orgUnit.code
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label)),
    [orgUnits, records]
  );

  const recordStatusOptions = useMemo(
    () => Array.from(new Set(records.map((record) => record.submissionStatus))).sort(),
    [records]
  );

  const displayedRecords = useMemo(() => {
    if (mode !== "learning") {
      return records;
    }

    const query = recordSearch.trim().toLocaleLowerCase();
    const filtered = records.filter((record) => {
      const areaLabel = getRecordAreaLabel(record, orgUnits);
      const matchesSearch =
        !query ||
        [record.title, areaLabel, formatStatus(record.submissionStatus), record.recordDate ?? ""]
          .some((value) => value.toLocaleLowerCase().includes(query));
      const matchesStatus = recordStatusFilter === "all" || record.submissionStatus === recordStatusFilter;
      const matchesArea = recordAreaFilter === "all" || record.orgUnitId === recordAreaFilter;
      return matchesSearch && matchesStatus && matchesArea;
    });

    return [...filtered].sort((left, right) => {
      if (recordSort === "oldest") {
        return getRecordTimestamp(left) - getRecordTimestamp(right);
      }
      if (recordSort === "area") {
        return getRecordAreaLabel(left, orgUnits).localeCompare(getRecordAreaLabel(right, orgUnits));
      }
      if (recordSort === "status") {
        return formatStatus(left.submissionStatus).localeCompare(formatStatus(right.submissionStatus));
      }
      return getRecordTimestamp(right) - getRecordTimestamp(left);
    });
  }, [mode, orgUnits, recordAreaFilter, recordSearch, recordSort, recordStatusFilter, records]);

  const hasRecordFilters =
    recordSearch.trim().length > 0 || recordStatusFilter !== "all" || recordAreaFilter !== "all" || recordSort !== "newest";

  useEffect(() => {
    setSelectedDetail(null);
    setIsCreating(false);
    setIsEditing(false);
    setIsActiveRecordsOpen(true);
    setRecordSearch("");
    setRecordStatusFilter("all");
    setRecordAreaFilter("all");
    setRecordSort("newest");
    setStatusMessage("");
    void refreshData();
    api.formDefinition(config.templateKey)
      .then((nextDefinition) => {
        setDefinition(nextDefinition);
        setDefinitionError("");
      })
      .catch(() => {
        setDefinition(null);
        setDefinitionError(
          `The ${config.recordLabel} form template could not be loaded. Check the database migrations have been applied.`
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    syncThemeResponse(createSections, setResponses, agreedTheme);
  }, [agreedTheme, createSections]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    syncThemeResponse(editSections, setEditResponses, editAgreedTheme);
  }, [editAgreedTheme, editSections, isEditing]);

  async function refreshData() {
    try {
      const [nextRecords, nextOrgUnits, nextActions] = await Promise.all([
        api.records(),
        api.orgUnits(),
        api.actions()
      ]);
      setRecords(nextRecords.filter((record) => record.recordType === config.recordType));
      setOrgUnits(nextOrgUnits.filter((orgUnit) => orgUnit.isActive));
      setActions(nextActions);

      if (mode === "learning") {
        const nextMappings = await api.learningWalkThemeMappings();
        setThemeMappings(nextMappings);
      }
    } catch {
      setStatusMessage("Data could not be loaded from the API.");
    }
  }

  function buildRecordContext(sections: Array<{ fields: FormFieldDefinition[] }>, values: Record<string, string>, theme: string, team?: OrgUnitSummary, faculty?: OrgUnitSummary) {
    const dateValue =
      getResponseValue(sections, values, "visit_date") ??
      getResponseValue(sections, values, "scrutiny_date") ??
      getResponseValue(sections, values, "date_time")?.slice(0, 10);
    const orgUnitId = getResponseValue(sections, values, "team_level") ?? getResponseValue(sections, values, "faculty_area");
    const subjectStaffId = getResponseValue(sections, values, "staff_id");
    let recordTitle: string;
    if (mode === "cpd") {
      recordTitle = getResponseValue(sections, values, "cpd_title") || "Untitled CPD event";
    } else {
      const areaCode = team?.code ?? faculty?.code ?? "Team";
      recordTitle = `${mode === "learning" ? "Learning Walk" : "Work Scrutiny"} - ${areaCode}`;
    }

    const summary =
      (mode === "learning" ? theme : undefined) ??
      getResponseValue(sections, values, "development_areas") ??
      getResponseValue(sections, values, "cpd_themes");

    return { dateValue, orgUnitId, subjectStaffId, recordTitle, summary };
  }

  function validateForSubmit(sections: Array<{ fields: FormFieldDefinition[] }>, values: Record<string, string>, facultyId?: string, teamId?: string, theme?: string) {
    if (mode === "learning" && facultyId && teamId && !theme) {
      return "No agreed Learning Walk theme is configured for that faculty and team.";
    }

    if (hasMissingRequired(sections, values)) {
      return "Complete the required fields before submitting. Use Save draft to keep partial work.";
    }

    return "";
  }

  async function saveRecord(asDraft: boolean) {
    if (!definition) {
      return;
    }

    if (!asDraft) {
      const validationMessage = validateForSubmit(createSections, responses, selectedFacultyId, selectedTeamId, agreedTheme);
      if (validationMessage) {
        setStatusMessage(validationMessage);
        return;
      }
    }

    const context = buildRecordContext(createSections, responses, agreedTheme, selectedTeam, selectedFaculty);
    setIsSaving(true);
    const result = await api.submitForm({
      templateKey: definition.templateKey,
      recordType: config.recordType,
      title: context.recordTitle,
      summary: context.summary,
      subjectStaffId: context.subjectStaffId,
      orgUnitId: context.orgUnitId,
      recordDate: context.dateValue,
      responses: flattenResponses(createSections, responses, false),
      saveAsDraft: asDraft
    });
    setIsSaving(false);

    if (result.ok) {
      setResponses({});
      setIsCreating(false);
      setStatusMessage(asDraft ? `${config.recordLabel} saved as draft.` : `${config.recordLabel} submitted.`);
      await refreshData();
    } else {
      setStatusMessage(result.message ?? `The ${config.recordLabel} could not be saved.`);
    }
  }

  async function openRecord(recordId: string) {
    try {
      const detail = await api.recordDetail(recordId);
      setSelectedDetail(detail);
      setIsEditing(false);
      setEditResponses({});
      setStatusMessage("");
    } catch {
      setStatusMessage("The record could not be opened. You may not have access to it.");
    }
  }

  function startEdit() {
    if (!selectedDetail?.canEdit) {
      setStatusMessage(
        selectedDetail?.submissionStatus === "submitted"
          ? "Submitted records are read-only. Ask the T&L team to reopen it for editing."
          : "This record is read-only for your account."
      );
      return;
    }

    setEditResponses(
      Object.fromEntries(
        selectedDetail.sections.flatMap((section) => section.fields.map((field) => [field.id, field.value ?? ""]))
      )
    );
    setIsCreating(false);
    setIsEditing(true);
    setStatusMessage("");
  }

  async function saveEdit() {
    if (!selectedDetail) {
      return;
    }

    if (selectedDetail.submissionStatus === "submitted") {
      const validationMessage = validateForSubmit(editSections, editResponses, editFacultyId, editTeamId, editAgreedTheme);
      if (validationMessage) {
        setStatusMessage(validationMessage);
        return;
      }
    }

    const context = buildRecordContext(editSections, editResponses, editAgreedTheme, editTeam, editFaculty);
    setIsSaving(true);
    const result = await api.updateFormSubmission(selectedDetail.submissionId, {
      title: context.recordTitle,
      summary: context.summary,
      subjectStaffId: context.subjectStaffId,
      orgUnitId: context.orgUnitId,
      recordDate: context.dateValue,
      responses: flattenResponses(editSections, editResponses, true)
    });
    setIsSaving(false);

    if (result.ok) {
      setStatusMessage(`${config.recordLabel} updated.`);
      setIsEditing(false);
      await refreshData();
      await openRecord(selectedDetail.id);
    } else {
      setStatusMessage(result.message ?? "The record could not be saved.");
    }
  }

  async function changeStatus(action: "submit" | "reopen" | "archive") {
    if (!selectedDetail) {
      return;
    }

    if (action === "archive" && !window.confirm("Archive this record? It will be hidden from lists and reporting.")) {
      return;
    }

    setIsSaving(true);
    const result = await api.changeSubmissionStatus(selectedDetail.submissionId, action);
    setIsSaving(false);

    if (result.ok) {
      setStatusMessage(
        action === "submit" ? `${config.recordLabel} submitted.` :
        action === "reopen" ? `${config.recordLabel} reopened for editing.` :
        `${config.recordLabel} archived.`
      );
      await refreshData();
      if (action === "archive") {
        setSelectedDetail(null);
      } else {
        await openRecord(selectedDetail.id);
      }
    } else {
      setStatusMessage(result.message ?? "The status could not be changed.");
    }
  }

  async function createLinkedAction() {
    if (!selectedDetail || !actionTitle.trim() || !actionOwnerId) {
      setStatusMessage("A linked action needs a title and an owner.");
      return;
    }

    setIsSaving(true);
    const result = await api.createAction({
      sourceRecordId: selectedDetail.id,
      ownerStaffId: actionOwnerId,
      title: actionTitle.trim(),
      dueDate: actionDueDate || undefined,
      publishedToStaff: true
    });
    setIsSaving(false);

    if (result.ok) {
      setStatusMessage("Linked action created.");
      setIsCreatingAction(false);
      setActionTitle("");
      setActionDueDate("");
      setActions(await api.actions().catch(() => actions));
      await onActionsChanged?.();
    } else {
      setStatusMessage(result.message ?? "The linked action could not be created.");
    }
  }

  async function completeLinkedAction(actionId: string) {
    const result = await api.updateAction(actionId, { status: "complete" });
    if (result.ok) {
      setStatusMessage("Linked action completed.");
      setActions(await api.actions().catch(() => actions));
      await onActionsChanged?.();
    } else {
      setStatusMessage(result.message ?? "The action could not be completed.");
    }
  }

  function toggleCreateForm() {
    setIsCreating((current) => !current);
    setIsEditing(false);
    setStatusMessage("");
  }

  function clearRecordFilters() {
    setRecordSearch("");
    setRecordStatusFilter("all");
    setRecordAreaFilter("all");
    setRecordSort("newest");
  }

  const linkedActions = selectedDetail
    ? actions.filter((action) => action.sourceRecordId === selectedDetail.id)
    : [];

  const detailStatus = selectedDetail?.submissionStatus ?? "";

  // Learning Walks are for programme leaders and above; tutors have no
  // learning_walk.submit permission and the API returns them no records.
  const canUseLearningWalks =
    mode !== "learning" ||
    user.permissions.includes("learning_walk.submit") ||
    user.permissions.includes("forms.manage") ||
    user.permissions.includes("reports.view_all");

  if (!canUseLearningWalks) {
    return (
      <div className="route-stack">
        <div className="route-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
          </div>
        </div>
        <section className="panel">
          <div className="panel-heading">
            <h2>Access restricted</h2>
            <span>Programme leaders and above</span>
          </div>
          <p className="muted-copy">
            Learning Walks are recorded by programme leaders and above. Actions arising from a walk appear on your
            Actions tab, and your own development record is on the Staff Profile tab.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="route-stack">
      <div className="route-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        {mode !== "learning" ? (
          <div className="toolbar">
            <Button icon={primaryIcon} onClick={toggleCreateForm} variant="primary">
              {config.createLabel}
            </Button>
          </div>
        ) : null}
      </div>

      {mode === "learning" ? (
        <div className="learning-create-action">
          <Button icon={primaryIcon} onClick={toggleCreateForm} variant="primary">
            {config.createLabel}
          </Button>
        </div>
      ) : null}

      {statusMessage ? <div className="notice-row">{statusMessage}</div> : null}
      {definitionError ? <div className="notice-row">{definitionError}</div> : null}

      {isCreating ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>{definition?.name ?? "Loading template"}</h2>
            <span>{definition?.version ? `Version ${definition.version}` : "Template backed"}</span>
          </div>
          {definition ? (
            <div className="entry-form">
              {definition.sections.map((section) => (
                <div className="entry-section" key={section.id}>
                  <h3>{section.title}</h3>
                  <div className="entry-field-grid">
                    {section.fields.map((field) => (
                      <FieldInput
                        field={field}
                        key={field.id}
                        onChange={(value) => setResponses((current) => updateResponseMap(createSections, current, field, value))}
                        orgUnits={orgUnits}
                        selectedFacultyId={selectedFacultyId}
                        staff={staff}
                        value={responses[field.id] ?? ""}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className="toolbar">
                <Button disabled={isSaving} icon={Save} onClick={() => void saveRecord(true)}>Save draft</Button>
                <Button disabled={isSaving} icon={Send} onClick={() => void saveRecord(false)} variant="primary">
                  {config.submitLabel}
                </Button>
              </div>
            </div>
          ) : (
            <p className="muted-copy">Loading form fields...</p>
          )}
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          {mode === "learning" ? (
            <h2>
              <button
                aria-controls="learning-walk-active-records"
                aria-expanded={isActiveRecordsOpen}
                className={`panel-collapse-button${isActiveRecordsOpen ? " is-open" : ""}`}
                onClick={() => setIsActiveRecordsOpen((current) => !current)}
                type="button"
              >
                <ChevronDown aria-hidden="true" size={18} />
                Active records
              </button>
            </h2>
          ) : (
            <h2>Active records</h2>
          )}
          <span>
            {mode === "learning" && displayedRecords.length !== records.length
              ? `${displayedRecords.length} of ${records.length}`
              : records.length}{" "}
            {config.recordLabel}{records.length === 1 ? "" : "s"}
          </span>
        </div>

        {mode !== "learning" || isActiveRecordsOpen ? (
          <div id={mode === "learning" ? "learning-walk-active-records" : undefined}>
            {mode === "learning" ? (
              <div className="record-filter-bar">
                <label className="record-filter-field record-filter-search">
                  <span>Search records</span>
                  <input
                    onChange={(event) => setRecordSearch(event.target.value)}
                    placeholder="Title, area, status or date"
                    type="search"
                    value={recordSearch}
                  />
                </label>
                <label className="record-filter-field">
                  <span>Status</span>
                  <select onChange={(event) => setRecordStatusFilter(event.target.value)} value={recordStatusFilter}>
                    <option value="all">All statuses</option>
                    {recordStatusOptions.map((status) => (
                      <option key={status} value={status}>{formatStatus(status)}</option>
                    ))}
                  </select>
                </label>
                <label className="record-filter-field">
                  <span>Faculty / team</span>
                  <select onChange={(event) => setRecordAreaFilter(event.target.value)} value={recordAreaFilter}>
                    <option value="all">All areas</option>
                    {recordAreaOptions.map((area) => (
                      <option key={area.id} value={area.id}>{area.label}</option>
                    ))}
                  </select>
                </label>
                <label className="record-filter-field">
                  <span>Sort by</span>
                  <select onChange={(event) => setRecordSort(event.target.value as typeof recordSort)} value={recordSort}>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="area">Area A-Z</option>
                    <option value="status">Status A-Z</option>
                  </select>
                </label>
                {hasRecordFilters ? (
                  <Button icon={X} onClick={clearRecordFilters} variant="quiet">Clear filters</Button>
                ) : null}
              </div>
            ) : null}

            <div className="record-list">
              {records.length === 0 ? (
                <div className="empty-row">
                  No {config.recordLabel}s yet. Use "{config.createLabel}" to add the first one.
                </div>
              ) : displayedRecords.length === 0 ? (
                <div className="empty-row">No {config.recordLabel}s match those filters.</div>
              ) : (
                displayedRecords.map((record) => {
                  const orgUnit = orgUnits.find((unit) => unit.id === record.orgUnitId);
                  const parent = orgUnits.find((unit) => unit.id === orgUnit?.parentOrgUnitId);
                  return (
                    <div className="record-row" key={record.id}>
                      <div>
                        <strong>{record.title}</strong>
                        <span>{parent?.code ? `${parent.code} / ${orgUnit?.code ?? "No team"}` : orgUnit?.code ?? "No team"}</span>
                      </div>
                      <span className={`status-pill status-${record.submissionStatus}`}>{formatStatus(record.submissionStatus)}</span>
                      <span>{record.recordDate ?? "No date"}</span>
                      <button className="icon-button" onClick={() => void openRecord(record.id)} type="button" title="Open record">
                        <Eye size={16} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </section>

      {selectedDetail ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>{selectedDetail.title}</h2>
            <span>v{selectedDetail.templateVersion}</span>
          </div>
          <div className="record-detail-meta">
            <span>{selectedDetail.parentOrgUnitCode ? `${selectedDetail.parentOrgUnitCode} / ` : ""}{selectedDetail.orgUnitCode ?? "No team"}</span>
            <span>{selectedDetail.recordDate ?? "No date"}</span>
            <span>{selectedDetail.ownerDisplayName ?? "No owner"}</span>
            <span className={`status-pill status-${detailStatus}`}>{formatStatus(detailStatus)}</span>
          </div>

          {isEditing ? (
            <div className="entry-form">
              {selectedDetail.sections.map((section) => (
                <div className="entry-section" key={section.id}>
                  <h3>{section.title}</h3>
                  <div className="entry-field-grid">
                    {section.fields.map((field) => (
                      <FieldInput
                        field={field}
                        key={field.id}
                        onChange={(value) => setEditResponses((current) => updateResponseMap(editSections, current, field, value))}
                        orgUnits={orgUnits}
                        selectedFacultyId={editFacultyId}
                        staff={staff}
                        value={editResponses[field.id] ?? ""}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className="toolbar">
                <Button icon={X} onClick={() => setIsEditing(false)}>Cancel</Button>
                <Button disabled={isSaving} icon={Save} onClick={() => void saveEdit()} variant="primary">Save changes</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="answer-section-list">
                {selectedDetail.sections.map((section) => (
                  <div className="answer-section" key={section.id}>
                    <h3>{section.title}</h3>
                    <div className="answer-grid">
                      {section.fields.map((field) => (
                        <div className={isWideEntryField(field.fieldType) ? "answer-item answer-item-wide" : "answer-item"} key={field.id}>
                          <span>{field.label}</span>
                          <strong>{formatAnswer(field.value, field.fieldType, orgUnits, staff)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="toolbar">
                {selectedDetail.canEdit ? (
                  <Button icon={Edit3} onClick={startEdit} variant="primary">Edit record</Button>
                ) : null}
                {(detailStatus === "draft" || detailStatus === "reopened") && selectedDetail.canEdit ? (
                  <Button disabled={isSaving} icon={Send} onClick={() => void changeStatus("submit")} variant="primary">Submit</Button>
                ) : null}
                {detailStatus === "submitted" && canManageForms ? (
                  <Button disabled={isSaving} icon={RotateCcw} onClick={() => void changeStatus("reopen")}>Reopen</Button>
                ) : null}
                {canManageForms ? (
                  <Button disabled={isSaving} icon={Archive} onClick={() => void changeStatus("archive")} variant="quiet">Archive</Button>
                ) : null}
                {canManageActions ? (
                  <Button icon={Plus} onClick={() => setIsCreatingAction((current) => !current)}>Linked action</Button>
                ) : null}
              </div>
            </>
          )}

          {isCreatingAction ? (
            <div className="entry-form">
              <div className="entry-field-grid">
                <label className="entry-field entry-field-wide">
                  <span>Action title <strong>Required</strong></span>
                  <input onChange={(event) => setActionTitle(event.target.value)} type="text" value={actionTitle} />
                </label>
                <label className="entry-field">
                  <span>Owner <strong>Required</strong></span>
                  <select onChange={(event) => setActionOwnerId(event.target.value)} value={actionOwnerId}>
                    <option value="">Select owner</option>
                    {staff.map((staffMember) => (
                      <option key={staffMember.id} value={staffMember.id}>{staffMember.displayName}</option>
                    ))}
                  </select>
                </label>
                <label className="entry-field">
                  <span>Due date</span>
                  <input onChange={(event) => setActionDueDate(event.target.value)} type="date" value={actionDueDate} />
                </label>
              </div>
              <div className="toolbar">
                <Button icon={X} onClick={() => setIsCreatingAction(false)}>Cancel</Button>
                <Button disabled={isSaving} icon={Plus} onClick={() => void createLinkedAction()} variant="primary">Create action</Button>
              </div>
            </div>
          ) : null}

          <div className="record-list">
            {linkedActions.length === 0 ? (
              <div className="empty-row">No linked actions for this {config.recordLabel}</div>
            ) : (
              linkedActions.map((action) => (
                <div className="record-row" key={action.id}>
                  <div>
                    <strong>{action.title}</strong>
                    <span>{action.ownerStaffName ?? "Unassigned"}</span>
                  </div>
                  <span className={`status-pill ${action.completedDate ? "status-closed" : "status-open"}`}>
                    {action.completedDate ? "Complete" : action.isOverdue ? "Overdue" : "Open"}
                  </span>
                  <span>{action.dueDate ?? "No date"}</span>
                  {!action.completedDate && (canManageActions || action.ownerStaffId === user.staffId) ? (
                    <button className="icon-button" onClick={() => void completeLinkedAction(action.id)} type="button" title="Mark complete">
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

function FieldInput({
  field,
  onChange,
  orgUnits,
  selectedFacultyId,
  staff,
  value
}: {
  field: FormFieldDefinition;
  onChange: (value: string) => void;
  orgUnits: OrgUnitSummary[];
  selectedFacultyId?: string;
  staff: StaffSummary[];
  value: string;
}) {
  const faculties = orgUnits.filter((orgUnit) => orgUnit.orgUnitType === "faculty");
  const teams = orgUnits.filter(
    (orgUnit) =>
      orgUnit.parentOrgUnitId === selectedFacultyId &&
      ["faculty_child_code", "faculty_child"].includes(orgUnit.orgUnitType)
  );
  const selectedFaculty = orgUnits.find((orgUnit) => orgUnit.id === selectedFacultyId);
  const teamOptions = teams.length > 0 ? teams : selectedFaculty ? [selectedFaculty] : [];
  const selectedValues = splitDelimitedValues(value);

  return (
    <label className={isWideEntryField(field.fieldType) ? "entry-field entry-field-wide" : "entry-field"}>
      <span>
        {field.label}
        {field.isRequired ? <strong>Required</strong> : null}
      </span>
      {field.fieldType === "date" ? (
        <input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
      ) : null}
      {field.fieldType === "datetime" ? (
        <input type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} />
      ) : null}
      {field.fieldType === "short_text" ? (
        <input type="text" value={value} onChange={(event) => onChange(event.target.value)} />
      ) : null}
      {field.fieldType === "number" ? (
        <input min="0" type="number" value={value} onChange={(event) => onChange(event.target.value)} />
      ) : null}
      {field.fieldType === "faculty_lookup" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select faculty</option>
          {faculties.map((orgUnit) => (
            <option key={orgUnit.id} value={orgUnit.id}>
              {orgUnit.code} - {orgUnit.name}
            </option>
          ))}
        </select>
      ) : null}
      {field.fieldType === "team_lookup" ? (
        <select disabled={!selectedFacultyId || teamOptions.length === 0} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{selectedFacultyId ? "Select team or faculty-wide area" : "Select faculty first"}</option>
          {teamOptions.map((orgUnit) => (
            <option key={orgUnit.id} value={orgUnit.id}>
              {orgUnit.code} - {orgUnit.name}
            </option>
          ))}
        </select>
      ) : null}
      {field.fieldType === "auto_text" ? (
        <input
          readOnly
          type="text"
          value={value || (selectedFacultyId ? "No agreed theme configured" : "Select faculty and team")}
        />
      ) : null}
      {field.fieldType === "staff_lookup" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select staff member</option>
          {staff.map((staffMember) => (
            <option key={staffMember.id} value={staffMember.id}>
              {staffMember.displayName}
            </option>
          ))}
        </select>
      ) : null}
      {field.fieldType === "staff_multi_select" ? (
        <select
          multiple
          onChange={(event) =>
            onChange(Array.from(event.currentTarget.selectedOptions).map((option) => option.value).join("|"))
          }
          value={selectedValues}
        >
          {staff.map((staffMember) => (
            <option key={staffMember.id} value={staffMember.id}>
              {staffMember.displayName}
            </option>
          ))}
        </select>
      ) : null}
      {field.fieldType === "team_bulk_add" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select faculty, child code or team</option>
          {orgUnits.map((orgUnit) => (
            <option key={orgUnit.id} value={orgUnit.id}>
              {orgUnit.code} - {orgUnit.name}
            </option>
          ))}
        </select>
      ) : null}
      {field.fieldType === "selected_staff_list" ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Confirm selected staff names or paste a staff list"
          rows={4}
        />
      ) : null}
      {field.fieldType === "single_select" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select option</option>
          {getSingleSelectOptions(field.fieldKey).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : null}
      {field.fieldType === "yes_no_partial" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select answer</option>
          <option value="Yes">Yes</option>
          <option value="Partially">Partially</option>
          <option value="No">No</option>
        </select>
      ) : null}
      {field.fieldType === "checkbox_group" ? (
        <div className="preview-check-list">
          {getCheckboxOptions(field.fieldKey).map((option) => (
            <label key={option}>
              <input
                checked={selectedValues.includes(option)}
                onChange={() => onChange(toggleDelimitedValue(value, option))}
                type="checkbox"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      ) : null}
      {field.fieldType === "long_text" ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} />
      ) : null}
      {field.helpText ? <small>{field.helpText}</small> : null}
    </label>
  );
}

const cpdThemeOptions = [
  "Teaching, learning and assessment",
  "Digital learning",
  "Assessment and feedback",
  "Inclusive practice",
  "Safeguarding and wellbeing",
  "Curriculum development"
];

const workScrutinyTagOptions = ["Good Practice", "Development", "Compliance", "Assessment", "Feedback"];

function getCheckboxOptions(fieldKey: string) {
  if (fieldKey === "cpd_themes") {
    return cpdThemeOptions;
  }

  return [];
}

function getSingleSelectOptions(fieldKey: string) {
  if (fieldKey === "finding_tag") {
    return workScrutinyTagOptions;
  }

  if (fieldKey === "delivery_mode") {
    return ["Face to face", "Online", "Blended", "Self-directed"];
  }

  return ["Yes", "No"];
}

function formatStatus(status: string) {
  switch (status) {
    case "draft":
      return "Draft";
    case "submitted":
      return "Submitted";
    case "reopened":
      return "Reopened";
    default:
      return status || "Submitted";
  }
}

function getRecordAreaLabel(record: RecordSummary, orgUnits: OrgUnitSummary[]) {
  const orgUnit = orgUnits.find((unit) => unit.id === record.orgUnitId);
  const parent = orgUnits.find((unit) => unit.id === orgUnit?.parentOrgUnitId);
  return parent?.code ? `${parent.code} / ${orgUnit?.code ?? "No team"}` : orgUnit?.code ?? "No team";
}

function getRecordTimestamp(record: RecordSummary) {
  const timestamp = Date.parse(record.recordDate ?? record.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isWideEntryField(fieldType: string) {
  return ["checkbox_group", "long_text", "selected_staff_list", "staff_multi_select", "team_bulk_add"].includes(
    fieldType
  );
}

function splitDelimitedValues(value?: string) {
  return value ? value.split("|").filter(Boolean) : [];
}

function toggleDelimitedValue(currentValue: string, option: string) {
  const values = splitDelimitedValues(currentValue);
  return values.includes(option)
    ? values.filter((value) => value !== option).join("|")
    : [...values, option].join("|");
}

function getAgreedTheme(
  mappings: LearningWalkThemeMappingSummary[],
  facultyOrgUnitId?: string,
  childOrgUnitId?: string
) {
  return mappings.find(
    (mapping) => mapping.facultyOrgUnitId === facultyOrgUnitId && mapping.childOrgUnitId === childOrgUnitId
  )?.agreedTheme ?? "";
}

function syncThemeResponse(
  sections: Array<{ fields: FormFieldDefinition[] }>,
  setResponse: Dispatch<SetStateAction<Record<string, string>>>,
  agreedTheme: string
) {
  const themeField = findField(sections, "learning_walk_theme");
  if (!themeField) {
    return;
  }

  setResponse((current) => {
    if ((current[themeField.id] ?? "") === agreedTheme) {
      return current;
    }

    return { ...current, [themeField.id]: agreedTheme };
  });
}

function updateResponseMap(
  sections: Array<{ fields: FormFieldDefinition[] }>,
  current: Record<string, string>,
  field: FormFieldDefinition,
  value: string
) {
  const next = { ...current, [field.id]: value };

  if (field.fieldKey === "faculty_area") {
    deleteFieldResponse(sections, next, "team_level");
    deleteFieldResponse(sections, next, "learning_walk_theme");
  }

  if (field.fieldKey === "team_level") {
    deleteFieldResponse(sections, next, "learning_walk_theme");
  }

  return next;
}

// Edits send every field (including cleared ones) so removed answers are archived server-side.
function flattenResponses(
  sections: Array<{ fields: FormFieldDefinition[] }>,
  responses: Record<string, string>,
  includeEmpty: boolean
) {
  return sections
    .flatMap((section) => section.fields)
    .map((field) => ({ fieldId: field.id, value: responses[field.id] }))
    .filter((response) => includeEmpty || response.value);
}

function hasMissingRequired(sections: Array<{ fields: FormFieldDefinition[] }>, responses: Record<string, string>) {
  return sections
    .flatMap((section) => section.fields)
    .some((field) => field.isRequired && !responses[field.id]);
}

function findField(sections: Array<{ fields: FormFieldDefinition[] }>, fieldKey: string) {
  return sections.flatMap((section) => section.fields).find((item) => item.fieldKey === fieldKey);
}

function deleteFieldResponse(sections: Array<{ fields: FormFieldDefinition[] }>, responses: Record<string, string>, fieldKey: string) {
  const field = findField(sections, fieldKey);
  if (field) {
    delete responses[field.id];
  }
}

function getResponseValue(
  sections: Array<{ fields: FormFieldDefinition[] }>,
  responses: Record<string, string>,
  fieldKey: string
) {
  const field = findField(sections, fieldKey);
  return field ? responses[field.id] : undefined;
}

function formatAnswer(
  value: string | undefined,
  fieldType: string,
  orgUnits: OrgUnitSummary[],
  staff: StaffSummary[]
) {
  if (!value) {
    return "Not recorded";
  }

  if (["faculty_lookup", "team_lookup", "team_bulk_add"].includes(fieldType)) {
    const orgUnit = orgUnits.find((unit) => unit.id === value);
    return orgUnit ? `${orgUnit.code} - ${orgUnit.name}` : value;
  }

  if (fieldType === "staff_lookup") {
    return staff.find((staffMember) => staffMember.id === value)?.displayName ?? value;
  }

  if (fieldType === "staff_multi_select") {
    return splitDelimitedValues(value)
      .map((staffId) => staff.find((staffMember) => staffMember.id === staffId)?.displayName ?? staffId)
      .join("\n");
  }

  if (fieldType === "checkbox_group") {
    return splitDelimitedValues(value).join("\n");
  }

  if (fieldType === "datetime") {
    return value.replace("T", " ");
  }

  return value;
}
