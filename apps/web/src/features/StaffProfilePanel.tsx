import { useEffect, useState } from "react";
import { ExternalLink, Plus, Save } from "lucide-react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import { ElevatePracticeResultPage } from "../routes/ElevatePractice";
import type {
  CurrentUser,
  StaffProfileDetail,
  StaffProfileSummary,
  StaffReflectionSummary,
  SaveStaffReflectionRequest
} from "../services/types";

type StaffReflectionDraft = SaveStaffReflectionRequest;

/**
 * Full staff profile view assembled from its source records (Elevate Your
 * Practice, reflections, CPD, actions and coaching) and backed by
 * GET /staff-profiles/{staffId}. Reflections are editable when the viewer is
 * the staff member themselves or holds staff.manage - the API enforces the
 * same rule on save.
 */
export function StaffProfilePanel({
  staffId,
  user,
  profiles = []
}: {
  staffId: string;
  user: CurrentUser;
  profiles?: StaffProfileSummary[];
}) {
  const [detail, setDetail] = useState<StaffProfileDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, StaffReflectionDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingReflectionId, setSavingReflectionId] = useState<string | null>(null);
  const [isCreatingReflection, setIsCreatingReflection] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [showElevateResult, setShowElevateResult] = useState(false);

  useEffect(() => {
    setShowElevateResult(false);
    if (!staffId) {
      setDetail(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setStatusMessage("");
    api
      .staffProfile(staffId)
      .then((nextDetail) => {
        if (cancelled) {
          return;
        }

        setDetail(nextDetail);
        setDrafts(buildReflectionDrafts(nextDetail.reflections));
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
  }, [staffId]);

  const canEditReflections =
    Boolean(detail) && (detail?.staffId === user.staffId || user.permissions.includes("staff.manage"));

  const submittedReflectionCount =
    detail?.reflections.filter((reflection) => reflection.status === "submitted").length ?? 0;
  const openActionCount = detail?.actions.filter((action) => !action.completedDate).length ?? 0;
  const completedActionCount = detail?.actions.filter((action) => Boolean(action.completedDate)).length ?? 0;

  async function reloadDetail() {
    try {
      const nextDetail = await api.staffProfile(staffId);
      setDetail(nextDetail);
      setDrafts(buildReflectionDrafts(nextDetail.reflections));
    } catch {
      setStatusMessage("The Staff Profile could not be reloaded from the API.");
    }
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

    setStatusMessage("Reflection draft created from the current Elevate Your Practice assessment.");
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
    return <ElevatePracticeResultPage onBack={() => setShowElevateResult(false)} staffId={detail.staffId} />;
  }

  return (
    <>
      {statusMessage ? <div className="notice-row">{statusMessage}</div> : null}

      <section className="kpi-strip" aria-label="Staff Profile summary">
        <div className="kpi kpi-blue">
          <span>CPD sessions</span>
          <strong>{detail.cpdRecords.length}</strong>
        </div>
        <div className="kpi kpi-green">
          <span>Evidence submitted</span>
          <strong>{detail.evidenceSubmitted}</strong>
        </div>
        <div className="kpi">
          <span>Milestones completed</span>
          <strong>{detail.milestonesCompleted}</strong>
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

      <div className="staff-profile-layout">
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
            <h2>Elevate Your Practice</h2>
            <span>{detail.elevatePractice?.academicYear ?? "Current year"}</span>
          </div>
          <div className="profile-practice-tile">
            <div>
              <span className={`status-pill ${detail.elevatePractice?.status === "submitted" ? "status-complete" : detail.elevatePractice?.status === "draft" ? "status-draft" : "status-overdue"}`}>
                {detail.elevatePractice?.status === "submitted" ? "Submitted" : detail.elevatePractice?.status === "draft" ? "Draft" : "Not started"}
              </span>
              <strong className="profile-practice-judgement">
                {detail.elevatePractice?.judgement ?? "No current judgement"}
              </strong>
              <span>Current rubric judgement</span>
            </div>
            {detail.elevatePractice?.status === "submitted" ? (
              <Button icon={ExternalLink} onClick={() => setShowElevateResult(true)} variant="primary">View report</Button>
            ) : null}
          </div>
          <p className="muted-copy">
            {detail.elevatePractice?.status === "submitted"
              ? "The submitted assessment is locked. Development plans are available in Actions."
              : detail.elevatePractice?.status === "draft"
                ? "The annual assessment is in progress and has not been submitted."
                : "No annual self-assessment has been started yet."}
          </p>
          {detail.elevatePractice?.developmentAreas.length ? (
            <div className="profile-development-list">
              <h3>Current development areas</h3>
              {detail.elevatePractice.developmentAreas.map((area) => (
                <article key={area.areaKey}>
                  <div>
                    <strong>{area.areaName}</strong>
                  </div>
                  {area.developmentApproach ? <p>{area.developmentApproach}</p> : null}
                  {area.intendedImpact ? <small>Intended impact: {area.intendedImpact}</small> : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-copy">No current development areas have been selected.</p>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>Elevate Your Practice reflections</h2>
          <span>{detail.elevatePractice?.reflections.length ?? 0} recorded</span>
        </div>
        {detail.elevatePractice?.reflections.length ? (
          <div className="profile-source-reflections">
            {detail.elevatePractice.reflections.map((reflection) => (
              <article key={reflection.areaKey}>
                <strong>{reflection.areaName}</strong>
                <p>{reflection.reflection}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-copy">No Elevate Your Practice reflections are available for the current assessment.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>CPD engagement</h2>
          <span>{detail.cpdRecords.length} attended</span>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Date</th>
                <th>Themes</th>
              </tr>
            </thead>
            <tbody>
              {detail.cpdRecords.length === 0 ? (
                <tr>
                  <td colSpan={3}>No CPD attendance has been recorded yet.</td>
                </tr>
              ) : (
                detail.cpdRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{record.title}</td>
                    <td>{record.eventDate}</td>
                    <td>{formatThemes(record.themes)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
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
                      {record.mainFocus ?? "Not recorded"}
                      {record.keyTakeaway ? <small className="table-subline">{record.keyTakeaway}</small> : null}
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

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Staff reflections</h2>
            <span>{detail.reflections.length} record{detail.reflections.length === 1 ? "" : "s"}</span>
          </div>
          {canEditReflections ? (
            <Button
              disabled={isCreatingReflection || detail.elevatePractice?.status !== "submitted"}
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
              <article className="staff-reflection-entry" key={reflection.id}>
                <div className="staff-reflection-heading">
                  <div>
                    <h3>Reflection from {formatDate(reflection.reflectionDate)}</h3>
                    <span>Elevate Your Practice {reflection.elevatePracticeAcademicYear}</span>
                  </div>
                  <span className={`status-pill ${reflection.status === "submitted" ? "status-complete" : "status-draft"}`}>
                    {reflection.status === "submitted" ? "Submitted" : "Draft"}
                  </span>
                </div>

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
                  <strong>Linked development areas</strong>
                  {reflection.developmentAreas.length === 0 ? (
                    <span>None selected in the linked assessment</span>
                  ) : (
                    <ul>
                      {reflection.developmentAreas.map((area) => (
                        <li key={area.developmentAreaId}>{area.textSnapshot}</li>
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
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
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

function formatCoachingType(value: "coaching" | "mentoring" | "combined") {
  return value === "combined" ? "Coaching and mentoring" : value.charAt(0).toUpperCase() + value.slice(1);
}
