import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ExternalLink, Save } from "lucide-react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import { ElevatePracticeResultPage } from "../routes/ElevatePractice";
import type {
  CurrentUser,
  StaffProfileDetail,
  StaffProfileSummary,
  StaffReflectionSummary
} from "../services/types";

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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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
        setDrafts(
          Object.fromEntries(nextDetail.reflections.map((reflection) => [reflection.pointKey, reflection.text ?? ""]))
        );
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

  const dirtyReflections = useMemo(() => {
    if (!detail) {
      return [] as StaffReflectionSummary[];
    }

    return detail.reflections.filter(
      (reflection) => (drafts[reflection.pointKey] ?? "").trim() !== (reflection.text ?? "").trim()
    );
  }, [detail, drafts]);

  const completedReflectionCount =
    detail?.reflections.filter((reflection) => reflection.status === "completed").length ?? 0;
  const overdueReflection = detail?.reflections.find((reflection) => reflection.status === "overdue");
  const openActionCount = detail?.actions.filter((action) => !action.completedDate).length ?? 0;
  const completedActionCount = detail?.actions.filter((action) => Boolean(action.completedDate)).length ?? 0;

  async function reloadDetail() {
    try {
      const nextDetail = await api.staffProfile(staffId);
      setDetail(nextDetail);
      setDrafts(
        Object.fromEntries(nextDetail.reflections.map((reflection) => [reflection.pointKey, reflection.text ?? ""]))
      );
    } catch {
      setStatusMessage("The Staff Profile could not be reloaded from the API.");
    }
  }

  async function saveReflections() {
    if (!detail || dirtyReflections.length === 0) {
      setStatusMessage("There are no reflection changes to save.");
      return;
    }

    setIsSaving(true);
    let failureMessage = "";
    for (const reflection of dirtyReflections) {
      const result = await api.saveReflection(detail.staffId, reflection.pointKey, drafts[reflection.pointKey] ?? "");
      if (!result.ok) {
        failureMessage = result.message ?? `${reflection.name} could not be saved.`;
        break;
      }
    }

    setIsSaving(false);
    setStatusMessage(failureMessage || "Reflections saved to the Staff Profile.");
    await reloadDetail();
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
      {overdueReflection ? (
        <div className="notice-row warning-row">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{overdueReflection.name} is overdue. Complete the reflection to update the compliance status.</span>
        </div>
      ) : null}
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
            {completedReflectionCount}/{detail.reflections.length}
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
          <h2>Reflection records</h2>
          {canEditReflections ? (
            <Button
              disabled={isSaving || dirtyReflections.length === 0}
              icon={Save}
              onClick={() => void saveReflections()}
              variant="primary"
            >
              {isSaving ? "Saving..." : "Save reflections"}
            </Button>
          ) : (
            <span>Read only</span>
          )}
        </div>
        <div className="reflection-grid">
          {detail.reflections.map((reflection) => (
            <div className="reflection-card" key={reflection.pointKey}>
              <div className="reflection-card-heading">
                <strong>{reflection.name}</strong>
                <span className={`status-pill ${reflectionStatusClass(reflection.status)}`}>
                  {reflectionStatusLabel(reflection.status)}
                </span>
              </div>
              <div className="record-detail-meta">
                <span>Due {reflection.dueDate}</span>
                <span>{reflection.completionDate ? `Completed ${reflection.completionDate}` : "Not completed"}</span>
              </div>
              <label className="entry-field">
                <span>Reflection</span>
                <textarea
                  disabled={!canEditReflections}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [reflection.pointKey]: event.target.value }))
                  }
                  rows={5}
                  value={drafts[reflection.pointKey] ?? ""}
                />
              </label>
              {reflection.lastSavedAt ? (
                <small className="muted-copy">Last saved {formatDateTime(reflection.lastSavedAt)}</small>
              ) : null}
            </div>
          ))}
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

function reflectionStatusLabel(status: StaffReflectionSummary["status"]) {
  if (status === "completed") {
    return "Completed";
  }

  if (status === "overdue") {
    return "Overdue";
  }

  return "Not yet due";
}

function reflectionStatusClass(status: StaffReflectionSummary["status"]) {
  if (status === "completed") {
    return "status-complete";
  }

  if (status === "overdue") {
    return "status-overdue";
  }

  return "status-draft";
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
