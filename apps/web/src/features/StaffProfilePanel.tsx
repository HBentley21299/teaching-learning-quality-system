import { useEffect, useState } from "react";
import { Award, ChevronDown, ExternalLink, Plus, Save } from "lucide-react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import { ElevatePracticeResultPage } from "../routes/ElevatePractice";
import type {
  CurrentUser,
  StaffProfileDetail,
  StaffProfileSummary,
  StaffReflectionSummary,
  SaveStaffReflectionRequest,
  ElevateStatusLevelSummary
} from "../services/types";

type StaffReflectionDraft = SaveStaffReflectionRequest;

/**
 * Full staff profile view assembled from its source records (Elevate Your
 * Practice, staff reflections, CPD, actions and coaching) and backed by
 * GET /staff-profiles/{staffId}. Reflections are editable when the viewer is
 * the staff member themselves or holds staff.manage - the API enforces the
 * same rule on save.
 */
export function StaffProfilePanel({
  academicYear,
  staffId,
  user,
  profiles = [],
  openElevateResult = false,
  elevateRecordId = ""
}: {
  academicYear: string;
  staffId: string;
  user: CurrentUser;
  profiles?: StaffProfileSummary[];
  openElevateResult?: boolean;
  elevateRecordId?: string;
}) {
  const [detail, setDetail] = useState<StaffProfileDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, StaffReflectionDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingReflectionId, setSavingReflectionId] = useState<string | null>(null);
  const [isCreatingReflection, setIsCreatingReflection] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [showElevateResult, setShowElevateResult] = useState(openElevateResult);
  const [activeProfileTab, setActiveProfileTab] = useState<"overview" | "cpd">("overview");
  const [elevateEvidenceEventId, setElevateEvidenceEventId] = useState("");
  const [elevateImplementationImpact, setElevateImplementationImpact] = useState("");
  const [controlledLevelDrafts, setControlledLevelDrafts] = useState<Record<number, boolean>>({});
  const [savingElevateLevel, setSavingElevateLevel] = useState<number | null>(null);

  useEffect(() => {
    setShowElevateResult(openElevateResult);
    if (!staffId) {
      setDetail(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setStatusMessage("");
    setActiveProfileTab("overview");
    api
      .staffProfile(staffId, academicYear)
      .then((nextDetail) => {
        if (cancelled) {
          return;
        }

        setDetail(nextDetail);
        setDrafts(buildReflectionDrafts(nextDetail.reflections));
        syncElevateStatusDrafts(nextDetail);
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
          setStatusMessage("The Staff Profile could not be loaded from the API.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [academicYear, openElevateResult, staffId]);

  const canEditReflections =
    Boolean(detail) && (detail?.staffId === user.staffId || user.permissions.includes("staff.manage"));

  const submittedReflectionCount =
    detail?.reflections.filter((reflection) => reflection.status === "submitted").length ?? 0;
  const openActionCount = detail?.actions.filter((action) => !action.completedDate).length ?? 0;
  const completedActionCount = detail?.actions.filter((action) => Boolean(action.completedDate)).length ?? 0;
  const totalCpdMinutes = detail?.cpdRecords.reduce(
    (total, record) => total + (record.durationMinutes ?? 0),
    0
  ) ?? 0;
  const internalCpdCount = detail?.cpdRecords.filter((record) => record.isInternal).length ?? 0;
  const externalCpdCount = detail?.cpdRecords.filter((record) => !record.isInternal).length ?? 0;

  async function reloadDetail() {
    try {
      const nextDetail = await api.staffProfile(staffId, academicYear);
      setDetail(nextDetail);
      setDrafts(buildReflectionDrafts(nextDetail.reflections));
      syncElevateStatusDrafts(nextDetail);
    } catch {
      setStatusMessage("The Staff Profile could not be reloaded from the API.");
    }
  }

  function syncElevateStatusDrafts(nextDetail: StaffProfileDetail) {
    const explorer = nextDetail.elevateStatus.levels.find((level) => level.levelNumber === 1);
    setElevateEvidenceEventId(explorer?.evidenceCpdEventId ?? "");
    setElevateImplementationImpact(explorer?.implementationImpact ?? "");
    setControlledLevelDrafts(Object.fromEntries(
      nextDetail.elevateStatus.levels
        .filter((level) => level.levelNumber > 1)
        .map((level) => [level.levelNumber, level.isAwarded])
    ));
  }

  async function saveElevateLevel(level: ElevateStatusLevelSummary) {
    if (!detail) return;

    setSavingElevateLevel(level.levelNumber);
    setStatusMessage("");
    const result = await api.saveElevateStatusLevel(detail.staffId, level.levelNumber, {
      academicYear: detail.academicYear,
      confirmed: level.levelNumber === 1 ? true : Boolean(controlledLevelDrafts[level.levelNumber]),
      evidenceCpdEventId: level.levelNumber === 1 ? elevateEvidenceEventId : undefined,
      implementationImpact: level.levelNumber === 1 ? elevateImplementationImpact : undefined
    });
    setSavingElevateLevel(null);
    if (!result.ok) {
      setStatusMessage(result.message ?? "The Elevate Status level could not be saved.");
      return;
    }

    setStatusMessage(`${level.name} ${level.levelNumber === 1 || controlledLevelDrafts[level.levelNumber] ? "saved" : "revoked"}.`);
    await reloadDetail();
  }

  async function createReflection() {
    if (!detail) {
      return;
    }

    setIsCreatingReflection(true);
    setStatusMessage("");
    const result = await api.createStaffReflection(detail.staffId);
    setIsCreatingReflection(false);
    if (!result.ok) {
      setStatusMessage(result.message ?? "The reflection could not be created.");
      return;
    }

    setStatusMessage("Reflection draft created from the current Elevate Learning and Innovation assessment.");
    await reloadDetail();
  }

  async function saveReflection(reflection: StaffReflectionSummary) {
    if (!detail) {
      return;
    }

    const draft = drafts[reflection.id];
    if (!draft) {
      return;
    }

    setSavingReflectionId(reflection.id);
    setStatusMessage("");
    const result = await api.updateStaffReflection(detail.staffId, reflection.id, draft);
    setSavingReflectionId(null);
    if (!result.ok) {
      setStatusMessage(result.message ?? "The reflection could not be saved.");
      return;
    }

    setStatusMessage(draft.status === "submitted" ? "Reflection submitted." : "Reflection draft saved.");
    await reloadDetail();
  }

  function updateReflectionDraft<Key extends keyof StaffReflectionDraft>(
    reflectionId: string,
    key: Key,
    value: StaffReflectionDraft[Key]
  ) {
    setDrafts((current) => {
      const draft = current[reflectionId];
      return draft
        ? { ...current, [reflectionId]: { ...draft, [key]: value } }
        : current;
    });
  }

  if (isLoading && !detail) {
    return (
      <section className="panel">
        <p className="muted-copy">Loading the Staff Profile...</p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="panel">
        <p className="muted-copy">{statusMessage || "No Staff Profile is available for this staff member."}</p>
      </section>
    );
  }

  if (showElevateResult) {
    return <ElevatePracticeResultPage onBack={() => setShowElevateResult(false)} recordId={elevateRecordId || detail.elevatePractice?.recordId} staffId={detail.staffId} />;
  }

  return (
    <>
      {statusMessage ? <div className="notice-row">{statusMessage}</div> : null}

      <div className="segmented-control" aria-label="Staff Profile section" role="tablist">
        <button
          aria-selected={activeProfileTab === "overview"}
          className={activeProfileTab === "overview" ? "is-active" : ""}
          onClick={() => setActiveProfileTab("overview")}
          role="tab"
          type="button"
        >
          Overview
        </button>
        <button
          aria-selected={activeProfileTab === "cpd"}
          className={activeProfileTab === "cpd" ? "is-active" : ""}
          onClick={() => setActiveProfileTab("cpd")}
          role="tab"
          type="button"
        >
          CPD
        </button>
      </div>

      {detail.elevateStatus.levels.some((level) => level.isAwarded) ? (
        <section className="elevate-status-banner" hidden={activeProfileTab !== "overview"} aria-label={`Elevate Status badges for ${detail.academicYear}`}>
          <div className="elevate-status-banner-heading">
            <div>
              <span>Elevate Status</span>
              <strong>{detail.displayName}</strong>
            </div>
            <small>{detail.academicYear}</small>
          </div>
          <div className="elevate-status-badges">
            {detail.elevateStatus.levels.filter((level) => level.isAwarded).map((level) => (
              <img alt={`Elevate ${level.name}`} key={level.levelNumber} src={elevateStatusAsset(level.levelKey)} />
            ))}
          </div>
        </section>
      ) : null}

      <details className="panel elevate-status-panel" hidden={activeProfileTab !== "overview"}>
        <summary className="elevate-status-summary">
          <div className="elevate-status-summary-icon"><Award aria-hidden="true" size={20} /></div>
          <div>
            <h2>Elevate Status</h2>
            <span>{detail.elevateStatus.internalCpdSessionsAttended} of 15 internal CPD sessions recorded in {detail.academicYear}</span>
          </div>
          <span>{detail.elevateStatus.levels.filter((level) => level.isAwarded).length} of 5 levels</span>
          <ChevronDown aria-hidden="true" size={19} />
        </summary>
        <div className="elevate-status-body">
          <div className="elevate-level-track" aria-label="Elevate Status progress">
            {detail.elevateStatus.levels.map((level) => (
              <div className={level.isAwarded ? "is-awarded" : level.isEligible ? "is-eligible" : ""} key={level.levelNumber}>
                <span>Level {level.levelNumber}</span>
                <strong>{level.name}</strong>
                <small>{level.requiredSessions} sessions</small>
              </div>
            ))}
          </div>

          {detail.elevateStatus.levels.filter((level) => level.levelNumber === 1).map((level) => (
            <section className="elevate-level-editor" key={level.levelNumber}>
              <div className="elevate-level-editor-heading">
                <div>
                  <span>Level 1</span>
                  <h3>Explorer evidence</h3>
                </div>
                <span className={`status-pill ${level.isAwarded ? "status-complete" : level.isEligible ? "status-open" : "status-draft"}`}>
                  {level.isAwarded ? "Awarded" : level.isEligible ? "Ready for evidence" : `${level.requiredSessions} sessions required`}
                </span>
              </div>
              <div className="elevate-explorer-fields">
                <label className="entry-field">
                  <span>Internal CPD session</span>
                  <select
                    disabled={!detail.elevateStatus.canSubmitExplorerEvidence || (!level.isEligible && !level.isAwarded)}
                    onChange={(event) => setElevateEvidenceEventId(event.target.value)}
                    value={elevateEvidenceEventId}
                  >
                    <option value="">Select attended CPD</option>
                    {detail.elevateStatus.eligibleInternalCpd.map((record) => (
                      <option key={record.cpdEventId} value={record.cpdEventId}>
                        {formatDate(record.eventDate)} - {record.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="entry-field">
                  <span>Implementation and impact</span>
                  <textarea
                    disabled={!detail.elevateStatus.canSubmitExplorerEvidence || (!level.isEligible && !level.isAwarded)}
                    onChange={(event) => setElevateImplementationImpact(event.target.value)}
                    placeholder="Describe what you implemented and the impact it had."
                    rows={4}
                    value={elevateImplementationImpact}
                  />
                </label>
              </div>
              {detail.elevateStatus.canSubmitExplorerEvidence ? (
                <div className="elevate-level-editor-footer">
                  <Button
                    disabled={savingElevateLevel !== null || (!level.isEligible && !level.isAwarded) || !elevateEvidenceEventId || !elevateImplementationImpact.trim()}
                    icon={Save}
                    onClick={() => void saveElevateLevel(level)}
                    variant="primary"
                  >
                    {savingElevateLevel === 1 ? "Saving..." : level.isAwarded ? "Update Explorer evidence" : "Save Explorer evidence"}
                  </Button>
                </div>
              ) : null}
            </section>
          ))}

          {detail.elevateStatus.canManageControlledLevels ? (
            <section className="elevate-controlled-levels">
              <div className="elevate-controlled-heading">
                <h3>Teaching and Learning confirmations</h3>
                <span>T&L and Admin only</span>
              </div>
              {detail.elevateStatus.levels.filter((level) => level.levelNumber > 1).map((level) => (
                <article className="elevate-controlled-row" key={level.levelNumber}>
                  <div>
                    <span>Level {level.levelNumber} - {level.requiredSessions} sessions</span>
                    <strong>{level.name}</strong>
                    <p>{level.requirementLabel}</p>
                  </div>
                  <label className="elevate-confirmation-check">
                    <input
                      checked={Boolean(controlledLevelDrafts[level.levelNumber])}
                      disabled={savingElevateLevel !== null || (!level.isEligible && !level.isAwarded)}
                      onChange={(event) => setControlledLevelDrafts((current) => ({ ...current, [level.levelNumber]: event.target.checked }))}
                      type="checkbox"
                    />
                    <span>Confirmed</span>
                  </label>
                  <Button
                    disabled={savingElevateLevel !== null
                      || (!level.isEligible && !level.isAwarded)
                      || Boolean(controlledLevelDrafts[level.levelNumber]) === level.isAwarded}
                    icon={Save}
                    onClick={() => void saveElevateLevel(level)}
                  >
                    {savingElevateLevel === level.levelNumber ? "Saving..." : "Save"}
                  </Button>
                </article>
              ))}
            </section>
          ) : null}
        </div>
      </details>

      <section className="kpi-strip" aria-label="Staff Profile summary" hidden={activeProfileTab !== "overview"}>
        <div className="kpi kpi-blue">
          <span>CPD sessions</span>
          <strong>{detail.cpdRecords.length}</strong>
        </div>
        <div className="kpi kpi-green">
          <span>Evidence submitted</span>
          <strong>{detail.evidenceSubmitted}</strong>
        </div>
        <div className="kpi kpi-amber">
          <span>Reflections</span>
          <strong>
            {submittedReflectionCount}/{detail.reflections.length}
          </strong>
        </div>
        <div className="kpi kpi-red">
          <span>Open actions</span>
          <strong>{openActionCount}</strong>
        </div>
      </section>

      <div className="staff-profile-layout" hidden={activeProfileTab !== "overview"}>
        <section className="panel">
          <div className="panel-heading">
            <h2>{detail.displayName}</h2>
            <span>{detail.externalId}</span>
          </div>
          <dl className="definition-list">
            <dt>Email</dt>
            <dd>{detail.email}</dd>
            <dt>Team</dt>
            <dd>{detail.primaryOrgCode ?? "Unassigned"}</dd>
            <dt>Directory status</dt>
            <dd>{detail.accountStatus}</dd>
          </dl>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Elevate Learning and Innovation</h2>
            <span>{detail.elevatePractice?.academicYear ?? "Current year"}</span>
          </div>
          <div className="profile-practice-tile">
            <div>
              <span className={`status-pill ${detail.elevatePractice?.status === "submitted" ? "status-complete" : detail.elevatePractice?.status === "draft" ? "status-draft" : "status-overdue"}`}>
                {detail.elevatePractice?.status === "submitted" ? "Submitted" : detail.elevatePractice?.status === "draft" ? "Draft" : "Not started"}
              </span>
              <strong className="profile-practice-judgement">
                {detail.elevatePractice?.status === "submitted"
                  ? detail.elevatePractice.judgement ?? "Submitted"
                  : "Not yet submitted"}
              </strong>
              <span>Current Elevate Learning and Innovation outcome</span>
            </div>
            {detail.elevatePractice?.status === "submitted" ? (
              <Button icon={ExternalLink} onClick={() => setShowElevateResult(true)} variant="primary">View report</Button>
            ) : null}
          </div>
          <p className="muted-copy">
            {detail.elevatePractice?.status === "submitted"
              ? "The submitted assessment is locked. Development plans are available in Actions."
              : detail.elevatePractice?.status === "draft"
                ? "The assessment is in progress and has not been submitted."
                : "No self-assessment has been started yet."}
          </p>
          {detail.elevatePractice?.focusAreas.length ? (
            <div className="profile-development-list">
              <h3>Current LIV focus areas</h3>
              {detail.elevatePractice.focusAreas.map((focus) => (
                <article key={`${focus.focusType}-${focus.focusKey}`}>
                  <div>
                    <span>{focus.focusType === "primary" ? "Primary focus" : "Secondary focus"}</span>
                    <strong>{focus.focusName}</strong>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-copy">No LIV focus areas have been selected.</p>
          )}
        </section>
      </div>

      <section className="panel" hidden={activeProfileTab !== "cpd"} role="tabpanel">
        <div className="panel-heading">
          <h2>CPD engagement</h2>
          <span>{formatDuration(totalCpdMinutes)} recorded</span>
        </div>
        <div className="profile-cpd-summary">
          <div>
            <span>Total CPD time</span>
            <strong>{formatDuration(totalCpdMinutes)}</strong>
          </div>
          <div>
            <span>Internal CPD</span>
            <strong>{internalCpdCount}</strong>
          </div>
          <div>
            <span>External CPD</span>
            <strong>{externalCpdCount}</strong>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Date</th>
                <th>Themes</th>
                <th>Type</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {detail.cpdRecords.length === 0 ? (
                <tr>
                  <td colSpan={5}>No CPD attendance has been recorded yet.</td>
                </tr>
              ) : (
                detail.cpdRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{record.title}</td>
                    <td>{record.eventDate}</td>
                    <td>{formatThemes(record.themes)}</td>
                    <td>{record.isInternal ? "Internal" : "External"}</td>
                    <td>{record.durationMinutes ? formatDuration(record.durationMinutes) : "Not recorded"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" hidden={activeProfileTab !== "overview"}>
        <div className="panel-heading">
          <h2>Coaching and mentoring</h2>
          <span>{detail.coachingRecords.length} sessions</span>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Date</th>
                <th>Coach or mentor</th>
                <th>Focus</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.coachingRecords.length === 0 ? (
                <tr>
                  <td colSpan={5}>No coaching or mentoring sessions have been recorded yet.</td>
                </tr>
              ) : (
                detail.coachingRecords.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <strong>{formatCoachingType(record.sessionType)}</strong>
                      <small className="table-subline">Cycle {record.cycleNumber}, session {record.sessionNumber}</small>
                    </td>
                    <td>{formatDate(record.sessionDate)}</td>
                    <td>{record.coachName}</td>
                    <td>
                      {record.primaryFocus ?? "Not recorded"}
                      {record.specificSessionFocus ? <small className="table-subline">{record.specificSessionFocus}</small> : null}
                    </td>
                    <td>
                      <span className={`status-pill ${record.status === "completed" ? "status-complete" : "status-draft"}`}>
                        {record.status === "completed" ? "Completed" : "Draft"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" hidden={activeProfileTab !== "overview"}>
        <div className="panel-heading">
          <div>
            <h2>Staff reflections</h2>
            <span>{detail.reflections.length} record{detail.reflections.length === 1 ? "" : "s"}</span>
          </div>
          {canEditReflections ? (
            <Button
              disabled={isCreatingReflection || detail.elevatePractice?.status !== "submitted" || detail.academicYear !== currentAcademicYear()}
              icon={Plus}
              onClick={() => void createReflection()}
              variant="primary"
            >
              {isCreatingReflection ? "Creating..." : "Add reflection"}
            </Button>
          ) : (
            <span>Read only</span>
          )}
        </div>
        <div className="staff-reflection-list">
          {detail.reflections.length === 0 ? (
            <p className="muted-copy">No staff reflections have been recorded.</p>
          ) : detail.reflections.map((reflection) => {
            const draft = drafts[reflection.id] ?? reflectionToDraft(reflection);
            const isSaving = savingReflectionId === reflection.id;
            const hasChanges = reflectionHasChanges(reflection, draft);
            return (
              <details className="staff-reflection-entry" key={reflection.id}>
                <summary className="staff-reflection-heading">
                  <div>
                    <h3>Reflection from {formatDate(reflection.reflectionDate)}</h3>
                    <span>Elevate Learning and Innovation {reflection.elevatePracticeAcademicYear}</span>
                  </div>
                  <span className={`status-pill ${reflection.status === "submitted" ? "status-complete" : "status-draft"}`}>
                    {reflection.status === "submitted" ? "Submitted" : "Draft"}
                  </span>
                  <ChevronDown aria-hidden="true" size={18} />
                </summary>

                <div className="staff-reflection-body">
                  <div className="staff-reflection-meta-grid">
                    <label className="entry-field">
                      <span>Reflection date</span>
                      <input
                        disabled={!canEditReflections}
                        onChange={(event) => updateReflectionDraft(reflection.id, "reflectionDate", event.target.value)}
                        type="date"
                        value={draft.reflectionDate}
                      />
                    </label>
                    <label className="entry-field">
                      <span>Record status</span>
                      <select
                        disabled={!canEditReflections}
                        onChange={(event) => updateReflectionDraft(
                          reflection.id,
                          "status",
                          event.target.value as StaffReflectionDraft["status"]
                        )}
                        value={draft.status}
                      >
                        <option value="draft">Draft</option>
                        <option value="submitted">Submitted</option>
                      </select>
                    </label>
                  </div>

                  <div className="staff-reflection-areas">
                    <strong>Linked LIV focus areas</strong>
                    {reflection.focusAreas.length === 0 ? (
                      <span>No primary or secondary focus was recorded in the linked assessment</span>
                    ) : (
                      <ul>
                        {reflection.focusAreas.map((focus) => (
                          <li key={`${focus.focusType}-${focus.displayOrder}`}>
                            <strong>{focus.focusType === "primary" ? "Primary" : "Secondary"}:</strong> {focus.textSnapshot}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="staff-reflection-fields">
                    <label className="entry-field">
                      <span>Progress</span>
                      <textarea
                        disabled={!canEditReflections}
                        onChange={(event) => updateReflectionDraft(reflection.id, "progress", event.target.value)}
                        rows={4}
                        value={draft.progress ?? ""}
                      />
                    </label>
                    <label className="entry-field">
                      <span>Impact</span>
                      <textarea
                        disabled={!canEditReflections}
                        onChange={(event) => updateReflectionDraft(reflection.id, "impact", event.target.value)}
                        rows={4}
                        value={draft.impact ?? ""}
                      />
                    </label>
                    <label className="entry-field">
                      <span>Examples</span>
                      <textarea
                        disabled={!canEditReflections}
                        onChange={(event) => updateReflectionDraft(reflection.id, "examples", event.target.value)}
                        rows={4}
                        value={draft.examples ?? ""}
                      />
                    </label>
                  </div>

                  <div className="staff-reflection-footer">
                    <small className="muted-copy">
                      {reflection.updatedAt
                        ? `Updated ${formatDateTime(reflection.updatedAt)}${reflection.updatedByName ? ` by ${reflection.updatedByName}` : ""}`
                        : `Created ${formatDateTime(reflection.createdAt)}${reflection.createdByName ? ` by ${reflection.createdByName}` : ""}`}
                    </small>
                    {canEditReflections ? (
                      <Button
                        disabled={isSaving || !hasChanges}
                        icon={Save}
                        onClick={() => void saveReflection(reflection)}
                        variant="primary"
                      >
                        {isSaving ? "Saving..." : "Save reflection"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section className="panel" hidden={activeProfileTab !== "overview"}>
        <div className="panel-heading">
          <h2>Actions</h2>
          <span>{openActionCount} open / {completedActionCount} completed</span>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Owner</th>
                <th>Source</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.actions.length === 0 ? (
                <tr>
                  <td colSpan={5}>No actions are connected to this staff member.</td>
                </tr>
              ) : (
                detail.actions.map((action) => (
                  <tr key={action.id}>
                    <td>
                      <strong>{action.title}</strong>
                      {action.detail ? <small className="table-subline">{action.detail}</small> : null}
                    </td>
                    <td>{action.ownerName}</td>
                    <td>
                      {formatActionSource(action.sourceModuleName, action.sourceRecordType)}
                      {action.sourceRecordTitle ? <small className="table-subline">{action.sourceRecordTitle}</small> : null}
                    </td>
                    <td>{action.dueDate ? formatDate(action.dueDate) : "No due date"}</td>
                    <td>
                      <span
                        className={`status-pill ${action.completedDate ? "status-complete" : action.isOverdue ? "status-overdue" : "status-open"}`}
                      >
                        {action.completedDate ? "Closed" : action.isOverdue ? "Overdue" : "Open"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function formatThemes(themes?: string) {
  if (!themes) {
    return "Not recorded";
  }

  return themes
    .split("|")
    .map((theme) => theme.trim())
    .filter(Boolean)
    .join(", ");
}

function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} minutes`;
  if (minutes === 0) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours}h ${minutes}m`;
}

function buildReflectionDrafts(reflections: StaffReflectionSummary[]) {
  return Object.fromEntries(
    reflections.map((reflection) => [reflection.id, reflectionToDraft(reflection)])
  ) as Record<string, StaffReflectionDraft>;
}

function reflectionToDraft(reflection: StaffReflectionSummary): StaffReflectionDraft {
  return {
    reflectionDate: reflection.reflectionDate,
    progress: reflection.progress ?? "",
    impact: reflection.impact ?? "",
    examples: reflection.examples ?? "",
    status: reflection.status
  };
}

function reflectionHasChanges(reflection: StaffReflectionSummary, draft: StaffReflectionDraft) {
  const original = reflectionToDraft(reflection);
  return original.reflectionDate !== draft.reflectionDate
    || original.status !== draft.status
    || normalizeDraftText(original.progress) !== normalizeDraftText(draft.progress)
    || normalizeDraftText(original.impact) !== normalizeDraftText(draft.impact)
    || normalizeDraftText(original.examples) !== normalizeDraftText(draft.examples);
}

function normalizeDraftText(value?: string) {
  return value?.trim() ?? "";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatActionSource(moduleName?: string, recordType?: string) {
  if (recordType === "liv") {
    return "Learning and Innovation Visits";
  }

  if (moduleName) {
    return moduleName;
  }

  if (recordType) {
    return recordType
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  return "Action engine";
}

function formatCoachingType(value: "coaching" | "mentoring") {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function elevateStatusAsset(levelKey: ElevateStatusLevelSummary["levelKey"]) {
  return `/system-assets/elevate-status/${levelKey}.png`;
}

function currentAcademicYear() {
  const now = new Date();
  const calendarYear = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 7 ? calendarYear : calendarYear - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}
