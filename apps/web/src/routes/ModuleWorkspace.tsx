import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Archive, Building2, CalendarPlus, CheckCircle2, ChevronDown, Edit3, Eye, FilePlus2, Plus, RotateCcw, Save, Send, X } from "lucide-react";
import { Button } from "../design-system/Button";
import { CpdParticipantPicker } from "../components/CpdParticipantPicker";
import { ExportExcelButton, ExportWordButton } from "../components/ExportButtons";
import { RoomSearchSelect } from "../components/RoomSearchSelect";
import { StaffSearchSelect } from "../components/StaffSearchSelect";
import { WorkScrutinyCreateForm } from "../components/WorkScrutinyCreateForm";
import { api } from "../services/api";
import type {
  ActionSummary,
  CurrentUser,
  ElevateEnvironmentPillarSummary,
  FormDefinition,
  FormFieldDefinition,
  LearningWalkTheme,
  LearningWalkThemeGroup,
  LearningWalkThemeMappingSummary,
  OrgUnitSummary,
  RecordDetail,
  RecordSummary,
  RoomSummary,
  StaffSummary
} from "../services/types";

type WorkspaceMode = "learning" | "scrutiny" | "cpd" | "elevate";

type DraftLinkedAction = {
  id: string;
  title: string;
  ownerStaffId: string;
  dueDate: string;
};

type ModuleWorkspaceProps = {
  academicYear: string;
  title: string;
  eyebrow: string;
  mode: WorkspaceMode;
  staff?: StaffSummary[];
  user: CurrentUser;
  onActionsChanged?: () => Promise<void>;
  initialRecordId?: string;
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
    recordLabel: "Elevate environment check",
    createLabel: "Start room check",
    submitLabel: "Complete check"
  }
};

const externalCpdConfig = {
  templateKey: "cpd_external_self_log",
  recordType: "cpd_event",
  recordLabel: "external CPD record",
  createLabel: "Log external CPD",
  submitLabel: "Submit CPD"
};

type CpdWorkspaceView = "managed" | "external";

