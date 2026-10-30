import { LoadingState } from "../components/LoadingState";
import { hasFormAnswer, isCustomChoiceField, normalizeFormAnswer, parseChoiceAnswers, serializeChoiceAnswers } from "../services/formChoiceAnswers";
import { useWorkflowPagination, WorkflowPagination } from "../components/WorkflowPagination";
import { WorkflowErrorSummary } from "../components/WorkflowErrorSummary";
import { focusWorkflowControl, requiredWorkflowMessage, workflowDescription, type WorkflowFieldError } from "../services/workflowExperience";
import { WorkflowFeedback } from "../components/WorkflowFeedback";
import { WorkflowFilters } from "../components/WorkflowFilters";
import { learningWalkDeliveryChoices, type LearningWalkDeliveryArea } from "../services/learningWalkDeliveryAreas";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Archive, Building2, CalendarPlus, CheckCircle2, ChevronDown, Edit3, Eye, FilePlus2, Plus, RotateCcw, Save, Send, Upload, X } from "lucide-react";
import { Button } from "../design-system/Button";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { DraftActionsEditor } from "../components/DraftActionsEditor";
import { useActionOwners } from "../components/useActionOwners";
import { ActionThemeSelect } from "../components/ActionThemeSelect";
import { CpdParticipantPicker } from "../components/CpdParticipantPicker";
import { ExportExcelButton, ExportWordButton } from "../components/ExportButtons";
import { RoomSearchSelect } from "../components/RoomSearchSelect";
import { StaffSearchSelect } from "../components/StaffSearchSelect";
import { WorkScrutinyCreateForm, WorkScrutinyResponseField } from "../components/WorkScrutinyCreateForm";
import { api } from "../services/api";
import { distinctListValues, sortListRows } from "../services/listQuery";
import { selectWorkspaceRecords } from "../services/workflowListQueries";
import { canUseAdminCsvImport } from "../services/csvImportPresentation";
import type {
  ActionOwnerOption,
  ActionSummary,
  CoachingRubricOption,
  CurrentUser,
  DraftFormAction,
  ElevateEnvironmentPillarSummary,
  FormDefinition,
  FormFieldDefinition,
  LearningWalkTheme,
  LearningWalkThemeGroup,
  OrgUnitSummary,
  RecordDetail,
  RecordSummary,
  RoomSummary,
  StaffSummary
} from "../services/types";

type WorkspaceMode = "learning" | "als_learning" | "scrutiny" | "cpd" | "elevate";

type DraftLinkedAction = {
  id: string;
  actionTheme: string;
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
  onRecordOpened?: (recordId: string) => void;
  onRecordClosed?: () => void;
  onOpenCsvImport?: () => void | Promise<void>;
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
  als_learning: {
    templateKey: "learning_walk_core",
    recordType: "als_learning_walk",
    recordLabel: "ALS Learning Walk",
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
    createLabel: "Log a CPD Event",
    submitLabel: "Submit event"
  },
  elevate: {
    templateKey: "elevate_learning_environments_core",
    recordType: "elevate_environment",
    recordLabel: "Elevate environment check",
    createLabel: "Start Audit",
    submitLabel: "Complete check"
  }
};

const externalCpdConfig = {
  templateKey: "cpd_external_self_log",
  recordType: "cpd_event",
  recordLabel: "external CPD record",
  createLabel: "Log External CPD",
  submitLabel: "Submit CPD"
};

const mandatoryCpdConfig = { ...workspaceConfig.cpd, templateKey: "cpd_mandatory", recordLabel: "mandatory CPD record", createLabel: "Log Mandatory CPD" };

type CpdWorkspaceView = "managed" | "external" | "mandatory";

