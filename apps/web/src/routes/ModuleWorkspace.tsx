import { useEffect, useMemo, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { Archive, Building2, CalendarPlus, CheckCircle2, ChevronDown, Download, Edit3, Eye, FilePlus2, Plus, RotateCcw, Save, Send, X } from "lucide-react";
import { Button } from "../design-system/Button";
import { CpdParticipantPicker } from "../components/CpdParticipantPicker";
import { ActionDetailLink, FullRecordLink } from "../components/FullRecordLink";
import { StaffSearchSelect } from "../components/StaffSearchSelect";
import { WorkScrutinyCreateForm } from "../components/WorkScrutinyCreateForm";
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
  RoomSummary,
  StaffSummary
} from "../services/types";

type WorkspaceMode = "learning" | "scrutiny" | "cpd" | "elevate";

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
  },
  elevate: {
    templateKey: "elevate_learning_environments_core",
    recordType: "elevate_environment",
    recordLabel: "Elevate Learning Environment audit",
    createLabel: "Start Audit",
    submitLabel: "Complete audit"
  }
};

const externalCpdConfig = {
  templateKey: "external_cpd_core",
  recordType: "external_cpd",
  recordLabel: "external CPD record",
  createLabel: "Log External CPD",
  submitLabel: "Submit external CPD"
};