export function ModuleWorkspace({ academicYear, title, eyebrow, mode, staff = [], user, onActionsChanged, initialRecordId = "" }: ModuleWorkspaceProps) {
  const canManageCpd = user.permissions.includes("cpd.manage");
  const [cpdWorkspaceView, setCpdWorkspaceView] = useState<CpdWorkspaceView>(canManageCpd ? "managed" : "external");
  const isExternalCpd = mode === "cpd" && (!canManageCpd || cpdWorkspaceView === "external");
  const config = isExternalCpd ? externalCpdConfig : workspaceConfig[mode];
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [definitionError, setDefinitionError] = useState("");
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [environmentPillars, setEnvironmentPillars] = useState<ElevateEnvironmentPillarSummary[]>([]);
  const [themeMappings, setThemeMappings] = useState<LearningWalkThemeMappingSummary[]>([]);
  const [learningWalkThemeGroups, setLearningWalkThemeGroups] = useState<LearningWalkThemeGroup[]>([]);
  const [draftActions, setDraftActions] = useState<DraftLinkedAction[]>([]);
  const [cpdThemes, setCpdThemes] = useState<string[]>([]);
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
  const openedInitialRecord = useRef("");

  const canManageForms = user.permissions.includes("forms.manage");
  const canManageActions = user.permissions.includes("actions.manage");
  const canExport = user.permissions.includes("exports.create");
  const exportModuleKey = mode === "learning"
    ? "learning-walks"
    : mode === "scrutiny"
      ? "work-scrutiny"
      : mode === "elevate" ? "elevate-environments" : "cpd";
  const primaryIcon = mode === "cpd" ? CalendarPlus : mode === "elevate" ? Building2 : FilePlus2;

  const createSections = definition?.sections ?? [];
  const createEntrySections = getEnvironmentEntrySections(mode, createSections, environmentPillars);
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
  const editEntrySections = getEnvironmentEntrySections(mode, editSections, environmentPillars);
  const detailSections = getEnvironmentEntrySections(mode, editSections, environmentPillars);
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
    let cancelled = false;
    setSelectedDetail(null);
    setIsCreating(false);
    setIsEditing(false);
    setDefinition(null);
    setDefinitionError("");
    setIsActiveRecordsOpen(true);
    setRecordSearch("");
    setRecordStatusFilter("all");
    setRecordAreaFilter("all");
    setRecordSort("newest");
    setStatusMessage("");
    void refreshData();
    if (mode === "scrutiny") {
      return;
    }
    api.formDefinition(config.templateKey)
      .then((nextDefinition) => {
        if (cancelled) return;
        setDefinition(nextDefinition);
        setDefinitionError("");
      })
      .catch(() => {
        if (cancelled) return;
        setDefinition(null);
        setDefinitionError(
          `The ${config.recordLabel} form template could not be loaded. Check the database migrations have been applied.`
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicYear, config.templateKey, mode]);

  useEffect(() => {
    if (initialRecordId && openedInitialRecord.current !== initialRecordId) {
      openedInitialRecord.current = initialRecordId;
      void openRecord(initialRecordId);
    }
    // openRecord is intentionally invoked only when a route supplies a new target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRecordId]);

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
      const [nextRecords, nextOrgUnits, nextActions, nextRooms, nextLookups, nextEnvironmentPillars] = await Promise.all([
        api.records(academicYear),
        api.orgUnits(),
        api.actions(),
        mode === "elevate" ? api.rooms() : Promise.resolve([] as RoomSummary[]),
        mode === "cpd" ? api.lookups() : Promise.resolve([]),
        mode === "elevate" ? api.elevateEnvironmentPillars() : Promise.resolve([] as ElevateEnvironmentPillarSummary[])
      ]);
      setRecords(nextRecords.filter((record) => record.recordType === config.recordType));
      setOrgUnits(nextOrgUnits.filter((orgUnit) => orgUnit.isActive));
      setActions(nextActions.filter((action) => action.academicYear === academicYear));
      setRooms(nextRooms);
      setCpdThemes(nextLookups.find((lookup) => lookup.lookupKey === "cpd_theme")?.values ?? []);
      setEnvironmentPillars(nextEnvironmentPillars);

      if (mode === "learning") {
        const [nextMappings, nextThemeGroups] = await Promise.all([
          api.learningWalkThemeMappings(),
          api.learningWalkThemes()
        ]);
        setThemeMappings(nextMappings);
        setLearningWalkThemeGroups(nextThemeGroups);
      }
    } catch {
      setStatusMessage("Data could not be loaded from the API.");
    }
  }

  function buildRecordContext(
    sections: Array<{ fields: FormFieldDefinition[] }>,
    values: Record<string, string>,
    theme: string,
    team?: OrgUnitSummary,
    faculty?: OrgUnitSummary,
    externalCpdRecord = isExternalCpd
  ) {
    const dateValue =
      getResponseValue(sections, values, "visit_date") ??
      getResponseValue(sections, values, "scrutiny_date") ??
      getResponseValue(sections, values, "assessment_date") ??
      getResponseValue(sections, values, "date_time")?.slice(0, 10);
    const orgUnitId = mode === "elevate"
      ? undefined
      : getResponseValue(sections, values, "team_level") ?? getResponseValue(sections, values, "faculty_area");
    const subjectStaffId = getResponseValue(sections, values, "staff_id");
    let recordTitle: string;
    if (mode === "cpd") {
      const cpdTitle = getResponseValue(sections, values, "cpd_title") || "Untitled CPD event";
      recordTitle = externalCpdRecord ? `External CPD - ${cpdTitle}` : cpdTitle;
    } else if (mode === "elevate") {
      recordTitle = `Elevate check - ${getResponseValue(sections, values, "room_code") || "Room"}`;
    } else {
      const areaCode = team?.code ?? faculty?.code ?? "Team";
      recordTitle = `${mode === "learning" ? "Learning Walk" : "Work Scrutiny"} - ${areaCode}`;
    }

    const summary = mode === "elevate"
      ? getResponseValue(sections, values, "building_name")
      : (mode === "learning" ? theme : undefined) ??
      getResponseValue(sections, values, "development_areas") ??
      getResponseValue(sections, values, "cpd_themes");

    return {
      dateValue,
      orgUnitId,
      subjectStaffId: externalCpdRecord ? user.staffId : subjectStaffId,
      recordTitle,
      summary
    };
  }

  function validateForSubmit(
    sections: Array<{ fields: FormFieldDefinition[] }>,
    values: Record<string, string>,
    facultyId?: string,
    teamId?: string,
    theme?: string,
    externalCpdRecord = isExternalCpd
  ) {
    if (mode === "learning" && facultyId && teamId && !theme) {
      return "No agreed Learning Walk theme is configured for that faculty and team.";
    }

    if (mode === "elevate") {
      const roomCode = getResponseValue(sections, values, "room_code");
      if (!rooms.some((room) => room.roomCode.toLocaleLowerCase() === roomCode?.toLocaleLowerCase())) {
        return "Select a room from the room register before completing the check.";
      }

    }

    if (mode === "cpd") {
      const hoursValue = getResponseValue(sections, values, "duration_hours");
      const minutesValue = getResponseValue(sections, values, "duration_minutes");
      const hours = Number(hoursValue);
      const minutes = Number(minutesValue);
      if (!hoursValue || !minutesValue || !Number.isInteger(hours) || hours < 0 || hours > 24
          || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
        return "Enter CPD duration using hours from 0 to 24 and minutes from 0 to 59.";
      }
      if ((hours * 60) + minutes === 0) {
        return "CPD duration must be at least one minute.";
      }
      if (!externalCpdRecord && !getResponseValue(sections, values, "staff_search")) {
        return "Select at least one participant before submitting the CPD event.";
      }
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

    if ((mode === "learning" || mode === "elevate") && asDraft && draftActions.length > 0) {
      setStatusMessage(`Submit the ${config.recordLabel} to assign its actions, or remove the actions before saving a draft.`);
      return;
    }

    if (!asDraft) {
      const validationMessage = validateForSubmit(createEntrySections, responses, selectedFacultyId, selectedTeamId, agreedTheme);
      if (validationMessage) {
        setStatusMessage(validationMessage);
        return;
      }

      if (mode === "learning") {
        const otherValidation = validateLearningWalkOtherContext(
          createSections,
          responses,
          learningWalkThemeGroups
        );
        if (otherValidation) {
          setStatusMessage(otherValidation);
          return;
        }

      }

      if ((mode === "learning" || mode === "elevate")
          && draftActions.some((action) => !action.title.trim() || !action.ownerStaffId || !action.dueDate)) {
        setStatusMessage(
          mode === "elevate"
            ? "Every added action needs an action, owner and review date."
            : "Every added action needs an action, owner and implementation date."
        );
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
      responses: flattenResponses(createEntrySections, responses, false),
      saveAsDraft: asDraft,
      actions: (mode === "learning" || mode === "elevate") && !asDraft
        ? draftActions.map((action) => ({
            title: action.title.trim(),
            ownerStaffId: action.ownerStaffId,
            dueDate: action.dueDate
          }))
        : undefined
    });
    setIsSaving(false);

    if (result.ok) {
      setResponses({});
      setDraftActions([]);
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
      const validationMessage = validateForSubmit(
        editEntrySections,
        editResponses,
        editFacultyId,
        editTeamId,
        editAgreedTheme,
        selectedDetail.templateKey === externalCpdConfig.templateKey
      );
      if (validationMessage) {
        setStatusMessage(validationMessage);
        return;
      }

      if (mode === "learning") {
        const otherValidation = validateLearningWalkOtherContext(
          editSections,
          editResponses,
          learningWalkThemeGroups
        );
        if (otherValidation) {
          setStatusMessage(otherValidation);
          return;
        }
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
      : buildRecordContext(
          editSections,
          editResponses,
          editAgreedTheme,
          editTeam,
          editFaculty,
          selectedDetail.templateKey === externalCpdConfig.templateKey
        );
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
    const requiresDueDate = mode === "learning" || mode === "elevate";
    if (!selectedDetail || !actionTitle.trim() || !actionOwnerId || (requiresDueDate && !actionDueDate)) {
      setStatusMessage(
        mode === "learning"
          ? "A Learning Walk action needs an action, owner and implementation date."
          : mode === "elevate"
            ? "A Learning Environment action needs an action, owner and date for review."
            : "A linked action needs a title and an owner."
      );
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
      setActions((await api.actions().catch(() => actions)).filter((action) => action.academicYear === academicYear));
      await onActionsChanged?.();
    } else {
      setStatusMessage(result.message ?? "The linked action could not be created.");
    }
  }

  async function completeLinkedAction(actionId: string) {
    const result = await api.updateAction(actionId, { status: "complete" });
    if (result.ok) {
      setStatusMessage("Linked action completed.");
      setActions((await api.actions().catch(() => actions)).filter((action) => action.academicYear === academicYear));
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
      if (!current && (mode === "learning" || mode === "elevate")) {
        setDraftActions([]);
      }
      return !current;
    });
    setIsEditing(false);
    setStatusMessage("");
  }

  function addDraftAction() {
    setDraftActions((current) => [
      ...current,
      { id: crypto.randomUUID(), title: "", ownerStaffId: "", dueDate: "" }
    ]);
  }

  function updateDraftAction(id: string, changes: Partial<DraftLinkedAction>) {
    setDraftActions((current) => current.map((action) => action.id === id ? { ...action, ...changes } : action));
  }

  function clearRecordFilters() {
    setRecordSearch("");
    setRecordStatusFilter("all");
    setRecordAreaFilter("all");
    setRecordSort("newest");
  }

  function changeCpdWorkspaceView(nextView: CpdWorkspaceView) {
    setCpdWorkspaceView(nextView);
    setIsCreating(false);
    setIsEditing(false);
    setSelectedDetail(null);
    setResponses({});
    setStatusMessage("");
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

  if (!canUseLearningWalks || !canUseElevate) {
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
              ? "Elevate Learning Environment checks are completed by leaders, managers and the Teaching & Learning team."
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
        {mode !== "learning" ? (
          <div className="toolbar">
            {canExport ? <ExportExcelButton filters={{ academicYear }} moduleKey={exportModuleKey} /> : null}
            {mode === "cpd" && canManageCpd ? (
              <div className="segmented-control" aria-label="CPD form">
                <button
                  className={cpdWorkspaceView === "managed" ? "is-active" : ""}
                  onClick={() => changeCpdWorkspaceView("managed")}
                  type="button"
                >
                  Manage CPD events
                </button>
                <button
                  className={cpdWorkspaceView === "external" ? "is-active" : ""}
                  onClick={() => changeCpdWorkspaceView("external")}
                  type="button"
                >
                  Log external CPD
                </button>
              </div>
            ) : null}
            <Button icon={primaryIcon} onClick={toggleCreateForm} variant="primary">
              {config.createLabel}
            </Button>
          </div>
        ) : canExport ? <ExportExcelButton filters={{ academicYear }} moduleKey={exportModuleKey} /> : null}
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
              {isExternalCpd ? (
                <div className="record-context-note">
                  <strong>Staff member</strong>
                  <span>{user.displayName}</span>
                </div>
              ) : null}
              {mode === "elevate" ? (
                <div className="elevate-rubric-guide">
                  <strong>Fit for purpose is the core test</strong>
                  <span>2 is the expected secure standard. Use 3 only where the environment clearly adds value.</span>
                  <span>A serious safety or access barrier requires an immediate action.</span>
                  <div className="elevate-score-legend" aria-label="Elevate score guide">
                    <span><b>0</b> Barrier</span>
                    <span><b>1</b> Emerging</span>
                    <span><b>2</b> Secure</span>
                    <span><b>3</b> Elevate</span>
                  </div>
                  <small>Created by {user.displayName}</small>
                </div>
              ) : null}
              {createEntrySections.map((section) => (
                <div className="entry-section" key={section.id}>
                  <EnvironmentPillarHeader pillar={getEnvironmentPillar(mode, section.sectionKey, environmentPillars)} title={section.title} />
                  <div className="entry-field-grid">
                    {section.fields
                      .filter((field) => !isLegacyCpdParticipantField(mode, field))
                      .filter((field) => shouldShowLearningWalkField(mode, field, createSections, responses, learningWalkThemeGroups))
                      .map((field) => (
                      <FieldInput
                        cpdThemes={cpdThemes}
                        field={field.fieldKey === "additional_focus_other" ? { ...field, isRequired: true } : field}
                        key={field.id}
                        learningWalkThemeGroups={learningWalkThemeGroups}
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
              {mode === "learning" || mode === "elevate" ? (
                <div className="entry-section">
                  <div className="section-heading-row">
                    <div>
                      <h3>Actions</h3>
                      <small>
                        {mode === "elevate"
                          ? "Actions are assigned through the central action engine when the check is completed."
                          : "Actions are assigned through the central action engine when the walk is submitted."}
                      </small>
                    </div>
                    <Button icon={Plus} onClick={addDraftAction}>Action</Button>
                  </div>
                  {draftActions.length === 0 ? (
                    <div className="empty-row">No actions added.</div>
                  ) : (
                    <div className="scrutiny-action-list">
                      {draftActions.map((action, index) => (
                        <div className="scrutiny-action-row" key={action.id}>
                          <label className="entry-field scrutiny-action-text">
                            <span>Action {index + 1} <strong>Required</strong></span>
                            <textarea
                              maxLength={300}
                              onChange={(event) => updateDraftAction(action.id, { title: event.target.value })}
                              rows={3}
                              value={action.title}
                            />
                          </label>
                          <label className="entry-field">
                            <span>Owner <strong>Required</strong></span>
                            <StaffSearchSelect
                              id={`submission-action-owner-${action.id}`}
                              onChange={(ownerStaffId) => updateDraftAction(action.id, { ownerStaffId })}
                              staff={staff}
                              value={action.ownerStaffId}
                            />
                          </label>
                          <label className="entry-field">
                            <span>{mode === "elevate" ? "Date for review" : "Date to be implemented by"} <strong>Required</strong></span>
                            <input
                              min={getResponseValue(createSections, responses, mode === "elevate" ? "assessment_date" : "visit_date")}
                              onChange={(event) => updateDraftAction(action.id, { dueDate: event.target.value })}
                              type="date"
                              value={action.dueDate}
                            />
                          </label>
                          <button
                            aria-label={`Remove action ${index + 1}`}
                            className="icon-button scrutiny-action-remove"
                            onClick={() => setDraftActions((current) => current.filter((candidate) => candidate.id !== action.id))}
                            title="Remove action"
                            type="button"
                          >
                            <X size={16} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
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
            <h2>{mode === "cpd" && !canManageCpd ? "My CPD records" : "Active records"}</h2>
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
                        <span>
                          {mode === "elevate"
                            ? "Room environment assessment"
                            : parent?.code ? `${parent.code} / ${orgUnit?.code ?? "No team"}` : orgUnit?.code ?? "No team"}
                        </span>
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
              {editEntrySections.map((section) => (
                <div className="entry-section" key={section.id}>
                  <EnvironmentPillarHeader pillar={getEnvironmentPillar(mode, section.sectionKey, environmentPillars)} title={section.title} />
                  <div className="entry-field-grid">
                    {section.fields
                      .filter((field) => !isLegacyCpdParticipantField(mode, field))
                      .filter((field) => shouldShowLearningWalkField(mode, field, editSections, editResponses, learningWalkThemeGroups))
                      .map((field) => (
                      <FieldInput
                        cpdThemes={cpdThemes}
                        field={field.fieldKey === "additional_focus_other" ? { ...field, isRequired: true } : field}
                        key={field.id}
                        learningWalkThemeGroups={learningWalkThemeGroups}
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
                {detailSections.map((section) => (
                  <div className="answer-section" key={section.id}>
                    <EnvironmentPillarHeader pillar={getEnvironmentPillar(mode, section.sectionKey, environmentPillars)} title={section.title} />
                    <div className="answer-grid">
                      {section.fields
                        .filter((field) => !isLegacyCpdParticipantField(mode, field))
                        .filter((field) => field.fieldKey !== "additional_focus_other" || Boolean(field.value))
                        .map((field) => (
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
                {canExport ? <ExportWordButton recordId={selectedDetail.id} /> : null}
                {selectedDetail.canEdit ? (
                  <Button icon={Edit3} onClick={startEdit} variant="primary">Edit record</Button>
                ) : null}
                {(detailStatus === "draft" || detailStatus === "reopened") && selectedDetail.canEdit ? (
                  <Button disabled={isSaving} icon={Send} onClick={() => void changeStatus("submit")} variant="primary">Submit</Button>
                ) : null}
                {detailStatus === "submitted" && canManageForms ? (
                  <Button disabled={isSaving} icon={RotateCcw} onClick={() => void changeStatus("reopen")}>Reopen</Button>
                ) : null}
                {canManageForms && (mode !== "scrutiny" || user.permissions.includes("users.manage")) ? (
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
                  <StaffSearchSelect
                    id={`linked-action-owner-${selectedDetail.id}`}
                    onChange={setActionOwnerId}
                    staff={staff}
                    value={actionOwnerId}
                  />
                </label>
                <label className="entry-field">
                  <span>
                    {mode === "elevate" ? "Date for review" : "Date to be implemented by"}
                    {mode === "learning" || mode === "elevate" ? <strong>Required</strong> : null}
                  </span>
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
  rooms,
  selectedFacultyId,
  staff,
  cpdThemes,
  learningWalkThemeGroups,
  value
}: {
  cpdThemes: string[];
  field: FormFieldDefinition;
  onChange: (value: string) => void;
  orgUnits: OrgUnitSummary[];
  rooms: RoomSummary[];
  selectedFacultyId?: string;
  staff: StaffSummary[];
  learningWalkThemeGroups: LearningWalkThemeGroup[];
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

  if (field.fieldType === "room_lookup") {
    return (
      <div className="entry-field">
        <span>
          {field.label}
          {field.isRequired ? <strong>Required</strong> : null}
        </span>
        <RoomSearchSelect id={`room-${field.id}`} onChange={onChange} rooms={rooms} value={value} />
        {field.helpText ? <small>{field.helpText}</small> : null}
      </div>
    );
  }

  if (field.fieldType === "learning_walk_theme_group") {
    const selected = parseLearningWalkThemeSelections(value);
    const selectedIds = selected.map((theme) => theme.id);
    return (
      <div className="entry-field entry-field-wide learning-walk-theme-picker">
        <span>
          {field.label}
          {field.isRequired ? <strong>Required</strong> : null}
        </span>
        <div className="learning-walk-theme-picker-groups">
          {learningWalkThemeGroups.map((group) => {
            const visibleThemes = group.themes.filter((theme) => theme.isActive || selectedIds.includes(theme.id));
            if (visibleThemes.length === 0) {
              return null;
            }

            return (
              <fieldset key={group.id}>
                <legend>{group.name}</legend>
                {visibleThemes.map((theme) => (
                  <label key={theme.id}>
                    <input
                      checked={selectedIds.includes(theme.id)}
                      disabled={!theme.isActive && !selectedIds.includes(theme.id)}
                      onChange={() => onChange(toggleLearningWalkTheme(value, theme, group))}
                      type="checkbox"
                    />
                    <span>{theme.name}{theme.isActive ? "" : " (inactive)"}</span>
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
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
        <input
          inputMode="numeric"
          max={field.fieldKey === "duration_hours" ? 24 : field.fieldKey === "duration_minutes" ? 59 : undefined}
          min="0"
          onChange={(event) => onChange(event.target.value)}
          step="1"
          type="number"
          value={value}
        />
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
      {field.fieldType === "rubric_scale" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select rubric level</option>
          {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
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

function EnvironmentPillarHeader({
  pillar,
  title
}: {
  pillar?: ElevateEnvironmentPillarSummary;
  title: string;
}) {
  if (!pillar) {
    return <h3>{title}</h3>;
  }

  return (
    <div className="environment-pillar-heading">
      <img alt={pillar.assetAltText} loading="lazy" src={pillar.assetUri} />
      <div>
        <span>Learning environment pillar{pillar.isActive ? "" : " · Inactive"}</span>
        <h3>{pillar.name}</h3>
        <p>{pillar.description}</p>
      </div>
    </div>
  );
}

type EnvironmentSectionLike = {
  sectionKey: string;
  title: string;
  displayOrder: number;
  fields: Array<{ fieldKey: string }>;
};

const environmentPillarKeys = ["aspirational", "collaborative", "respectful", "innovative", "inclusion"];

function isRetiredEnvironmentField(fieldKey: string) {
  return fieldKey === "intended_purpose"
    || environmentPillarKeys.some((pillarKey) =>
      [`${pillarKey}_action`, `${pillarKey}_owner`, `${pillarKey}_target`].includes(fieldKey));
}

function getEnvironmentPillar(
  mode: WorkspaceMode,
  sectionKey: string,
  pillars: ElevateEnvironmentPillarSummary[]
) {
  return mode === "elevate" ? pillars.find((pillar) => pillar.pillarKey === sectionKey) : undefined;
}

function getEnvironmentEntrySections<T extends EnvironmentSectionLike>(
  mode: WorkspaceMode,
  sections: T[],
  pillars: ElevateEnvironmentPillarSummary[]
) {
  if (mode !== "elevate") {
    return sections;
  }

  const byKey = new Map(pillars.map((pillar) => [pillar.pillarKey, pillar]));
  return orderEnvironmentSections(
    mode,
    pillars.length === 0
      ? sections
      : sections.filter((section) => !byKey.has(section.sectionKey) || byKey.get(section.sectionKey)?.isActive),
    pillars
  ).map((section) => ({
    ...section,
    title: section.sectionKey === "room_context" ? "Room" : section.title,
    fields: section.fields.filter((field) => !isRetiredEnvironmentField(field.fieldKey))
  })) as T[];
}

function orderEnvironmentSections<T extends EnvironmentSectionLike>(
  mode: WorkspaceMode,
  sections: T[],
  pillars: ElevateEnvironmentPillarSummary[]
) {
  if (mode !== "elevate" || pillars.length === 0) {
    return sections;
  }

  const byKey = new Map(pillars.map((pillar) => [pillar.pillarKey, pillar]));
  return [...sections].sort((left, right) => {
    const leftPillar = byKey.get(left.sectionKey);
    const rightPillar = byKey.get(right.sectionKey);
    const leftOrder = leftPillar ? 1000 + leftPillar.displayOrder : left.displayOrder;
    const rightOrder = rightPillar ? 1000 + rightPillar.displayOrder : right.displayOrder;
    return leftOrder - rightOrder;
  });
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
  return ["checkbox_group", "multi_select", "long_text", "selected_staff_list", "staff_multi_select", "team_bulk_add", "learning_walk_theme_group"].includes(
    fieldType
  );
}

function isLegacyCpdParticipantField(mode: WorkspaceMode, field: FormFieldDefinition) {
  return mode === "cpd" && ["team_bulk_add", "selected_staff_list"].includes(field.fieldType);
}

function splitDelimitedValues(value?: string) {
  return value ? value.split("|").filter(Boolean) : [];
}

type LearningWalkThemeSelection = {
  id: string;
  name: string;
  groupName: string;
  isOther: boolean;
};

function parseLearningWalkThemeSelections(value?: string): LearningWalkThemeSelection[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as LearningWalkThemeSelection[];
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item?.id === "string" && typeof item?.name === "string")
      : [];
  } catch {
    return [];
  }
}

function toggleLearningWalkTheme(
  currentValue: string,
  theme: LearningWalkTheme,
  group: LearningWalkThemeGroup
) {
  const selected = parseLearningWalkThemeSelections(currentValue);
  const next = selected.some((item) => item.id === theme.id)
    ? selected.filter((item) => item.id !== theme.id)
    : [...selected, { id: theme.id, name: theme.name, groupName: group.name, isOther: theme.isOther }];
  return JSON.stringify(next);
}

function shouldShowLearningWalkField(
  mode: WorkspaceMode,
  field: FormFieldDefinition,
  sections: Array<{ fields: FormFieldDefinition[] }>,
  responses: Record<string, string>,
  groups: LearningWalkThemeGroup[]
) {
  if (mode !== "learning" || field.fieldKey !== "additional_focus_other") {
    return true;
  }

  const themeValue = getResponseValue(sections, responses, "additional_focus_context");
  const otherThemeIds = groups.flatMap((group) => group.themes).filter((theme) => theme.isOther).map((theme) => theme.id);
  return parseLearningWalkThemeSelections(themeValue).some((selection) =>
    selection.isOther || otherThemeIds.includes(selection.id));
}

function validateLearningWalkOtherContext(
  sections: Array<{ fields: FormFieldDefinition[] }>,
  responses: Record<string, string>,
  groups: LearningWalkThemeGroup[]
) {
  const otherField = findField(sections, "additional_focus_other");
  if (!otherField || shouldShowLearningWalkField("learning", otherField, sections, responses, groups)
      && responses[otherField.id]?.trim()) {
    return "";
  }

  return shouldShowLearningWalkField("learning", otherField, sections, responses, groups)
    ? "Describe the other focus or context before submitting the Learning Walk."
    : "";
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

  if (fieldType === "staff_multi_select") {
    return splitDelimitedValues(value)
      .map((staffId) => staff.find((staffMember) => staffMember.id === staffId)?.displayName ?? staffId)
      .join("\n");
  }

  if (["checkbox_group", "multi_select"].includes(fieldType)) {
    return splitDelimitedValues(value).join("\n");
  }

  if (fieldType === "learning_walk_theme_group") {
    const selections = parseLearningWalkThemeSelections(value);
    if (selections.length === 0) {
      return "Not recorded";
    }

    return selections
      .map((selection) => `${selection.groupName}: ${selection.name}`)
      .join("\n");
  }

  if (fieldType === "datetime") {
    return value.replace("T", " ");
  }

  return value;
}

const elevateScoreLabels: Record<string, string> = {
  "0": "0 - Barrier",
  "1": "1 - Emerging",
  "2": "2 - Secure",
  "3": "3 - Elevate"
};

function getTodayDate() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}