export function ModuleWorkspace({ academicYear, title, eyebrow, mode, staff = [], user, onActionsChanged, initialRecordId = "", onRecordOpened, onRecordClosed, onOpenCsvImport }: ModuleWorkspaceProps) {
  const canManageCpd = user.permissions.includes("cpd.manage");
  const canLogMandatoryCpd = mode === "cpd" && user.permissions.includes("cpd.mandatory_log");
  const canLogCpdEvent = mode === "cpd" && canManageCpd;
  const canLogExternalCpd = mode === "cpd"
    && Boolean(user.staffId)
    && user.permissions.includes("cpd.self_log");
  const cpdCreateOptionCount = Number(canLogCpdEvent) + Number(canLogExternalCpd) + Number(canLogMandatoryCpd);
  const [cpdWorkspaceView, setCpdWorkspaceView] = useState<CpdWorkspaceView>(canManageCpd ? "managed" : canLogMandatoryCpd ? "mandatory" : "external");
  const isExternalCpd = mode === "cpd" && cpdWorkspaceView === "external";
  const config = isExternalCpd ? externalCpdConfig : mode === "cpd" && cpdWorkspaceView === "mandatory" ? mandatoryCpdConfig : workspaceConfig[mode];
  const listRecordLabel = mode === "cpd" && !isExternalCpd ? "CPD event" : config.recordLabel;
  const isLearningWalkMode = mode === "learning" || mode === "als_learning";
  const learningWalkProcess = mode === "als_learning" ? "als_learning_walk" : "learning_walk";
  const requiresLeaderActionOwner = isLearningWalkMode || mode === "elevate";
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingRecords, setIsLoadingRecords] = useState(true);
  const [recordsLoadFailed, setRecordsLoadFailed] = useState(false);
  const refreshRequest = useRef(0);
  const detailRequest = useRef(0);
  const detailOrigin = useRef<HTMLElement | null>(null);
  const [openingRecordId, setOpeningRecordId] = useState("");
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [definitionError, setDefinitionError] = useState("");
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [environmentPillars, setEnvironmentPillars] = useState<ElevateEnvironmentPillarSummary[]>([]);
  const [learningWalkThemeGroups, setLearningWalkThemeGroups] = useState<LearningWalkThemeGroup[]>([]);
  const [deliveryAreas, setDeliveryAreas] = useState<LearningWalkDeliveryArea[]>([]);
  const [deliveryAreasLoaded, setDeliveryAreasLoaded] = useState(false);
  const [practiceRubric, setPracticeRubric] = useState<CoachingRubricOption[]>([]);
  const [draftActions, setDraftActions] = useState<DraftLinkedAction[]>([]);
  const [editDraftActions, setEditDraftActions] = useState<DraftFormAction[]>([]);
  const { owners: leaderActionOwners, loading: ownersLoading, error: ownersError, retry: retryOwners } = useActionOwners(undefined, undefined, config.recordType, requiresLeaderActionOwner);
  const [cpdThemes, setCpdThemes] = useState<string[]>([]);
  const [records, setRecords] = useState<RecordSummary[]>([]);
  const [isActiveRecordsOpen, setIsActiveRecordsOpen] = useState(true);
  const [recordOwnershipView, setRecordOwnershipView] = useState<"mine" | "scope">("mine");
  const [recordSearch, setRecordSearch] = useState("");
  const [recordStatusFilter, setRecordStatusFilter] = useState("all");
  const [recordAreaFilter, setRecordAreaFilter] = useState("all");
  const [recordSort, setRecordSort] = useState("newest");
  const [recordTypeFilter, setRecordTypeFilter] = useState("all");
  const [recordThemeFilter, setRecordThemeFilter] = useState("all");
  const [recordPersonFilter, setRecordPersonFilter] = useState("all");
  const [recordParticipantFilter, setRecordParticipantFilter] = useState("all");
  const [recordDeliveryFilter, setRecordDeliveryFilter] = useState("all");
  const [recordRoomFilter, setRecordRoomFilter] = useState("all");
  const [recordFrom, setRecordFrom] = useState("");
  const [recordTo, setRecordTo] = useState("");
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<RecordDetail | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [editResponses, setEditResponses] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [validationErrors, setValidationErrors] = useState<WorkflowFieldError[]>([]);
  const [isCreatingAction, setIsCreatingAction] = useState(false);
  const [actionTheme, setActionTheme] = useState("");
  const [actionTitle, setActionTitle] = useState("");
  const [actionOwnerId, setActionOwnerId] = useState(user.staffId ?? "");
  const [actionDueDate, setActionDueDate] = useState("");
  const openedInitialRecord = useRef("");
  const editBaseline = useRef("");
  const clearNavigation = useUnsavedChanges({ label: config.recordLabel, saving: isSaving,
    submission: isCreating && mode !== "scrutiny" || isEditing && selectedDetail?.submissionStatus !== "submitted",
    submitLabel: isEditing ? "Submit" : config.submitLabel,
    onSubmit: isEditing
      ? selectedDetail?.canEdit && ["draft", "reopened"].includes(selectedDetail.submissionStatus) ? submitEditedForm : undefined
      : isCreating && mode !== "scrutiny" ? () => saveRecord(false) : undefined,
    dirty: (isCreating && mode !== "scrutiny" && (Object.values(responses).some(Boolean) || draftActions.length > 0))
      || (isEditing && JSON.stringify([editResponses, editDraftActions]) !== editBaseline.current),
    onSave: () => isEditing ? saveEdit() : saveRecord(true),
    onDiscard: () => { setIsCreating(false); setIsEditing(false); setResponses({}); setDraftActions([]); }
  });
  const clearActionNavigation = useUnsavedChanges({ label: "Linked action", saving: isSaving && isCreatingAction,
    submission: true, submitLabel: "Create action", onSubmit: () => createLinkedAction(),
    dirty: isCreatingAction && Boolean(actionTheme || actionTitle || actionDueDate),
    onDiscard: () => { setIsCreatingAction(false); setActionTheme(""); setActionTitle(""); setActionDueDate(""); } });

  const canManageForms = user.permissions.includes("forms.manage");
  const canManageActions = user.permissions.includes("actions.manage");
  const canExport = user.permissions.includes("exports.create");
  const exportModuleKey = isLearningWalkMode
    ? mode === "als_learning" ? "als-learning-walks" : "learning-walks"
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
  const selectedLearningWalkFocuses = parseLearningWalkThemeSelections(
    getResponseValue(createSections, responses, "additional_focus_context")
  );
  const actionOwnerStaff = useMemo(() => {
    if (!requiresLeaderActionOwner) return staff;
    const permittedIds = new Set(leaderActionOwners.map((option) => option.staffId));
    return staff.filter((staffMember) => permittedIds.has(staffMember.id));
  }, [leaderActionOwners, requiresLeaderActionOwner, staff]);

  const editSections = selectedDetail?.sections ?? [];
  const editEntrySections = getEnvironmentEntrySections(mode, editSections, environmentPillars);
  // Saved submissions retain their original questions, including since-retired pillars.
  const detailSections = orderEnvironmentSections(mode, editSections);
  const editFacultyId = getResponseValue(editSections, editResponses, "faculty_area");
  const editTeamId = getResponseValue(editSections, editResponses, "team_level");
  const editTeam = useMemo(() => orgUnits.find((orgUnit) => orgUnit.id === editTeamId), [orgUnits, editTeamId]);
  const editFaculty = useMemo(
    () => orgUnits.find((orgUnit) => orgUnit.id === editFacultyId),
    [orgUnits, editFacultyId]
  );
  const selectedEditLearningWalkFocuses = parseLearningWalkThemeSelections(
    getResponseValue(editSections, editResponses, "additional_focus_context")
  );

  const recordAreaOptions = sortListRows([...new Map(records.map(record => [record.orgUnitId || "unassigned", { id: record.orgUnitId || "unassigned", label: getRecordAreaLabel(record, orgUnits) }])).values()], area => area.label);
  const recordStatusOptions = distinctListValues(records.map(record => record.submissionStatus));
  const recordTypeOptions = sortListRows([...new Map(records.filter(record => record.templateKey).map(record => [record.templateKey!, record.templateName || record.templateKey!])).entries()], entry => entry[1]);
  const recordThemeOptions = distinctListValues(records.flatMap(record => record.themeNames || []));
  const recordPersonOptions = distinctListValues(records.flatMap(record => [record.subjectDisplayName, record.ownerDisplayName, record.submitterDisplayName]));
  const recordParticipantOptions = distinctListValues(records.flatMap(record => record.participantNames || []));
  const recordRoomOptions = sortListRows([...new Map(records.map(record => [record.roomCode || record.roomName || "unassigned", [record.roomCode, record.roomName].filter(Boolean).join(" - ") || "Not recorded"])).entries()], entry => entry[1]);
  const recordDeliveryOptions = distinctListValues(records.map(record => record.deliveryAreaName));
  const displayedRecords = selectWorkspaceRecords(records, orgUnits, { search: recordSearch, status: recordStatusFilter, area: recordAreaFilter,
    type: recordTypeFilter, theme: recordThemeFilter, person: recordPersonFilter, participant: recordParticipantFilter,
    deliveryArea: recordDeliveryFilter, room: recordRoomFilter, from: recordFrom, to: recordTo, sort: recordSort, mine: recordOwnershipView === "mine" });
  const recordPage = useWorkflowPagination(displayedRecords, JSON.stringify([academicYear, mode, recordOwnershipView, recordSearch, recordStatusFilter, recordAreaFilter, recordTypeFilter, recordThemeFilter, recordPersonFilter, recordParticipantFilter, recordDeliveryFilter, recordRoomFilter, recordFrom, recordTo, recordSort]));

  useEffect(() => {
    let cancelled = false;
    setSelectedDetail(null);
    setRecords([]);
    if (mode !== "cpd") {
      setIsCreating(false);
    }
    setIsEditing(false);
    setDefinition(null);
    setDefinitionError("");
    setIsActiveRecordsOpen(true);
    setRecordOwnershipView("mine");
    setRecordSearch("");
    setRecordStatusFilter("all");
    setRecordAreaFilter("all");
    setRecordSort("newest");
    setRecordTypeFilter("all"); setRecordThemeFilter("all"); setRecordPersonFilter("all"); setRecordParticipantFilter("all");
    setRecordDeliveryFilter("all"); setRecordRoomFilter("all"); setRecordFrom(""); setRecordTo("");
    setStatusMessage(""); setValidationErrors([]);
    void refreshData();
    if (mode === "scrutiny" || (mode === "cpd" && cpdCreateOptionCount === 0)) {
      return () => { cancelled = true; refreshRequest.current += 1; detailRequest.current += 1; };
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
          `The ${config.recordLabel} form could not be loaded. Try again, or ask an administrator to check the published form.`
        );
      });
    return () => {
      cancelled = true;
      refreshRequest.current += 1; detailRequest.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicYear, config.templateKey, cpdCreateOptionCount, mode]);

  useEffect(() => {
    setIsCreating(false);
  }, [academicYear, mode]);

  useEffect(() => {
    if (!requiresLeaderActionOwner) return;
    setActionOwnerId((current) => leaderActionOwners.some((option) => option.staffId === current) ? current : "");
  }, [leaderActionOwners, requiresLeaderActionOwner]);

  useEffect(() => {
    if (initialRecordId && openedInitialRecord.current !== initialRecordId) {
      openedInitialRecord.current = initialRecordId;
      void openRecord(initialRecordId);
    }
    // openRecord is intentionally invoked only when a route supplies a new target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRecordId]);

  async function refreshData() {
    const request = ++refreshRequest.current;
    setIsLoadingRecords(true);
    try {
      const [nextRecords, nextOrgUnits, nextActions, nextRooms, nextLookups, nextEnvironmentPillars] = await Promise.all([
        api.records(academicYear),
        api.orgUnits(),
        api.actions(false, academicYear),
        mode === "elevate" ? api.rooms() : Promise.resolve([] as RoomSummary[]),
        mode === "cpd" ? api.lookups() : Promise.resolve([]),
        mode === "elevate" ? api.elevateEnvironmentPillars() : Promise.resolve([] as ElevateEnvironmentPillarSummary[])
      ]);
      if (request !== refreshRequest.current) return;
      setRecords(nextRecords.filter((record) => record.recordType === config.recordType));
      setOrgUnits(nextOrgUnits);
      setActions(nextActions);
      setRooms(nextRooms);
      setCpdThemes(nextLookups.find((lookup) => lookup.lookupKey === "cpd_theme")?.values ?? []);
      setEnvironmentPillars(nextEnvironmentPillars);

      if (mode === "scrutiny") {
        const nextDeliveryAreas = await api.learningWalkDeliveryAreas();
        if (request !== refreshRequest.current) return;
        setDeliveryAreas(nextDeliveryAreas);
        setDeliveryAreasLoaded(true);
      }

      if (isLearningWalkMode) {
        const [nextThemeGroups, coachingConfiguration, nextDeliveryAreas] = await Promise.all([
          api.learningWalkThemes(learningWalkProcess),
          api.coachingConfiguration(),
          api.learningWalkDeliveryAreas(learningWalkProcess)
        ]);
        if (request !== refreshRequest.current) return;
        setDeliveryAreas(nextDeliveryAreas);
        setDeliveryAreasLoaded(true);
        setLearningWalkThemeGroups(nextThemeGroups);
        setPracticeRubric(
          coachingConfiguration.currentPracticeRubric
            .filter((option) => option.displayOrder >= 1 && option.displayOrder <= 5)
            .slice(0, 5)
        );
      }
      setRecordsLoadFailed(false);
    } catch {
      if (request !== refreshRequest.current) return;
      setRecordsLoadFailed(true);
      setStatusMessage("The records could not be loaded. Your saved data is still available; try loading again.");
    } finally { if (request === refreshRequest.current) setIsLoadingRecords(false); }
  }

  function buildRecordContext(
    sections: Array<{ fields: FormFieldDefinition[] }>,
    values: Record<string, string>,
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
      recordTitle = `${isLearningWalkMode ? config.recordLabel : "Work Scrutiny"} - ${areaCode}`;
    }

    const selectedFocusNames = isLearningWalkMode
      ? parseLearningWalkThemeSelections(getResponseValue(sections, values, "additional_focus_context"))
        .map((focus) => focus.name).join(", ")
      : undefined;
    const summary = mode === "elevate"
      ? getResponseValue(sections, values, "building_name")
      : (selectedFocusNames || undefined) ??
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
    externalCpdRecord = isExternalCpd,
    editing = false
  ): WorkflowFieldError[] {
    const errors: WorkflowFieldError[] = [];
    const fields = sections.flatMap(section => section.fields)
      .filter(field => !isLegacyCpdParticipantField(mode, field))
      .filter(field => shouldShowLearningWalkField(mode, field, sections, values, learningWalkThemeGroups));
    const controlId = (field: FormFieldDefinition) => mode === "scrutiny" ? `scrutiny-field-${field.id}` : `workflow-${editing ? "edit" : "create"}-${field.id}`;
    const add = (key: string, message: string) => {
      const field = fields.find(candidate => candidate.fieldKey === key);
      if (field && !errors.some(error => error.id === controlId(field))) errors.push({ id: controlId(field), message });
    };
    if (mode === "elevate") {
      const roomCode = getResponseValue(sections, values, "room_code");
      if (!rooms.some(room => room.roomCode.toLocaleLowerCase() === roomCode?.toLocaleLowerCase()))
        add("room_code", "Select a room from the room register.");
    }
    if (mode === "cpd") {
      const hoursValue = getResponseValue(sections, values, "duration_hours");
      const minutesValue = getResponseValue(sections, values, "duration_minutes");
      const hours = Number(hoursValue), minutes = Number(minutesValue);
      if (!hoursValue || !Number.isInteger(hours) || hours < 0 || hours > 24)
        add("duration_hours", "Enter CPD hours from 0 to 24.");
      if (!minutesValue || !Number.isInteger(minutes) || minutes < 0 || minutes > 59)
        add("duration_minutes", "Enter CPD minutes from 0 to 59.");
      if (hoursValue && minutesValue && hours === 0 && minutes === 0)
        add("duration_minutes", "CPD duration must be at least one minute.");
      if (!externalCpdRecord && !getResponseValue(sections, values, "staff_search"))
        add("staff_search", "Select at least one participant.");
    }
    if (isLearningWalkMode && !getResponseValue(sections, values, "learning_walk_delivery_area"))
      add("learning_walk_delivery_area", "Select the delivery area for this Learning Walk.");
    for (const field of fields.filter(field => field.isRequired && !hasFormAnswer(field, values[field.id]))) {
      if (!errors.some(error => error.id === controlId(field))) errors.push({ id: controlId(field), message: requiredWorkflowMessage(field.label) });
    }
    return errors;
  }

  async function saveRecord(asDraft: boolean): Promise<boolean> {
    if (!definition) {
      return false;
    }

    if (!asDraft) {
      const errors = validateForSubmit(createEntrySections, responses);
      setValidationErrors(errors);
      if (errors.length) {
        setStatusMessage("");
        return false;
      }

      if (isLearningWalkMode) {
        if (!getResponseValue(createSections, responses, "learning_walk_delivery_area")) {
          setStatusMessage("Select a Learning Walk delivery area before submitting.");
          return false;
        }
        const otherValidation = validateLearningWalkOtherContext(
          createSections,
          responses,
          learningWalkThemeGroups
        );
        if (otherValidation) {
          setStatusMessage(otherValidation);
          return false;
        }

        const focusRatingValidation = validateLearningWalkFocusRatings(createSections, responses);
        if (focusRatingValidation) {
          setStatusMessage(focusRatingValidation);
          return false;
        }
      }

      if ((isLearningWalkMode || mode === "elevate")
          && draftActions.some((action) => !action.actionTheme.trim() || !action.title.trim() || !action.ownerStaffId || !action.dueDate)) {
        setStatusMessage(
          mode === "elevate"
            ? "Every added action needs an action theme, action, owner and review date."
            : "Every added action needs an action theme, action, owner and implementation date."
        );
        return false;
      }
    }

    const context = buildRecordContext(createSections, responses, selectedTeam, selectedFaculty);
    setIsSaving(true);
    try {
      const result = await api.submitForm({
        templateKey: definition.templateKey,
        templateVersionId: definition.versionId,
        recordType: config.recordType,
        title: context.recordTitle,
        summary: context.summary,
        subjectStaffId: context.subjectStaffId,
        orgUnitId: context.orgUnitId,
        recordDate: context.dateValue,
        responses: flattenResponses(createEntrySections, responses, false),
        saveAsDraft: asDraft,
        draftActions: asDraft ? draftActions.map(action => ({ actionTheme: action.actionTheme, title: action.title, ownerStaffId: action.ownerStaffId || undefined, dueDate: action.dueDate || undefined })) : undefined,
        actions: (isLearningWalkMode || mode === "elevate") && !asDraft
          ? draftActions.map((action) => ({
              actionTheme: action.actionTheme.trim(),
              title: action.title.trim(),
              ownerStaffId: action.ownerStaffId,
              dueDate: action.dueDate
            }))
          : undefined
      });


      if (result.ok) {
        clearNavigation();
        setResponses({});
        setDraftActions([]);
        setIsCreating(false);
        setStatusMessage(asDraft ? `${config.recordLabel} saved as draft.` : `${config.recordLabel} submitted.`);
        await refreshData();
      } else {
        setStatusMessage(result.message ?? `The ${config.recordLabel} could not be saved.`);
      }
      return result.ok;
    } finally { setIsSaving(false); }
  }

  async function openRecord(recordId: string, afterSave = false) {
    if (!afterSave && !await confirmUnsavedNavigation()) return;
    if (!afterSave && typeof document !== "undefined") detailOrigin.current = document.activeElement as HTMLElement;
    const request = ++detailRequest.current;
    setOpeningRecordId(recordId);
    try {
      const detail = await api.recordDetail(recordId);
      if (request !== detailRequest.current) return;
      setSelectedDetail(detail);
      onRecordOpened?.(detail.id);
      setIsEditing(false);
      setEditResponses({});
      setStatusMessage("");
      if (!afterSave) window.requestAnimationFrame(() => focusWorkflowControl("workflow-record-detail"));
    } catch {
      if (request !== detailRequest.current) return;
      setStatusMessage("The record could not be opened. You may not have access to it.");
    } finally { if (request === detailRequest.current) setOpeningRecordId(""); }
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

    const nextResponses = Object.fromEntries(selectedDetail.sections.flatMap((section) => section.fields.map((field) => [field.id, field.value ?? ""])));
    const nextActions = selectedDetail.draftActions ?? [];
    setEditResponses(nextResponses); setEditDraftActions(nextActions);
    editBaseline.current = JSON.stringify([nextResponses, nextActions]);
    setIsCreating(false);
    setIsEditing(true);
    setStatusMessage(""); setValidationErrors([]);
  }

  function validateEditCompletion(): boolean {
    if (!selectedDetail) return false;
      const errors = validateForSubmit(
        editEntrySections, editResponses, selectedDetail.templateKey === externalCpdConfig.templateKey, true
      );
      setValidationErrors(errors);
      if (errors.length) {
        setStatusMessage("");
        return false;
      }

      if (isLearningWalkMode) {
        const otherValidation = validateLearningWalkOtherContext(
          editSections,
          editResponses,
          learningWalkThemeGroups
        );
        if (otherValidation) {
          setStatusMessage(otherValidation);
          return false;
        }

        const focusRatingValidation = validateLearningWalkFocusRatings(editSections, editResponses);
        if (focusRatingValidation) {
          setStatusMessage(focusRatingValidation);
          return false;
        }
      }
    return true;
  }

  async function submitEditedForm(): Promise<boolean> {
    if (!selectedDetail?.canEdit || !["draft", "reopened"].includes(selectedDetail.submissionStatus) || !validateEditCompletion()) return false;
    if (!await saveEdit(true)) return false;
    return changeStatus("submit");
  }

  async function saveEdit(keepEditing = false): Promise<boolean> {
    if (!selectedDetail) return false;
    if (selectedDetail.submissionStatus === "submitted" && !validateEditCompletion()) return false;

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
          editTeam,
          editFaculty,
          selectedDetail.templateKey === externalCpdConfig.templateKey
        );
    setIsSaving(true);
    try {
      const result = await api.updateFormSubmission(selectedDetail.submissionId, {
        title: context.recordTitle,
        summary: context.summary,
        subjectStaffId: context.subjectStaffId,
        orgUnitId: context.orgUnitId,
        recordDate: context.dateValue,
        responses: flattenResponses(editSections, editResponses, true),
        draftActions: selectedDetail.submissionStatus !== "submitted" ? editDraftActions : undefined
      });


      if (result.ok) {
        if (!keepEditing) {
          editBaseline.current = JSON.stringify([editResponses, editDraftActions]);
          clearNavigation();
          setStatusMessage(`${config.recordLabel} updated.`);
          setIsEditing(false);
          await refreshData();
          await openRecord(selectedDetail.id, true);
        }
      } else {
        setStatusMessage(result.message ?? "The record could not be saved.");
      }
      return result.ok;
    } finally { setIsSaving(false); }
  }

  async function changeStatus(action: "submit" | "reopen" | "archive"): Promise<boolean> {
    if (!selectedDetail) {
      return false;
    }

    if (action === "archive" && !window.confirm("Archive this record? It will be hidden from lists and reporting.")) {
      return false;
    }

    setIsSaving(true);
    try {
      const result = await api.changeSubmissionStatus(selectedDetail.submissionId, action);


      if (result.ok) {
        setStatusMessage(
          action === "submit" ? `${config.recordLabel} submitted.` :
          action === "reopen" ? `${config.recordLabel} reopened for editing.` :
          `${config.recordLabel} archived.`
        );
        await refreshData();
        if (action === "archive") {
          setSelectedDetail(null);
          onRecordClosed?.();
        } else {
          await openRecord(selectedDetail.id, true);
        }
      } else {
        setStatusMessage(result.message ?? "The status could not be changed.");
      }
      return result.ok;
    } finally { setIsSaving(false); }
  }

  async function createLinkedAction(): Promise<boolean> {
    const requiresDueDate = isLearningWalkMode || mode === "elevate";
    if (!selectedDetail || !actionTheme.trim() || !actionTitle.trim() || !actionOwnerId || (requiresDueDate && !actionDueDate)) {
      setStatusMessage(
        isLearningWalkMode
          ? `An ${config.recordLabel} action needs an action theme, action, owner and implementation date.`
          : mode === "elevate"
            ? "A Learning Environment action needs an action theme, action, owner and date for review."
            : "A linked action needs an action theme, action and owner."
      );
      return false;
    }

    setIsSaving(true);
    try {
      const result = await api.createAction({
        sourceRecordId: selectedDetail.id,
        ownerStaffId: actionOwnerId,
        actionTheme: actionTheme.trim(),
        title: actionTitle.trim(),
        dueDate: actionDueDate || undefined,
        publishedToStaff: true
      });


      if (result.ok) {
        setStatusMessage("Linked action created.");
        clearActionNavigation();
        setIsCreatingAction(false);
        setActionTheme("");
        setActionTitle("");
        setActionDueDate("");
        setActions(await api.actions(false, academicYear).catch(() => actions));
        await onActionsChanged?.();
      } else {
        setStatusMessage(result.message ?? "The linked action could not be created.");
      }
      return result.ok;
    } finally { setIsSaving(false); }
  }

  async function completeLinkedAction(actionId: string) {
    const result = await api.updateAction(actionId, { status: "complete" });
    if (result.ok) {
      setStatusMessage("Linked action completed.");
      setActions(await api.actions(false, academicYear).catch(() => actions));
      await onActionsChanged?.();
    } else {
      setStatusMessage(result.message ?? "The action could not be completed.");
    }
  }

  async function toggleCreateForm() {
    const shouldOpen = !isCreating;
    if ((isCreating || isEditing) && !await confirmUnsavedNavigation()) return;
      if (shouldOpen && mode === "elevate") {
        const dateField = findField(createSections, "assessment_date");
        setResponses(dateField ? { [dateField.id]: getTodayDate() } : {});
      }
      if (shouldOpen && (isLearningWalkMode || mode === "elevate")) {
        setDraftActions([]);
      }
    setIsCreating(shouldOpen);
    setIsEditing(false);
    setStatusMessage("");
    setValidationErrors([]);
  }

  async function cancelCreateForm() {
    if (!await confirmUnsavedNavigation()) return;
    setIsCreating(false); setResponses({}); setDraftActions([]); setValidationErrors([]); clearNavigation();
    window.requestAnimationFrame(() => focusWorkflowControl(mode === "cpd" ? `cpd-create-${cpdWorkspaceView}` : "workflow-create-trigger"));
  }

  async function closeRecord() {
    if (!await confirmUnsavedNavigation()) return;
    detailRequest.current += 1; setSelectedDetail(null); setIsEditing(false); setEditResponses({}); setValidationErrors([]); clearNavigation(); onRecordClosed?.();
    window.requestAnimationFrame(() => { if (detailOrigin.current?.isConnected) detailOrigin.current.focus(); else focusWorkflowControl("workflow-records-heading"); });
  }

  function addDraftAction() {
    setDraftActions((current) => [
      ...current,
      { id: crypto.randomUUID(), actionTheme: "", title: "", ownerStaffId: "", dueDate: "" }
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
    setRecordTypeFilter("all"); setRecordThemeFilter("all"); setRecordPersonFilter("all"); setRecordParticipantFilter("all");
    setRecordDeliveryFilter("all"); setRecordRoomFilter("all"); setRecordFrom(""); setRecordTo("");
  }

  async function startCpdForm(nextView: CpdWorkspaceView) {
    if ((nextView === "managed" && !canLogCpdEvent) || (nextView === "external" && !canLogExternalCpd) || (nextView === "mandatory" && !canLogMandatoryCpd)) {
      return;
    }
    const isChangingForm = cpdWorkspaceView !== nextView;
    if (isChangingForm && !await confirmUnsavedNavigation()) return;
    setCpdWorkspaceView(nextView);
    setIsCreating(true);
    setIsEditing(false);
    setSelectedDetail(null);
    onRecordClosed?.();
    if (isChangingForm) {
      setResponses({});
    }
    setStatusMessage("");
  }

  const linkedActions = selectedDetail
    ? actions.filter((action) => action.sourceRecordId === selectedDetail.id)
    : [];

  const detailStatus = selectedDetail?.submissionStatus ?? "";

  // Learning Walks are for programme leaders and above; tutors have no
  // learning_walk.submit permission and the API returns them no records.
  const canUseLearningWalks =
    !isLearningWalkMode ||
    user.permissions.includes(mode === "als_learning" ? "als_learning_walk.submit" : "learning_walk.submit") ||
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
              ? "Elevate Learning Environment checks are completed by leaders, managers and the Teaching and Learning team."
              : "Learning Walks are recorded by programme leaders and above. Actions arising from a walk appear on your Actions tab, and your own development record is on the Staff Profile tab."}
          </p>
        </section>
      </div>
    );
  }

  return (
    <fieldset disabled={isSaving} style={{ display: "contents" }}><div className="route-stack">
      <div className="route-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        {!isLearningWalkMode ? (
          <div className="toolbar">
            {mode === "cpd" && onOpenCsvImport && canUseAdminCsvImport(user, "cpd-events") ? <Button icon={Upload} onClick={async () => { if (await confirmUnsavedNavigation()) await onOpenCsvImport(); }}>Import CPD CSV</Button> : null}
            {mode !== "cpd" ? (
              <Button id="workflow-create-trigger" aria-expanded={isCreating} icon={primaryIcon} onClick={toggleCreateForm} variant="primary">
                {config.createLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {mode === "cpd" && cpdCreateOptionCount > 0 ? (
        <div className={`cpd-create-actions${cpdCreateOptionCount === 1 ? " is-single" : ""}`}>
          {canLogCpdEvent ? (
            <Button id="cpd-create-managed" aria-expanded={isCreating && cpdWorkspaceView === "managed"} icon={CalendarPlus} onClick={() => startCpdForm("managed")} variant="primary">
              Log a CPD Event
            </Button>
          ) : null}
          {canLogMandatoryCpd ? (
            <Button id="cpd-create-mandatory" aria-expanded={isCreating && cpdWorkspaceView === "mandatory"} icon={CalendarPlus} onClick={() => startCpdForm("mandatory")} variant="secondary">
              Log Mandatory CPD
            </Button>
          ) : null}
          {canLogExternalCpd ? (
            <Button id="cpd-create-external" aria-expanded={isCreating && cpdWorkspaceView === "external"} icon={FilePlus2} onClick={() => startCpdForm("external")} variant="primary">
              Log External CPD
            </Button>
          ) : null}
        </div>
      ) : null}

      {isLearningWalkMode ? (
        <div className="learning-create-action">
          <Button id="workflow-create-trigger" aria-expanded={isCreating} icon={primaryIcon} onClick={toggleCreateForm} variant="primary">
            {config.createLabel}
          </Button>
        </div>
      ) : null}

      <WorkflowFeedback message={statusMessage} />
      <WorkflowErrorSummary errors={validationErrors} />
      {recordsLoadFailed ? <Button disabled={isLoadingRecords} onClick={() => void refreshData()}>Retry loading records</Button> : null}
      {requiresLeaderActionOwner && (isCreating || isEditing || isCreatingAction) ? ownersLoading ? <LoadingState label="Loading action owners…" size="inline" /> : ownersError ? <div role="alert">{ownersError}<Button onClick={() => void retryOwners()}>Retry action owners</Button></div> : !leaderActionOwners.length ? <p role="status">No eligible action owners were found in your assigned scope.</p> : null : null}
      <WorkflowFeedback message={definitionError} tone="error" />
      {isLoadingRecords ? <LoadingState label={`Loading ${title} records…`} /> : null}
      {openingRecordId ? <LoadingState label={`Opening ${config.recordLabel}…`} size="inline" /> : null}

      {isCreating && mode === "scrutiny" ? (
        <WorkScrutinyCreateForm
          onCancel={() => { setIsCreating(false); window.requestAnimationFrame(() => focusWorkflowControl("workflow-create-trigger")); }}
            onSubmitted={async (recordId, isDraft) => {
            setIsCreating(false);
              setStatusMessage(isDraft ? "Work Scrutiny draft saved. It is excluded from reporting until submitted." : "Work Scrutiny submitted with its sampled courses and linked actions.");
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
        <section className="panel" id="workflow-create-form">
          <div className="panel-heading">
            <h2>{mode === "als_learning" ? "ALS Learning Walk form" : definition?.name ?? `${config.recordLabel} form`}</h2>
            <span>{definition?.version ? `Version ${definition.version}` : "Published form"}</span>
          </div>
          {definition ? (
            <div className="entry-form">
              {cpdWorkspaceView === "mandatory" && mode === "cpd" ? <p className="record-context-note">Mandatory CPD is recorded on each participant’s staff profile and does not count towards Elevate status.</p> : null}
              {isExternalCpd ? (
                <div className="record-context-note">
                  <strong>Staff member</strong>
                  <span>{user.displayName}</span>
                </div>
              ) : null}
              {mode === "elevate" ? (
                <div className="elevate-rubric-guide">
                  <strong>Fit for purpose is the core test</strong>
                  <span>Select the complete descriptor that best reflects each pillar.</span>
                  <span>A Priority improvement judgement should be supported by an action.</span>
                  <div className="elevate-score-legend" aria-label="Elevate score guide">
                    <span><b>1</b> Priority improvement</span>
                    <span><b>2</b> Developing</span>
                    <span><b>3</b> Secure</span>
                    <span><b>4</b> Strong</span>
                    <span><b>5</b> Leading practice</span>
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
                        controlId={`workflow-create-${field.id}`}
                        error={validationErrors.find(error => error.id === `workflow-create-${field.id}`)?.message}
                        cpdThemes={cpdThemes}
                        deliveryAreas={deliveryAreas}
                        deliveryAreasLoaded={deliveryAreasLoaded}
                        environmentPillars={environmentPillars}
                        field={field.fieldKey === "additional_focus_other" ? { ...field, isRequired: true } : field}
                        key={field.id}
                        learningWalkThemeGroups={learningWalkThemeGroups}
                        onChange={(value) => setResponses((current) => updateResponseMap(
                          createSections,
                          current,
                          field,
                          typeof value === "function" ? value(current[field.id] ?? "") : value,
                          rooms
                        ))}
                        orgUnits={orgUnits}
                        practiceRubric={practiceRubric}
                        rooms={rooms}
                        selectedFacultyId={selectedFacultyId}
                        selectedLearningWalkFocuses={selectedLearningWalkFocuses}
                        staff={staff}
                        value={responses[field.id] ?? ""}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {isLearningWalkMode || mode === "elevate" ? (
                <div className="entry-section">
                  <div className="section-heading-row">
                    <div>
                      <h3>Actions</h3>
                      <small>
                        {mode === "elevate"
                          ? "Create follow-up actions for this learning environment check."
                          : "Actions are assigned to their owners when you submit the walk."}
                      </small>
                    </div>
                    <Button icon={Plus} onClick={addDraftAction}>Add action</Button>
                  </div>
                  {draftActions.length === 0 ? (
                    <div className="empty-row">No actions added.</div>
                  ) : (
                    <div className="scrutiny-action-list">
                      {draftActions.map((action, index) => (
                        <div className="scrutiny-action-row" key={action.id}>
                          <label className="entry-field scrutiny-action-theme">
                            <span>Action theme <strong>Required</strong></span>
                            <ActionThemeSelect
                              id={`submission-action-theme-${action.id}`}
                              onChange={(actionTheme) => updateDraftAction(action.id, { actionTheme })}
                              sourceFormType={config.recordType}
                              value={action.actionTheme}
                            />
                          </label>
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
                              staff={actionOwnerStaff}
                              value={action.ownerStaffId}
                            />
                            {requiresLeaderActionOwner ? <small>{mode === "als_learning" ? "ALS Team Leaders and above only." : "Programme Leaders and above only."}</small> : null}
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
                <Button icon={X} onClick={() => void cancelCreateForm()}>Cancel</Button>
                  {(
                  <Button disabled={isSaving} icon={Save} onClick={() => void saveRecord(true)}>Save draft</Button>
                  )}
                <Button disabled={isSaving} icon={mode === "elevate" ? CheckCircle2 : Send} onClick={() => void saveRecord(false)} variant="primary">
                  {config.submitLabel}
                </Button>
              </div>
            </div>
          ) : (
            definitionError ? <p className="muted-copy">The form is unavailable. Review the message above before trying again.</p> : <LoadingState label="Loading form fields…" />
          )}
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <h2 id="workflow-records-heading" tabIndex={-1}>
            <button
              aria-controls={`${mode}-active-records`}
              aria-expanded={isActiveRecordsOpen}
              className={`panel-collapse-button${isActiveRecordsOpen ? " is-open" : ""}`}
              onClick={() => setIsActiveRecordsOpen((current) => !current)}
              type="button"
            >
              <ChevronDown aria-hidden="true" size={18} />
              {recordOwnershipView === "mine" ? `My ${listRecordLabel}s` : `${listRecordLabel}s in scope`}
            </button>
          </h2>
          <div className="toolbar">
            <span>
              {displayedRecords.length}{" "}
              {listRecordLabel}{displayedRecords.length === 1 ? "" : "s"}
            </span>
            {canExport ? <ExportExcelButton filters={{ academicYear }} moduleKey={exportModuleKey} orgUnits={orgUnits} /> : null}
          </div>
        </div>

        {isActiveRecordsOpen ? (
          <div id={`${mode}-active-records`}>
            <div className="segmented-control record-ownership-switch" aria-label="Record ownership view">
              <button aria-pressed={recordOwnershipView === "mine"} className={recordOwnershipView === "mine" ? "is-active" : ""} onClick={() => setRecordOwnershipView("mine")} type="button">My {listRecordLabel}s</button>
              <button aria-pressed={recordOwnershipView === "scope"} className={recordOwnershipView === "scope" ? "is-active" : ""} onClick={() => setRecordOwnershipView("scope")} type="button">All in my scope</button>
            </div>
            {(
              <WorkflowFilters activeCount={[recordStatusFilter, recordAreaFilter, recordTypeFilter, recordPersonFilter, recordThemeFilter, recordParticipantFilter, recordDeliveryFilter, recordRoomFilter].filter(value => value !== "all").length + Number(Boolean(recordFrom)) + Number(Boolean(recordTo))} hasQuery={Boolean(recordSearch)} onClear={clearRecordFilters} primary={<>
<label className="record-filter-field record-filter-search">
                  <span>Search records</span>
                  <input
                    onChange={(event) => setRecordSearch(event.target.value)}
                    aria-label="Search workflow records" placeholder="Title, people, theme, room, area or date"
                    type="search"
                    value={recordSearch}
                  />
                </label>
<label className="record-filter-field">
                  <span>Sort by</span>
                  <select aria-label="Sort workflow records" onChange={(event) => setRecordSort(event.target.value as typeof recordSort)} value={recordSort}>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="area">Area A-Z</option>
                    <option value="status">Status A-Z</option>
                    <option value="title">Title A-Z</option><option value="person">Staff / owner name</option><option value="type">Form type</option>{mode === "elevate" ? <option value="room">Room</option> : null}
                  </select>
                </label>
</>}>
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
                {recordTypeOptions.length > 1 ? <label className="record-filter-field"><span>{mode === "cpd" ? "CPD type" : "Form type"}</span><select value={recordTypeFilter} onChange={event => setRecordTypeFilter(event.target.value)}><option value="all">All types</option>{recordTypeOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label> : null}
                {recordPersonOptions.length ? <label className="record-filter-field"><span>Staff / owner / submitter</span><select value={recordPersonFilter} onChange={event => setRecordPersonFilter(event.target.value)}><option value="all">All people</option>{recordPersonOptions.map(name => <option key={name}>{name}</option>)}</select></label> : null}
                {recordThemeOptions.length ? <label className="record-filter-field"><span>Theme</span><select value={recordThemeFilter} onChange={event => setRecordThemeFilter(event.target.value)}><option value="all">All themes</option>{recordThemeOptions.map(name => <option key={name}>{name}</option>)}</select></label> : null}
                {mode === "cpd" && recordParticipantOptions.length ? <label className="record-filter-field"><span>Participant</span><select value={recordParticipantFilter} onChange={event => setRecordParticipantFilter(event.target.value)}><option value="all">All participants</option>{recordParticipantOptions.map(name => <option key={name}>{name}</option>)}</select></label> : null}
                {recordDeliveryOptions.length ? <label className="record-filter-field"><span>Delivery area</span><select value={recordDeliveryFilter} onChange={event => setRecordDeliveryFilter(event.target.value)}><option value="all">All delivery areas</option>{recordDeliveryOptions.map(name => <option key={name}>{name}</option>)}</select></label> : null}
                {mode === "elevate" && recordRoomOptions.length ? <label className="record-filter-field"><span>Room</span><select value={recordRoomFilter} onChange={event => setRecordRoomFilter(event.target.value)}><option value="all">All rooms</option>{recordRoomOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label> : null}
                <label className="record-filter-field"><span>From date</span><input type="date" value={recordFrom} onChange={event => setRecordFrom(event.target.value)} /></label>
                <label className="record-filter-field"><span>To date</span><input type="date" min={recordFrom || undefined} value={recordTo} onChange={event => setRecordTo(event.target.value)} /></label>
</WorkflowFilters>
            )}

            <div className="record-list">
              {isLoadingRecords && records.length === 0 ? null : recordsLoadFailed && records.length === 0 ? <div className="empty-row">Records are temporarily unavailable. Use Retry loading records above.</div> : records.length === 0 ? (
                <div className="empty-row">
                  No {listRecordLabel}s yet. Use "{config.createLabel}" to add the first one.
                </div>
              ) : recordOwnershipView === "mine" && displayedRecords.length === 0 ? (
                <div className="empty-row">You have not created any {listRecordLabel}s in this view.</div>
              ) : displayedRecords.length === 0 ? (
                <div className="empty-row">No {listRecordLabel}s match those filters.</div>
              ) : (
                recordPage.items.map((record) => {
                  const orgUnit = orgUnits.find((unit) => unit.id === record.orgUnitId);
                  const parent = orgUnits.find((unit) => unit.id === orgUnit?.parentOrgUnitId);
                  return (
                    <div className="record-row" key={record.id}>
                      <div>
                        <strong>{record.title}</strong>
                        {record.subjectDisplayName || record.ownerDisplayName ? <small>Staff: {record.subjectDisplayName || record.ownerDisplayName}{record.submitterDisplayName ? ` · Submitted by ${record.submitterDisplayName}` : ""}</small> : null}
                        {mode === "cpd" ? <small>{record.templateName}{record.participantNames?.length ? ` · ${record.participantNames.length} participants` : ""}{record.themeNames?.length ? ` · ${record.themeNames.join(", ")}` : ""}</small> : null}
                        {mode === "elevate" && (record.roomCode || record.roomName) ? <small>Room: {[record.roomCode, record.roomName].filter(Boolean).join(" - ")}</small> : null}
                        {isLearningWalkMode ? <small>Delivery area: {record.deliveryAreaName || "Not recorded"}</small> : null}
                        <span>
                          {mode === "elevate"
                            ? "Room environment assessment"
                            : parent?.code ? `${parent.code} / ${orgUnit?.code ?? "No team"}` : orgUnit?.code ?? "No team"}
                        </span>
                      </div>
                      <span className={`status-pill status-${record.submissionStatus}`}>{formatStatus(record.submissionStatus)}</span>
                      <span>{record.recordDate ?? "No date"}</span>
                      <button aria-busy={openingRecordId === record.id || undefined} aria-label={`Open ${record.title}`} className="icon-button" disabled={openingRecordId === record.id} onClick={() => void openRecord(record.id)} type="button" title={openingRecordId === record.id ? "Opening record…" : "Open record"}>
                        <Eye size={16} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
        {isActiveRecordsOpen ? <WorkflowPagination {...recordPage} label="Records" /> : null}
      </section>

      {selectedDetail ? (
        <section className="panel" id="workflow-record-detail" tabIndex={-1}>
          <div className="panel-heading">
            <h2>{selectedDetail.title}</h2>
            <div className="toolbar"><span>v{selectedDetail.templateVersion}</span><Button icon={X} onClick={() => void closeRecord()} variant="quiet">Close record</Button></div>
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
                      mode === "scrutiny" && ["short_text", "long_text", "number", "date", "yes_no_partial", "single_select", "rubric_scale", "multi_select", "checkbox_group"].includes(field.fieldType) ?
                      <WorkScrutinyResponseField field={field} error={validationErrors.find(error => error.id === `scrutiny-field-${field.id}`)?.message} key={field.id} value={editResponses[field.id] ?? ""}
                        onChange={(value) => setEditResponses((current) => ({ ...current, [field.id]: value }))} /> :
                      <FieldInput
                        controlId={`workflow-edit-${field.id}`}
                        error={validationErrors.find(error => error.id === `workflow-edit-${field.id}`)?.message}
                        cpdThemes={cpdThemes}
                        savedDeliveryAreaKey={field.fieldKey === "learning_walk_delivery_area" ? field.value ?? "" : undefined}
                        savedDeliveryAreaName={field.fieldKey === "learning_walk_delivery_area" ? field.displayValue : undefined}
                        deliveryAreas={deliveryAreas}
                        deliveryAreasLoaded={deliveryAreasLoaded}
                        environmentPillars={environmentPillars}
                        field={field.fieldKey === "additional_focus_other" ? { ...field, isRequired: true } : field}
                        key={field.id}
                        learningWalkThemeGroups={learningWalkThemeGroups}
                        onChange={(value) => setEditResponses((current) => updateResponseMap(
                          editSections,
                          current,
                          field,
                          typeof value === "function" ? value(current[field.id] ?? "") : value,
                          rooms
                        ))}
                        orgUnits={orgUnits}
                        practiceRubric={practiceRubric}
                        rooms={rooms}
                        selectedFacultyId={editFacultyId}
                        selectedLearningWalkFocuses={selectedEditLearningWalkFocuses}
                        staff={staff}
                        value={editResponses[field.id] ?? ""}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {selectedDetail.submissionStatus !== "submitted" && (isLearningWalkMode || mode === "scrutiny" || mode === "elevate") ? <DraftActionsEditor actions={editDraftActions} onChange={setEditDraftActions} staff={actionOwnerStaff} process={config.recordType} disabled={isSaving}/> : null}
              <div className="toolbar">
                <Button icon={X} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) setIsEditing(false); })}>Cancel</Button>
                <Button disabled={isSaving} icon={Save} onClick={() => void saveEdit()} variant="primary">Save changes</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="answer-section-list">
                {detailSections.map((section) => (
                  <div className="answer-section" key={section.id}>
                    <EnvironmentPillarHeader preserveTitle pillar={getEnvironmentPillar(mode, section.sectionKey, environmentPillars)} title={section.title} />
                    <div className="answer-grid">
                      {section.fields
                        .filter((field) => !isLegacyCpdParticipantField(mode, field))
                        .filter((field) => field.fieldKey !== "additional_focus_other" || Boolean(field.value))
                        .map((field) => (
                        <div className={isWideEntryField(field.fieldType) ? "answer-item answer-item-wide" : "answer-item"} key={field.id}>
                          <span>{field.label}</span>
                          <strong>{isCustomChoiceField(field) ? parseChoiceAnswers(field.value).join("\n") || "Not recorded" : field.displayValue ?? formatAnswer(field.value, field.fieldType, field.fieldKey, environmentPillars, orgUnits, staff)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {selectedDetail.draftActions?.length ? <p role="status">{selectedDetail.draftActions.length} draft actions saved. Edit this record to complete them before submitting.</p> : null}
              <div className="toolbar">
                <ExportWordButton recordId={selectedDetail.id} />
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
                {canManageActions && detailStatus !== "draft" ? (
                  <Button icon={Plus} onClick={() => setIsCreatingAction((current) => !current)}>Linked action</Button>
                ) : null}
              </div>
            </>
          )}

          {isCreatingAction ? (
            <div className="entry-form">
              <div className="entry-field-grid">
                <label className="entry-field entry-field-wide">
                  <span>Action theme <strong>Required</strong></span>
                  <ActionThemeSelect
                    id={`linked-action-theme-${selectedDetail.id}`}
                    onChange={setActionTheme}
                    sourceFormType={config.recordType}
                    value={actionTheme}
                  />
                </label>
                <label className="entry-field entry-field-wide">
                  <span>Action <strong>Required</strong></span>
                  <textarea maxLength={300} onChange={(event) => setActionTitle(event.target.value)} rows={3} value={actionTitle} />
                </label>
                <label className="entry-field">
                  <span>Owner <strong>Required</strong></span>
                  <StaffSearchSelect
                    id={`linked-action-owner-${selectedDetail.id}`}
                    onChange={setActionOwnerId}
                    staff={actionOwnerStaff}
                    value={actionOwnerId}
                  />
                  {requiresLeaderActionOwner ? <small>{mode === "als_learning" ? "ALS Team Leaders and above only." : "Programme Leaders and above only."}</small> : null}
                </label>
                <label className="entry-field">
                  <span>
                    {mode === "elevate" ? "Date for review" : "Date to be implemented by"}
                    {isLearningWalkMode || mode === "elevate" ? <strong>Required</strong> : null}
                  </span>
                  <input onChange={(event) => setActionDueDate(event.target.value)} type="date" value={actionDueDate} />
                </label>
              </div>
              <div className="toolbar">
                <Button icon={X} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) setIsCreatingAction(false); })}>Cancel</Button>
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
    </div></fieldset>
  );
}

function FieldInput({
  field,
  controlId: providedControlId,
  error,
  onChange,
  orgUnits,
  rooms,
  selectedFacultyId,
  staff,
  cpdThemes,
  deliveryAreas,
  deliveryAreasLoaded,
  savedDeliveryAreaKey,
  savedDeliveryAreaName,
  environmentPillars,
  learningWalkThemeGroups,
  practiceRubric,
  selectedLearningWalkFocuses,
  value
}: {
  controlId?: string;
  error?: string;
  cpdThemes: string[];
  deliveryAreas: LearningWalkDeliveryArea[];
  deliveryAreasLoaded: boolean;
  savedDeliveryAreaKey?: string;
  savedDeliveryAreaName?: string;
  environmentPillars: ElevateEnvironmentPillarSummary[];
  field: FormFieldDefinition;
  onChange: (value: string | ((currentValue: string) => string)) => void;
  orgUnits: OrgUnitSummary[];
  rooms: RoomSummary[];
  selectedFacultyId?: string;
  staff: StaffSummary[];
  learningWalkThemeGroups: LearningWalkThemeGroup[];
  practiceRubric: CoachingRubricOption[];
  selectedLearningWalkFocuses: LearningWalkThemeSelection[];
  value: string;
}) {
  const generatedId = useId();
  const controlId = providedControlId ?? `workflow-field-${generatedId}`;
  const helpId = `${controlId}-guidance`, errorId = `${controlId}-error`;
  const accessibility = { "aria-invalid": error ? true as const : undefined, "aria-required": field.isRequired || undefined,
    "aria-describedby": workflowDescription(field.helpText ? helpId : undefined, error ? errorId : undefined) };
  const errorMessage = error ? <small className="workflow-field-error" id={errorId}>{error}</small> : null;
  const faculties = orgUnits.filter((orgUnit) => orgUnit.isActive && orgUnit.orgUnitType === "faculty");
  const teams = orgUnits.filter(
    (orgUnit) =>
      orgUnit.isActive && orgUnit.parentOrgUnitId === selectedFacultyId &&
      ["team", "faculty_child_code", "faculty_child"].includes(orgUnit.orgUnitType)
  );
  const selectedFaculty = orgUnits.find((orgUnit) => orgUnit.id === selectedFacultyId);
  const teamOptions = teams.length > 0 ? teams : selectedFaculty?.isActive ? [selectedFaculty] : [];
  const selectedValues = isCustomChoiceField(field) ? parseChoiceAnswers(value) : splitDelimitedValues(value);

  if (["checkbox_group", "multi_select"].includes(field.fieldType)) {
    const options = field.options?.length ? field.options : field.fieldType === "checkbox_group" ? getCheckboxOptions(field.fieldKey, cpdThemes) : [];
    const choices = [...options, ...selectedValues.filter(value => !options.includes(value))];
    return <fieldset id={controlId} tabIndex={-1} {...accessibility} className="entry-field entry-field-wide workflow-choice-field">
      <legend>{field.label}{field.isRequired ? <strong>Required</strong> : null}</legend>
      <div className="preview-check-list">{choices.map(option => <label key={option}><input checked={selectedValues.includes(option)} onChange={() => onChange(toggleDelimitedValue(value, option, field.fieldKey))} type="checkbox" /><span>{option}{options.includes(option) ? "" : " (existing response)"}</span></label>)}</div>
      {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}{errorMessage}
    </fieldset>;
  }

  if (field.fieldType === "learning_walk_delivery_area") {
    const choices = learningWalkDeliveryChoices(deliveryAreas, savedDeliveryAreaKey, savedDeliveryAreaName);
    return <label className="entry-field">
      <span>{field.label}{savedDeliveryAreaKey === undefined ? <strong>Required to submit</strong> : null}</span>
      <select id={controlId} {...accessibility} disabled={!deliveryAreasLoaded} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{deliveryAreasLoaded ? "Select delivery area" : "Loading delivery areas…"}</option>
        {choices.map((area) => <option key={area.key} value={area.key} disabled={!area.isActive && area.key !== savedDeliveryAreaKey}>{area.name}{area.isActive ? "" : " (retired)"}</option>)}
      </select>
      <small id={helpId}>Choose the delivery area for this visit. Existing saved wording is retained.</small>
      {errorMessage}
    </label>;
  }

  if (field.fieldType === "staff_multi_select" && field.fieldKey === "staff_search") {
    return (
      <fieldset id={controlId} tabIndex={-1} {...accessibility} className="entry-field entry-field-wide workflow-choice-field">
        <legend>
          {field.label}
          {field.isRequired ? <strong>Required</strong> : null}
        </legend>
        <CpdParticipantPicker
          id={`${controlId}-search`}
          {...accessibility}
          onChange={onChange}
          orgUnits={orgUnits}
          staff={staff}
          value={value}
        />
        {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
        {errorMessage}
      </fieldset>
    );
  }

  if (field.fieldType === "room_lookup") {
    return (
      <div className="entry-field">
        <label htmlFor={controlId}>
          {field.label}
          {field.isRequired ? <strong>Required</strong> : null}
        </label>
        <RoomSearchSelect id={controlId} {...accessibility} onChange={onChange} rooms={rooms} value={value} />
        {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
        {errorMessage}
      </div>
    );
  }

  if (field.fieldType === "learning_walk_theme_group") {
    const selected = parseLearningWalkThemeSelections(value);
    const selectedIds = selected.map((theme) => theme.id);
    return (
      <fieldset id={controlId} tabIndex={-1} {...accessibility} className="entry-field entry-field-wide learning-walk-theme-picker workflow-choice-field">
        <legend>
          {field.label}
          {field.isRequired ? <strong>Required</strong> : null}
        </legend>
        <div className="learning-walk-theme-picker-groups">
          {learningWalkThemeGroups.map((group) => {
            const visibleThemes = group.themes.filter((theme) =>
              group.isActive
                ? theme.isActive || selectedIds.includes(theme.id)
                : selectedIds.includes(theme.id));
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
                      disabled={(!group.isActive || !theme.isActive) && !selectedIds.includes(theme.id)}
                      onChange={() => onChange(toggleLearningWalkTheme(value, theme, group))}
                      type="checkbox"
                    />
                    <span>{theme.name}{group.isActive && theme.isActive ? "" : " (inactive)"}</span>
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
        {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
        {errorMessage}
      </fieldset>
    );
  }

  if (field.fieldType === "practice_rubric_1_5") {
    return (
      <fieldset id={controlId} tabIndex={-1} {...accessibility} className="coaching-wording-rubric entry-field-wide practice-observed-rubric">
        <legend>
          {field.label}
          {field.isRequired ? <strong>Required</strong> : null}
        </legend>
        {practiceRubric.length > 0 ? (
          <div>
            {practiceRubric.map((option) => {
              const optionValue = formatPracticeRubricValue(option);
              return (
                <button
                  aria-pressed={value === optionValue}
                  className={value === optionValue ? "is-selected" : ""}
                  key={option.id}
                  onClick={() => onChange(optionValue)}
                  type="button"
                >
                  <i aria-hidden="true" style={{ backgroundColor: option.colorHex ?? "#60736b" }} />
                  <span>
                    <strong>{optionValue}</strong>
                    <small>{option.guidanceText}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : <div className="empty-row">The Elevate practice rubric is unavailable.</div>}
        {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
        {errorMessage}
      </fieldset>
    );
  }

  if (field.fieldType === "focus_rubrics_1_5") {
    const ratings = parseLearningWalkFocusRatings(value);
    return (
      <fieldset id={controlId} tabIndex={-1} {...accessibility} className="coaching-wording-rubric entry-field-wide learning-walk-focus-rubrics">
        <legend>
          {field.label}
          {field.isRequired ? <strong>Required</strong> : null}
        </legend>
        {selectedLearningWalkFocuses.length > 0 ? (
          <div className="learning-walk-focus-rubric-list">
            {selectedLearningWalkFocuses.map((focus) => {
              const selectedRating = ratings.find((rating) => rating.focusId === focus.id);
              return (
                <fieldset className="learning-walk-focus-rubric" key={focus.id}>
                  <legend>{focus.name}</legend>
                  <div>
                    {practiceRubric.map((option) => {
                      const optionValue = learningWalkFocusRubricLabel(option.displayOrder);
                      const isSelected = selectedRating?.score === option.displayOrder;
                      return (
                        <button
                          aria-pressed={isSelected}
                          className={isSelected ? "is-selected" : ""}
                          key={option.id}
                          onClick={() => onChange((currentValue) => updateLearningWalkFocusRating(currentValue, focus, option))}
                          type="button"
                        >
                          <i aria-hidden="true" style={{ backgroundColor: option.colorHex ?? "#60736b" }} />
                          <span><strong>{optionValue}</strong></span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </div>
        ) : (
          <div className="empty-row">Select one or more focuses above to show their rubrics.</div>
        )}
        {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
        {errorMessage}
      </fieldset>
    );
  }

  if (field.fieldType === "environment_rubric_1_5") {
    const pillarKey = field.fieldKey.replace(/_score$/, "");
    const rubric = environmentPillars.find((pillar) => pillar.pillarKey === pillarKey)?.rubric ?? [];
    return (
      <fieldset id={controlId} tabIndex={-1} {...accessibility} className="coaching-wording-rubric entry-field-wide practice-observed-rubric environment-pillar-rubric">
        <legend>
          {field.label}
          {field.isRequired ? <strong>Required</strong> : null}
        </legend>
        {rubric.length > 0 ? (
          <div>
            {rubric.map((option) => {
              const optionValue = String(option.score);
              return (
                <button
                  aria-pressed={value === optionValue}
                  className={value === optionValue ? "is-selected" : ""}
                  key={option.id}
                  onClick={() => onChange(optionValue)}
                  type="button"
                >
                  <i aria-hidden="true" style={{ backgroundColor: option.colorHex ?? "#60736b" }} />
                  <span>
                    <strong>{option.score} - {option.judgement}</strong>
                    <small>{option.descriptor}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : <div className="empty-row">The learning environment rubric is unavailable.</div>}
        {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
        {errorMessage}
      </fieldset>
    );
  }

  return (
    <label className={isWideEntryField(field.fieldType) ? "entry-field entry-field-wide" : "entry-field"} htmlFor={controlId}>
      <span>
        {field.label}
        {field.isRequired ? <strong>Required</strong> : null}
      </span>
      {field.fieldType === "date" ? (
        <input id={controlId} {...accessibility} type="date" value={value} onChange={(event) => onChange(event.target.value)} />
      ) : null}
      {field.fieldType === "datetime" ? (
        <input id={controlId} {...accessibility} type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} />
      ) : null}
      {field.fieldType === "short_text" ? (
        <input id={controlId} {...accessibility} type="text" value={value} onChange={(event) => onChange(event.target.value)} />
      ) : null}
      {field.fieldType === "number" ? (
        <input
          id={controlId} {...accessibility}
          inputMode="numeric"
          max={field.fieldKey === "duration_hours" ? 24 : field.fieldKey === "duration_minutes" ? 59 : undefined}
          min={field.fieldKey.startsWith("custom_") ? undefined : "0"}
          onChange={(event) => onChange(event.target.value)}
          step={field.fieldKey.startsWith("custom_") ? "any" : "1"}
          type="number"
          value={value}
        />
      ) : null}
      {field.fieldType === "faculty_lookup" ? (
        <select id={controlId} {...accessibility} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select faculty</option>
          {value && !faculties.some(unit => unit.id === value) ? <option value={value}>{orgUnits.find(unit => unit.id === value)?.name || "Saved faculty"} (existing response)</option> : null}
          {faculties.map((orgUnit) => (
            <option key={orgUnit.id} value={orgUnit.id}>
              {orgUnit.code} - {orgUnit.name}
            </option>
          ))}
        </select>
      ) : null}
      {field.fieldType === "team_lookup" ? (
        <select id={controlId} {...accessibility} disabled={!selectedFacultyId || teamOptions.length === 0} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{selectedFacultyId ? "Select team or faculty-wide area" : "Select faculty first"}</option>
          {value && !teamOptions.some(unit => unit.id === value) ? <option value={value}>{orgUnits.find(unit => unit.id === value)?.name || "Saved team"} (existing response)</option> : null}
          {teamOptions.map((orgUnit) => (
            <option key={orgUnit.id} value={orgUnit.id}>
              {orgUnit.code} - {orgUnit.name}
            </option>
          ))}
        </select>
      ) : null}
      {field.fieldType === "auto_text" ? (
        <input
          id={controlId} {...accessibility}
          readOnly
          type="text"
          value={value || (field.fieldKey === "building_name" ? "Select a room code" : "")}
        />
      ) : null}
      {field.fieldType === "score_0_3" ? (
        <select id={controlId} {...accessibility} value={value} onChange={(event) => onChange(event.target.value)}>
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
          id={controlId}
          {...accessibility}
          onChange={onChange}
          staff={staff}
          value={value}
        />
      ) : null}
      {field.fieldType === "staff_multi_select" ? (
        <select
          id={controlId} {...accessibility}
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
        <select id={controlId} {...accessibility} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select faculty, child code or team</option>
          {orgUnits.filter(orgUnit => orgUnit.isActive).map((orgUnit) => (
            <option key={orgUnit.id} value={orgUnit.id}>
              {orgUnit.code} - {orgUnit.name}
            </option>
          ))}
        </select>
      ) : null}
      {field.fieldType === "selected_staff_list" ? (
        <textarea
          id={controlId} {...accessibility}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Confirm selected staff names or paste a staff list"
          rows={4}
        />
      ) : null}
      {field.fieldType === "single_select" ? (
        <select id={controlId} {...accessibility} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select option</option>
          {value && !(field.options?.length ? field.options : getSingleSelectOptions(field.fieldKey)).includes(value) ? <option value={value}>{value} (existing response)</option> : null}
          {(field.options?.length ? field.options : getSingleSelectOptions(field.fieldKey)).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : null}
      {field.fieldType === "rubric_scale" ? (
        <select id={controlId} {...accessibility} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select rubric level</option>
          {value && !field.options?.includes(value) ? <option value={value}>{value} (existing response)</option> : null}
          {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : null}
      {field.fieldType === "yes_no_partial" ? (
        <select id={controlId} {...accessibility} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select answer</option>
          <option value="Yes">Yes</option>
          <option value="Partially">Partially</option>
          <option value="No">No</option>
        </select>
      ) : null}
      {field.fieldType === "long_text" ? (
        <textarea id={controlId} {...accessibility} value={value} onChange={(event) => onChange(event.target.value)} rows={4} />
      ) : null}
      {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
        {errorMessage}
    </label>
  );
}

function EnvironmentPillarHeader({
  pillar,
  title,
  preserveTitle = true
}: {
  pillar?: ElevateEnvironmentPillarSummary;
  title: string;
  preserveTitle?: boolean;
}) {
  if (!pillar) {
    return <h3>{title}</h3>;
  }

  return (
    <div className="environment-pillar-heading">
      <img alt={pillar.assetAltText} loading="lazy" src={pillar.assetUri} />
      <div>
        <span>Learning environment pillar{pillar.isActive ? "" : " · Inactive"}</span>
        <h3>{preserveTitle ? title : pillar.name}</h3>
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
  return orderEnvironmentSections(mode, sections).map((section) => ({
    ...section,
    fields: section.fields.filter((field) => !isRetiredEnvironmentField(field.fieldKey)
      && (!byKey.has(section.sectionKey) || byKey.get(section.sectionKey)?.isActive || field.fieldKey.startsWith("custom_")))
  })).filter(section => section.fields.length > 0) as T[];
}

function orderEnvironmentSections<T extends EnvironmentSectionLike>(
  mode: WorkspaceMode,
  sections: T[]
) {
  if (mode !== "elevate") {
    return sections;
  }

  return [...sections].sort((left, right) => left.displayOrder - right.displayOrder);
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


function isWideEntryField(fieldType: string) {
  return ["checkbox_group", "multi_select", "long_text", "selected_staff_list", "staff_multi_select", "team_bulk_add", "learning_walk_theme_group", "practice_rubric_1_5", "focus_rubrics_1_5", "environment_rubric_1_5"].includes(
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

type LearningWalkFocusRating = {
  focusId: string;
  focusName: string;
  groupName: string;
  descriptorId: string;
  score: number;
  rating: string;
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

function parseLearningWalkFocusRatings(value?: string): LearningWalkFocusRating[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as LearningWalkFocusRating[];
    return Array.isArray(parsed)
      ? parsed.filter((item) =>
          typeof item?.focusId === "string"
          && typeof item?.focusName === "string"
          && typeof item?.score === "number"
          && typeof item?.rating === "string")
      : [];
  } catch {
    return [];
  }
}

function updateLearningWalkFocusRating(
  currentValue: string,
  focus: LearningWalkThemeSelection,
  option: CoachingRubricOption
) {
  const ratings = parseLearningWalkFocusRatings(currentValue);
  const nextRating: LearningWalkFocusRating = {
    focusId: focus.id,
    focusName: focus.name,
    groupName: focus.groupName,
    descriptorId: option.id,
    score: option.displayOrder,
    rating: learningWalkFocusRubricLabel(option.displayOrder)
  };
  return JSON.stringify([
    ...ratings.filter((rating) => rating.focusId !== focus.id),
    nextRating
  ]);
}

function learningWalkFocusRubricLabel(score: number) {
  return [
    "Emerging Practice",
    "Developing Practice",
    "Secure Practice",
    "Strong Practice",
    "Exceptional Practice"
  ][score - 1] ?? `Level ${score}`;
}

function shouldShowLearningWalkField(
  mode: WorkspaceMode,
  field: FormFieldDefinition,
  sections: Array<{ fields: FormFieldDefinition[] }>,
  responses: Record<string, string>,
  groups: LearningWalkThemeGroup[]
) {
  if ((mode !== "learning" && mode !== "als_learning") || field.fieldKey !== "additional_focus_other") {
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

function validateLearningWalkFocusRatings(
  sections: Array<{ fields: FormFieldDefinition[] }>,
  responses: Record<string, string>
) {
  const ratingField = findField(sections, "focus_rubric_ratings");
  if (!ratingField) {
    return "";
  }

  const focuses = parseLearningWalkThemeSelections(
    getResponseValue(sections, responses, "additional_focus_context")
  );
  if (focuses.length === 0) {
    return "Select at least one focus before submitting the Learning Walk.";
  }

  const ratings = parseLearningWalkFocusRatings(responses[ratingField.id]);
  return focuses.every((focus) => ratings.some((rating) => rating.focusId === focus.id))
    ? ""
    : "Choose a practice level for every selected focus before submitting the Learning Walk.";
}

function toggleDelimitedValue(currentValue: string, option: string, fieldKey: string) {
  const values = fieldKey.startsWith("custom_") ? parseChoiceAnswers(currentValue) : splitDelimitedValues(currentValue);
  return serializeChoiceAnswers(fieldKey, values.includes(option) ? values.filter(value => value !== option) : [...values, option]);
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
  }

  if (field.fieldKey === "team_level") {
  }

  if (field.fieldKey === "additional_focus_context") {
    const ratingField = findField(sections, "focus_rubric_ratings");
    if (ratingField) {
      const selectedIds = new Set(parseLearningWalkThemeSelections(value).map((focus) => focus.id));
      const retainedRatings = parseLearningWalkFocusRatings(current[ratingField.id])
        .filter((rating) => selectedIds.has(rating.focusId));
      next[ratingField.id] = retainedRatings.length > 0 ? JSON.stringify(retainedRatings) : "";
    }
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
    .map((field) => ({ fieldId: field.id, value: normalizeFormAnswer(field, responses[field.id]) }))
    .filter((response) => includeEmpty || response.value);
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
  fieldKey: string,
  environmentPillars: ElevateEnvironmentPillarSummary[],
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

  if (fieldType === "environment_rubric_1_5") {
    const pillarKey = fieldKey.replace(/_score$/, "");
    const selected = environmentPillars
      .find((pillar) => pillar.pillarKey === pillarKey)
      ?.rubric.find((option) => option.score === Number(value));
    return selected ? `${selected.score} - ${selected.judgement}` : value;
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

  if (fieldType === "focus_rubrics_1_5") {
    const ratings = parseLearningWalkFocusRatings(value);
    return ratings.length > 0
      ? ratings.map((rating) => `${rating.focusName}: ${rating.rating}`).join(" • ")
      : "Not recorded";
  }

  if (fieldType === "datetime") {
    return value.replace("T", " ");
  }

  return value;
}

function formatPracticeRubricValue(option: CoachingRubricOption) {
  return `${option.displayOrder} – ${option.visibleWording}`;
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