export function ModuleWorkspace({ title, eyebrow, mode, staff = [], user, onActionsChanged }: ModuleWorkspaceProps) {
  const [cpdEntryMode, setCpdEntryMode] = useState<"event" | "external">(
    user.permissions.includes("cpd.manage") ? "event" : "external"
  );
  const config = mode === "cpd" && cpdEntryMode === "external" ? externalCpdConfig : workspaceConfig[mode];
  const recordCollectionLabel = mode === "cpd" ? "CPD record" : config.recordLabel;
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [definitionError, setDefinitionError] = useState("");
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [themeMappings, setThemeMappings] = useState<LearningWalkThemeMappingSummary[]>([]);
  const [cpdThemes, setCpdThemes] = useState<string[]>([]);
  const [records, setRecords] = useState<RecordSummary[]>([]);
  const [isActiveRecordsOpen, setIsActiveRecordsOpen] = useState(false);
  const [recordSearch, setRecordSearch] = useState("");
  const [recordStatusFilter, setRecordStatusFilter] = useState("all");
  const [recordAreaFilter, setRecordAreaFilter] = useState("all");
  const [recordTypeFilter, setRecordTypeFilter] = useState("all");
  const [recordStartDate, setRecordStartDate] = useState("");
  const [recordEndDate, setRecordEndDate] = useState("");
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
  const { canCreateCpdEvent, canCreateExternalCpd } = getCpdEntryPermissions(user);
  const primaryIcon = mode === "cpd" ? CalendarPlus : mode === "elevate" ? Building2 : FilePlus2;

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
    const query = recordSearch.trim().toLocaleLowerCase();
    const filtered = records.filter((record) => {
      const areaLabel = getRecordAreaLabel(record, orgUnits);
      const matchesSearch =
        !query ||
        [record.title, areaLabel, formatStatus(record.submissionStatus), record.recordDate ?? ""]
          .some((value) => value.toLocaleLowerCase().includes(query));
      const matchesStatus = recordStatusFilter === "all" || record.submissionStatus === recordStatusFilter;
      const matchesArea = recordAreaFilter === "all" || record.orgUnitId === recordAreaFilter;
      const matchesType = recordTypeFilter === "all" || record.recordType === recordTypeFilter;
      const date = (record.recordDate ?? record.createdAt).slice(0, 10);
      const matchesStart = !recordStartDate || date >= recordStartDate;
      const matchesEnd = !recordEndDate || date <= recordEndDate;
      return matchesSearch && matchesStatus && matchesArea && matchesType && matchesStart && matchesEnd;
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
  }, [orgUnits, recordAreaFilter, recordEndDate, recordSearch, recordSort, recordStartDate, recordStatusFilter, recordTypeFilter, records]);

  const hasRecordFilters =
    recordSearch.trim().length > 0 || recordStatusFilter !== "all" || recordAreaFilter !== "all" ||
    recordTypeFilter !== "all" || Boolean(recordStartDate) || Boolean(recordEndDate) || recordSort !== "newest";

  useEffect(() => {
    setSelectedDetail(null);
    setIsCreating(false);
    setIsEditing(false);
    setIsActiveRecordsOpen(false);
    setRecordSearch("");
    setRecordStatusFilter("all");
    setRecordAreaFilter("all");
    setRecordTypeFilter("all");
    setRecordStartDate("");
    setRecordEndDate("");
    setRecordSort("newest");
    setStatusMessage("");
    void refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    setResponses({});
    setSelectedDetail(null);
    setIsEditing(false);
    if (mode === "scrutiny") {
      setDefinition(null);
      setDefinitionError("");
      return;
    }
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
  }, [mode, config.templateKey]);

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
      const [nextRecords, nextOrgUnits, nextActions, nextRooms, nextLookups] = await Promise.all([
        api.records(),
        api.orgUnits(),
        api.actions(),
        mode === "elevate" ? api.rooms() : Promise.resolve([] as RoomSummary[]),
        mode === "cpd" ? api.lookups() : Promise.resolve([])
      ]);
      setRecords(nextRecords.filter((record) => mode === "cpd"
        ? ["cpd_event", "external_cpd"].includes(record.recordType)
        : record.recordType === config.recordType));
      setOrgUnits(nextOrgUnits.filter((orgUnit) => orgUnit.isActive));
      setActions(nextActions);
      setRooms(nextRooms);
      setCpdThemes(nextLookups.find((lookup) => lookup.lookupKey === "cpd_theme")?.values ?? []);

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
      getResponseValue(sections, values, "assessment_date") ??
      getResponseValue(sections, values, "date_time")?.slice(0, 10);
    const orgUnitId = mode === "elevate"
      ? undefined
      : getResponseValue(sections, values, "team_level") ?? getResponseValue(sections, values, "faculty_area");
    const subjectStaffId = mode === "cpd" && config.recordType === "external_cpd"
      ? user.staffId
      : getResponseValue(sections, values, "staff_id");
    let recordTitle: string;
    if (mode === "cpd") {
      recordTitle = getResponseValue(sections, values, "cpd_title") || "Untitled CPD event";
    } else if (mode === "elevate") {
      recordTitle = `Elevate audit - ${getResponseValue(sections, values, "room_code") || "Room"}`;
    } else {
      const areaCode = team?.code ?? faculty?.code ?? "Team";
      recordTitle = `${mode === "learning" ? "Learning Walk" : "Work Scrutiny"} - ${areaCode}`;
    }

    const summary = mode === "elevate"
      ? getResponseValue(sections, values, "building_name")
      : (mode === "learning" ? theme : undefined) ??
      getResponseValue(sections, values, "development_areas") ??
      getResponseValue(sections, values, "cpd_themes");

    return { dateValue, orgUnitId, subjectStaffId, recordTitle, summary };
  }

  function validateForSubmit(sections: Array<{ fields: FormFieldDefinition[] }>, values: Record<string, string>, facultyId?: string, teamId?: string, theme?: string) {
    if (mode === "learning" && facultyId && teamId && !theme) {
      return "No agreed Learning Walk theme is configured for that faculty and team.";
    }

    if (mode === "elevate") {
      const roomCode = getResponseValue(sections, values, "room_code");
      if (!rooms.some((room) => room.roomCode.toLocaleLowerCase() === roomCode?.toLocaleLowerCase())) {
        return "Select a room from the room register before completing the audit.";
      }

      for (const valueKey of elevateValueKeys) {
        const action = getResponseValue(sections, values, `${valueKey}_action`);
        const owner = getResponseValue(sections, values, `${valueKey}_owner`);
        const target = getResponseValue(sections, values, `${valueKey}_target`);
        if (action && (!owner || !target)) {
          return `The ${formatElevateValue(valueKey)} action needs an owner and target date.`;
        }
      }
    }

    if (mode === "cpd" && config.recordType === "cpd_event" && !getResponseValue(sections, values, "staff_search")) {
      return "Select at least one participant before submitting the CPD event.";
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

    const context = mode === "scrutiny"
      ? {
          dateValue: selectedDetail.recordDate,
          orgUnitId: selectedDetail.orgUnitId,
          subjectStaffId: undefined,
          recordTitle: selectedDetail.title,
          summary: selectedDetail.summary
        }
      : buildRecordContext(editSections, editResponses, editAgreedTheme, editTeam, editFaculty);
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
    setIsCreating((current) => {
      if (!current && mode === "elevate") {
        const dateField = findField(createSections, "assessment_date");
        setResponses(dateField ? { [dateField.id]: getTodayDate() } : {});
      }
      return !current;
    });
    setIsEditing(false);
    setStatusMessage("");
  }

  function activateCpdForm(entryMode: "event" | "external") {
    const isSameForm = cpdEntryMode === entryMode;
    setCpdEntryMode(entryMode);
    setIsCreating((current) => isSameForm ? !current : true);
    setIsEditing(false);
    setStatusMessage("");
  }

  function clearRecordFilters() {
    setRecordSearch("");
    setRecordStatusFilter("all");
    setRecordAreaFilter("all");
    setRecordTypeFilter("all");
    setRecordStartDate("");
    setRecordEndDate("");
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

  const canUseElevate =
    mode !== "elevate" ||
    user.permissions.includes("elevate.submit") ||
    user.permissions.includes("elevate.manage") ||
    user.permissions.includes("forms.manage") ||
    user.permissions.includes("reports.view_all");

  const canUseCpd = mode !== "cpd" || canCreateCpdEvent || canCreateExternalCpd;

  if (!canUseLearningWalks || !canUseElevate || !canUseCpd) {
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
            {mode === "elevate"
              ? "Elevate Learning Environment audits are completed by leaders, managers and the Teaching & Learning team."
              : mode === "cpd"
                ? "Your account does not have permission to create a CPD event or log external CPD."
                : "Learning Walks are recorded by programme leaders and above. Actions arising from a walk appear on your Actions tab, and your own development record is on the Staff Profile tab."}
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
        {mode !== "learning" && mode !== "cpd" ? (
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

      {mode === "cpd" ? (
        <div className={`cpd-entry-actions ${(canCreateCpdEvent && canCreateExternalCpd) ? "" : "cpd-entry-actions-single"}`.trim()}>
          {canCreateCpdEvent ? (
            <Button icon={CalendarPlus} onClick={() => activateCpdForm("event")} variant={cpdEntryMode === "event" && isCreating ? "primary" : "secondary"}>
              Log a CPD Event
            </Button>
          ) : null}
          {canCreateExternalCpd ? (
            <Button icon={FilePlus2} onClick={() => activateCpdForm("external")} variant={cpdEntryMode === "external" && isCreating ? "primary" : "secondary"}>
              Log External CPD
            </Button>
          ) : null}
        </div>
      ) : null}

      {statusMessage ? <div className="notice-row">{statusMessage}</div> : null}
      {definitionError ? <div className="notice-row">{definitionError}</div> : null}

      {isCreating && mode === "scrutiny" ? (
        <WorkScrutinyCreateForm
          onCancel={() => setIsCreating(false)}
          onSubmitted={async (recordId) => {
            setIsCreating(false);
            setStatusMessage("Work Scrutiny submitted with its sampled courses and linked actions.");
            await refreshData();
            await openRecord(recordId);
            await onActionsChanged?.();
          }}
          orgUnits={orgUnits}
          staff={staff}
          user={user}
        />
      ) : null}

      {isCreating && mode !== "scrutiny" ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>{definition?.name ?? "Loading template"}</h2>
            <span>{definition?.version ? `Version ${definition.version}` : "Template backed"}</span>
          </div>
          {definition ? (
            <div className="entry-form">
              {mode === "elevate" ? (
                <div className="elevate-rubric-guide">
                  <strong>Fit for purpose is the core test</strong>
                  <span>Judge each specialist or general environment against its intended curriculum purpose.</span>
                  <span>Secure Practice (3) is the expected standard. Scores 4 and 5 mean the environment actively improves learning.</span>
                  <div className="elevate-score-legend" aria-label="Elevate score guide">
                    <span><b>1</b> Emerging</span>
                    <span><b>2</b> Developing</span>
                    <span><b>3</b> Secure</span>
                    <span><b>4</b> Strong</span>
                    <span><b>5</b> Exceptional</span>
                  </div>
                  <small>Created by {user.displayName}</small>
                </div>
              ) : null}
              {definition.sections.map((section) => (
                <div className="entry-section" key={section.id}>
                  <h3>{section.title}</h3>
                  <div className="entry-field-grid">
                    {section.fields.filter((field) => !isLegacyCpdParticipantField(mode, field)).map((field) => (
                      <FieldInput
                        cpdThemes={cpdThemes}
                        field={field}
                        key={field.id}
                        onChange={(value) => setResponses((current) => updateResponseMap(createSections, current, field, value, rooms))}
                        orgUnits={orgUnits}
                        rooms={rooms}
                        selectedFacultyId={selectedFacultyId}
                        staff={staff}
                        value={responses[field.id] ?? ""}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className="toolbar">
                {mode !== "elevate" ? (
                  <Button disabled={isSaving} icon={Save} onClick={() => void saveRecord(true)}>Save draft</Button>
                ) : null}
                <Button disabled={isSaving} icon={mode === "elevate" ? CheckCircle2 : Send} onClick={() => void saveRecord(false)} variant="primary">
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
          <h2>
            <button
              aria-controls={`${mode}-active-records`}
              aria-expanded={isActiveRecordsOpen}
              className={`panel-collapse-button${isActiveRecordsOpen ? " is-open" : ""}`}
              onClick={() => setIsActiveRecordsOpen((current) => !current)}
              type="button"
            >
              <ChevronDown aria-hidden="true" size={18} />
              Active records
            </button>
          </h2>
          <span>
            {displayedRecords.length !== records.length
              ? `${displayedRecords.length} of ${records.length}`
              : records.length}{" "}
            {recordCollectionLabel}{records.length === 1 ? "" : "s"}
          </span>
        </div>

        {isActiveRecordsOpen ? (
          <div id={`${mode}-active-records`}>
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
                {mode === "cpd" ? (
                  <label className="record-filter-field">
                    <span>Record type</span>
                    <select onChange={(event) => setRecordTypeFilter(event.target.value)} value={recordTypeFilter}>
                      <option value="all">All CPD</option>
                      <option value="cpd_event">CPD events</option>
                      <option value="external_cpd">External CPD</option>
                    </select>
                  </label>
                ) : null}
                <label className="record-filter-field">
                  <span>From</span>
                  <input onChange={(event) => setRecordStartDate(event.target.value)} type="date" value={recordStartDate} />
                </label>
                <label className="record-filter-field">
                  <span>To</span>
                  <input onChange={(event) => setRecordEndDate(event.target.value)} type="date" value={recordEndDate} />
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
                <Button
                  disabled={displayedRecords.length === 0}
                  icon={Download}
                  onClick={() => exportRecordSummaries(displayedRecords, orgUnits, title)}
                  variant="secondary"
                >
                  Export filtered CSV
                </Button>
              </div>

            <div className="record-list">
              {records.length === 0 ? (
                <div className="empty-row">
                  No {recordCollectionLabel}s are available in your permitted scope.
                </div>
              ) : displayedRecords.length === 0 ? (
                <div className="empty-row">No {recordCollectionLabel}s match those filters.</div>
              ) : (
                displayedRecords.map((record) => {
                  const orgUnit = orgUnits.find((unit) => unit.id === record.orgUnitId);
                  const parent = orgUnits.find((unit) => unit.id === orgUnit?.parentOrgUnitId);
                  return (
                    <div className="record-row" key={record.id}>
                      <div>
                        <strong>{record.title}</strong>
                        <span>
                          {mode === "elevate"
                            ? "Learning environment audit"
                            : parent?.code ? `${parent.code} / ${orgUnit?.code ?? "No team"}` : orgUnit?.code ?? "No team"}
                        </span>
                      </div>
                      <span className={`status-pill status-${record.submissionStatus}`}>{formatStatus(record.submissionStatus)}</span>
                      <span>{record.recordDate ?? "No date"}</span>
                      <FullRecordLink label="Open record" recordId={record.id} recordType={record.recordType} />
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
            <span>
              {mode === "elevate"
                ? selectedDetail.summary ?? "Room environment"
                : `${selectedDetail.parentOrgUnitCode ? `${selectedDetail.parentOrgUnitCode} / ` : ""}${selectedDetail.orgUnitCode ?? "No team"}`}
            </span>
            <span>{selectedDetail.recordDate ?? "No date"}</span>
            <span>{selectedDetail.ownerDisplayName ?? "No owner"}</span>
            <span className={`status-pill status-${detailStatus}`}>{formatStatus(detailStatus)}</span>
          </div>
          {mode === "scrutiny" && selectedDetail.summary ? (
            <div className="record-context-note">
              <strong>Courses sampled</strong>
              <span>{selectedDetail.summary}</span>
            </div>
          ) : null}

          {isEditing ? (
            <div className="entry-form">
              {selectedDetail.sections.map((section) => (
                <div className="entry-section" key={section.id}>
                  <h3>{section.title}</h3>
                  <div className="entry-field-grid">
                    {section.fields.filter((field) => !isLegacyCpdParticipantField(mode, field)).map((field) => (
                      <FieldInput
                        cpdThemes={cpdThemes}
                        field={field}
                        key={field.id}
                        onChange={(value) => setEditResponses((current) => updateResponseMap(editSections, current, field, value, rooms))}
                        orgUnits={orgUnits}
                        rooms={rooms}
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
                      {section.fields.filter((field) => !isLegacyCpdParticipantField(mode, field)).map((field) => (
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
                <FullRecordLink label="Open full record" recordId={selectedDetail.id} recordType={selectedDetail.recordType} />
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
                    <ActionDetailLink actionId={action.id} />
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
  rooms,
  selectedFacultyId,
  staff,
  cpdThemes,
  value
}: {
  cpdThemes: string[];
  field: FormFieldDefinition;
  onChange: (value: string) => void;
  orgUnits: OrgUnitSummary[];
  rooms: RoomSummary[];
  selectedFacultyId?: string;
  staff: StaffSummary[];
  value: string;
}) {
  const faculties = orgUnits.filter((orgUnit) => orgUnit.orgUnitType === "faculty");
  const teams = orgUnits.filter(
    (orgUnit) =>
      orgUnit.parentOrgUnitId === selectedFacultyId &&
      ["team", "faculty_child_code", "faculty_child"].includes(orgUnit.orgUnitType)
  );
  const selectedFaculty = orgUnits.find((orgUnit) => orgUnit.id === selectedFacultyId);
  const teamOptions = teams.length > 0 ? teams : selectedFaculty ? [selectedFaculty] : [];
  const selectedValues = splitDelimitedValues(value);

  if (field.fieldType === "staff_multi_select" && field.fieldKey === "staff_search") {
    return (
      <div className="entry-field entry-field-wide">
        <span>
          {field.label}
          {field.isRequired ? <strong>Required</strong> : null}
        </span>
        <CpdParticipantPicker
          id={`participants-${field.id}`}
          onChange={onChange}
          orgUnits={orgUnits}
          staff={staff}
          value={value}
        />
      </div>
    );
  }

  if (isRubricField(field.fieldType)) {
    const options = (field.options ?? []).map(parseRubricOption);
    return (
      <div className="entry-field entry-field-wide rubric-entry-field">
        <span>
          {field.label}
          {field.isRequired ? <strong>Required</strong> : null}
        </span>
        <div aria-label={field.label} className="rubric-option-grid" role="radiogroup">
          {options.map((option) => {
            const isSelected = value === option.value;
            return (
              <button
                aria-checked={isSelected}
                className={`rubric-option${isSelected ? " rubric-option-selected" : ""}`}
                key={option.value}
                onClick={() => onChange(option.value)}
                role="radio"
                style={{ "--rubric-color": option.color } as CSSProperties}
                type="button"
              >
                <strong>{option.label}</strong>
                {isSelected ? <span className="rubric-selected-label">Selected</span> : null}
              </button>
            );
          })}
        </div>
        {options.some((option) => option.descriptor) ? (
          <details className="rubric-descriptor-guide">
            <summary>Read the full {field.label.toLocaleLowerCase()} rubric</summary>
            <ol>
              {options.map((option) => (
                <li key={option.value} style={{ "--rubric-color": option.color } as CSSProperties}>
                  <strong>{option.label}</strong>
                  <span>{option.descriptor}</span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
        {field.helpText ? <small>{field.helpText}</small> : null}
      </div>
    );
  }

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
      {field.fieldType === "room_lookup" ? (
        <>
          <input
            autoComplete="off"
            list={`room-options-${field.id}`}
            onChange={(event) => onChange(event.target.value.toLocaleUpperCase())}
            placeholder="Start typing a room code"
            role="combobox"
            type="text"
            value={value}
          />
          <datalist id={`room-options-${field.id}`}>
            {rooms.map((room) => (
              <option key={room.id} value={room.roomCode}>{room.buildingName}</option>
            ))}
          </datalist>
        </>
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
          value={value || (field.fieldKey === "building_name"
            ? "Select a room code"
            : selectedFacultyId ? "No agreed theme configured" : "Select faculty and team")}
        />
      ) : null}
      {field.fieldType === "score_0_3" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select score</option>
          <option value="0">0 - Barrier</option>
          <option value="1">1 - Emerging</option>
          <option value="2">2 - Secure</option>
          <option value="3">3 - Elevate</option>
        </select>
      ) : null}
      {field.fieldType === "staff_lookup" ? (
        <StaffSearchSelect
          helperText="Start typing, then select the action owner from the results."
          id={`staff-${field.id}`}
          onChange={onChange}
          staff={staff}
          value={value}
        />
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
          {(field.options?.length ? field.options : getSingleSelectOptions(field.fieldKey)).map((option) => (
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
          {(field.options?.length ? field.options : getCheckboxOptions(field.fieldKey, cpdThemes)).map((option) => (
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
      {field.fieldType === "multi_select" ? (
        <div className="preview-check-list">
          {(field.options ?? []).map((option) => (
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

const workScrutinyTagOptions = ["Good Practice", "Development", "Compliance", "Assessment", "Feedback"];

function getCheckboxOptions(fieldKey: string, cpdThemes: string[]) {
  if (fieldKey === "cpd_themes") {
    return cpdThemes;
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
  return isRubricField(fieldType) || ["checkbox_group", "multi_select", "long_text", "selected_staff_list", "staff_multi_select", "team_bulk_add"].includes(
    fieldType
  );
}

function exportRecordSummaries(records: RecordSummary[], orgUnits: OrgUnitSummary[], title: string) {
  const rows = [
    ["Record ID", "Record type", "Title", "Date", "Faculty", "Team", "Status"],
    ...records.map((record) => {
      const team = orgUnits.find((unit) => unit.id === record.orgUnitId);
      const faculty = orgUnits.find((unit) => unit.id === team?.parentOrgUnitId) ?? team;
      return [
        record.id,
        record.recordType,
        record.title,
        record.recordDate ?? "",
        faculty?.code ?? "",
        team?.code ?? "",
        record.submissionStatus
      ];
    })
  ];
  const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  link.download = `${title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}-filtered.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function isRubricField(fieldType: string) {
  return fieldType === "rubric_scale" || fieldType.endsWith("rubric_1_5");
}

function parseRubricOption(value: string) {
  const [score, label, descriptor, color] = value.split("::");
  if (label) {
    return { value, score, label, descriptor: descriptor ?? "", color: color || "#0F766E" };
  }
  const simpleMatch = value.match(/^(\d+)\s*[-:]\s*(.+)$/);
  return {
    value,
    score: simpleMatch?.[1] ?? "",
    label: simpleMatch?.[2] ?? value,
    descriptor: "",
    color: "#0F766E"
  };
}

export function getCpdEntryPermissions(user: Pick<CurrentUser, "permissions">) {
  return {
    canCreateCpdEvent: user.permissions.includes("cpd.manage"),
    canCreateExternalCpd: user.permissions.includes("cpd.external.submit")
  };
}

function isLegacyCpdParticipantField(mode: WorkspaceMode, field: FormFieldDefinition) {
  return mode === "cpd" && ["team_bulk_add", "selected_staff_list"].includes(field.fieldType);
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
  value: string,
  rooms: RoomSummary[] = []
) {
  const next = { ...current, [field.id]: value };

  if (field.fieldKey === "faculty_area") {
    deleteFieldResponse(sections, next, "team_level");
    deleteFieldResponse(sections, next, "learning_walk_theme");
  }

  if (field.fieldKey === "team_level") {
    deleteFieldResponse(sections, next, "learning_walk_theme");
  }

  if (field.fieldKey === "room_code") {
    const buildingField = findField(sections, "building_name");
    const room = rooms.find((candidate) => candidate.roomCode.toLocaleLowerCase() === value.toLocaleLowerCase());
    if (buildingField) {
      next[buildingField.id] = room?.buildingName ?? "";
    }
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

  if (fieldType === "score_0_3") {
    return elevateScoreLabels[value] ?? value;
  }

  if (isRubricField(fieldType)) {
    const option = parseRubricOption(value);
    return option.descriptor
      ? `${option.label} (Level ${option.score})\n${option.descriptor}`
      : option.label;
  }

  if (fieldType === "staff_multi_select") {
    return splitDelimitedValues(value)
      .map((staffId) => staff.find((staffMember) => staffMember.id === staffId)?.displayName ?? staffId)
      .join("\n");
  }

  if (["checkbox_group", "multi_select"].includes(fieldType)) {
    return splitDelimitedValues(value).join("\n");
  }

  if (fieldType === "datetime") {
    return value.replace("T", " ");
  }

  return value;
}

const elevateValueKeys = ["aspirational", "collaborative", "respectful", "innovative", "inclusion"] as const;

const elevateScoreLabels: Record<string, string> = {
  "0": "0 - Barrier",
  "1": "1 - Emerging",
  "2": "2 - Secure",
  "3": "3 - Elevate"
};

function formatElevateValue(valueKey: string) {
  return valueKey.charAt(0).toLocaleUpperCase() + valueKey.slice(1);
}

function getTodayDate() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}
