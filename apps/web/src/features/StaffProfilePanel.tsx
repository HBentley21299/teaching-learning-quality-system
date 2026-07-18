import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ExternalLink, Plus, Save, Search, X } from "lucide-react";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { ActionDetailLink, FullRecordLink } from "../components/FullRecordLink";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import { ElevatePracticeResultPage } from "../routes/ElevatePractice";
import type {
  ActionSummary,
  CurrentUser,
  StaffProfileDetail,
  StaffProfileSummary,
  StaffReflectionSummary
} from "../services/types";

/**
 * Full staff profile view (KPIs, reflections, CPD, LIV actions) backed by
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
  const [isAddingReflection, setIsAddingReflection] = useState(false);
  const [reflectionTitle, setReflectionTitle] = useState("");
  const [reflectionText, setReflectionText] = useState("");
  const [reflectionDate, setReflectionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [recordSearch, setRecordSearch] = useState("");
  const [recordTypeFilter, setRecordTypeFilter] = useState("all");
  const [recordStatusFilter, setRecordStatusFilter] = useState("all");
  const [recordStartDate, setRecordStartDate] = useState("");
  const [recordEndDate, setRecordEndDate] = useState("");
  const [reflectionSearch, setReflectionSearch] = useState("");
  const [reflectionStartDate, setReflectionStartDate] = useState("");
  const [reflectionEndDate, setReflectionEndDate] = useState("");

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
  const reflectionTotal = getReflectionTotal(completedReflectionCount, detail?.reflectionRecords.length ?? 0);
  const overdueReflection = detail?.reflections.find((reflection) => reflection.status === "overdue");
  const staffActions = useMemo<ActionSummary[]>(() => detail?.actions ?? [], [detail]);
  const openActionCount = staffActions.filter((action) => !action.completedDate).length;
  const filteredAssociatedRecords = useMemo(() => {
    if (!detail) return [];
    const query = recordSearch.trim().toLocaleLowerCase();
    return detail.associatedRecords.filter((record) => {
      const date = record.recordDate ?? "";
      return (!query || [record.title, record.summary, record.recordType, record.practiceObserved]
        .some((value) => value?.toLocaleLowerCase().includes(query))) &&
        (recordTypeFilter === "all" || record.recordType === recordTypeFilter) &&
        (recordStatusFilter === "all" || record.status === recordStatusFilter) &&
        (!recordStartDate || date >= recordStartDate) &&
        (!recordEndDate || date <= recordEndDate);
    });
  }, [detail, recordEndDate, recordSearch, recordStartDate, recordStatusFilter, recordTypeFilter]);

  const associatedRecordTypes = useMemo(
    () => [...new Set((detail?.associatedRecords ?? []).map((record) => record.recordType))].sort(),
    [detail]
  );
  const associatedRecordStatuses = useMemo(
    () => [...new Set((detail?.associatedRecords ?? []).map((record) => record.status))].sort(),
    [detail]
  );
  const filteredReflectionRecords = useMemo(() => {
    const query = reflectionSearch.trim().toLocaleLowerCase();
    return (detail?.reflectionRecords ?? []).filter((reflection) =>
      (!query || [reflection.title, reflection.text].some((value) => value.toLocaleLowerCase().includes(query)))
      && (!reflectionStartDate || reflection.reflectionDate >= reflectionStartDate)
      && (!reflectionEndDate || reflection.reflectionDate <= reflectionEndDate));
  }, [detail, reflectionEndDate, reflectionSearch, reflectionStartDate]);

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

  async function addReflection() {
    if (!detail || !reflectionTitle.trim() || !reflectionText.trim() || !reflectionDate) {
      setStatusMessage("Add a title, reflection date and reflection text.");
      return;
    }
    setIsSaving(true);
    const result = await api.createReflection(detail.staffId, {
      title: reflectionTitle.trim(),
      text: reflectionText.trim(),
      reflectionDate
    });
    setIsSaving(false);
    if (!result.ok) {
      setStatusMessage(result.message ?? "The reflection could not be saved.");
      return;
    }
    setReflectionTitle("");
    setReflectionText("");
    setIsAddingReflection(false);
    setStatusMessage("Reflection added.");
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
          <strong>{reflectionTotal}</strong>
        </div>
        <div className="kpi kpi-red">
          <span>Open actions</span>
          <strong>{openActionCount}</strong>
        </div>
      </section>

      <ElevateStatusTiles achievedLevels={detail.milestonesCompleted} />

      <div className="staff-profile-layout">
        <section className="panel">
          <div className="panel-heading">
            <h2>{detail.displayName}</h2>
            <span>{detail.externalId}</span>
          </div>
          <dl className="definition-list">
            <dt>Email</dt>
            <dd>{detail.email}</dd>
            <dt>Job title</dt>
            <dd>{detail.jobTitle ?? "Not recorded"}</dd>
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
              <strong>{detail.elevatePractice?.overallAverage?.toFixed(2) ?? "-"}</strong>
              <span>Overall practice profile</span>
            </div>
            {detail.elevatePractice?.status === "submitted" ? (
              <div className="toolbar">
                <Button icon={ExternalLink} onClick={() => setShowElevateResult(true)} variant="primary">View result</Button>
                <FullRecordLink label="Open record" recordId={detail.elevatePractice.recordId} recordType="elevate_practice_assessment" />
              </div>
            ) : null}
          </div>
          <p className="muted-copy">
            {detail.elevatePractice?.status === "submitted"
              ? "The submitted assessment is locked. Development plans are available in Actions."
              : detail.elevatePractice?.status === "draft"
                ? "The annual assessment is in progress and has not been submitted."
                : "No annual self-assessment has been started yet."}
          </p>
        </section>
      </div>

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
                <th>Report</th>
              </tr>
            </thead>
            <tbody>
              {detail.cpdRecords.length === 0 ? (
                <tr>
                  <td colSpan={4}>No CPD attendance has been recorded yet.</td>
                </tr>
              ) : (
                detail.cpdRecords.map((record) => (
                  <tr key={record.recordId}>
                    <td>{record.title}</td>
                    <td>{record.eventDate}</td>
                    <td>{formatThemes(record.themes)}</td>
                    <td><FullRecordLink label="View report" recordId={record.recordId} recordType={record.recordType} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <CollapsibleSection
        count={filteredAssociatedRecords.length}
        defaultOpen={false}
        title="All staff records"
      >
        <div className="record-filter-bar staff-history-filters">
          <label className="record-filter-field record-filter-search">
            <span>Search records</span>
            <span className="search-box"><Search aria-hidden="true" size={15} /><input onChange={(event) => setRecordSearch(event.target.value)} placeholder="Title, summary or judgement" type="search" value={recordSearch} /></span>
          </label>
          <label className="record-filter-field"><span>Record type</span><select onChange={(event) => setRecordTypeFilter(event.target.value)} value={recordTypeFilter}><option value="all">All types</option>{associatedRecordTypes.map((type) => <option key={type} value={type}>{formatRecordType(type)}</option>)}</select></label>
          <label className="record-filter-field"><span>Status</span><select onChange={(event) => setRecordStatusFilter(event.target.value)} value={recordStatusFilter}><option value="all">All statuses</option>{associatedRecordStatuses.map((status) => <option key={status} value={status}>{formatRecordType(status)}</option>)}</select></label>
          <label className="record-filter-field"><span>From</span><input onChange={(event) => setRecordStartDate(event.target.value)} type="date" value={recordStartDate} /></label>
          <label className="record-filter-field"><span>To</span><input onChange={(event) => setRecordEndDate(event.target.value)} type="date" value={recordEndDate} /></label>
          <Button icon={X} onClick={() => { setRecordSearch(""); setRecordTypeFilter("all"); setRecordStatusFilter("all"); setRecordStartDate(""); setRecordEndDate(""); }} variant="quiet">Clear filters</Button>
        </div>
        <div className="record-list">
          {filteredAssociatedRecords.length === 0 ? <div className="empty-row">No permitted staff records match the selected filters.</div> : filteredAssociatedRecords.map((record) => (
            <div className="record-row staff-history-row" key={record.recordId}>
              <div><strong>{record.title}</strong><span>{formatRecordType(record.recordType)}{record.summary ? ` - ${record.summary}` : ""}</span>{record.practiceObserved ? <small>Practice observed: {record.practiceObserved}</small> : null}</div>
              <span>{record.recordDate ?? "No date"}</span>
              <span className="status-pill">{formatRecordType(record.status)}</span>
              <FullRecordLink label="Open record" recordId={record.recordId} recordType={record.recordType} />
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <section className="panel">
        <div className="panel-heading">
          <h2>Reflection records</h2>
          {canEditReflections ? (
            <div className="toolbar">
              <Button icon={isAddingReflection ? X : Plus} onClick={() => setIsAddingReflection((current) => !current)}>
                {isAddingReflection ? "Cancel" : "Add reflection"}
              </Button>
              <Button
                disabled={isSaving || dirtyReflections.length === 0}
                icon={Save}
                onClick={() => void saveReflections()}
                variant="primary"
              >
                {isSaving ? "Saving..." : "Save scheduled reflections"}
              </Button>
            </div>
          ) : (
            <span>Read only</span>
          )}
        </div>
        <div className="record-filter-bar staff-history-filters">
          <label className="record-filter-field record-filter-search">
            <span>Search reflections</span>
            <span className="search-box"><Search aria-hidden="true" size={15} /><input onChange={(event) => setReflectionSearch(event.target.value)} placeholder="Title or reflection text" type="search" value={reflectionSearch} /></span>
          </label>
          <label className="record-filter-field"><span>From</span><input onChange={(event) => setReflectionStartDate(event.target.value)} type="date" value={reflectionStartDate} /></label>
          <label className="record-filter-field"><span>To</span><input onChange={(event) => setReflectionEndDate(event.target.value)} type="date" value={reflectionEndDate} /></label>
          <span className="filter-result-count" aria-live="polite">{filteredReflectionRecords.length} matching</span>
          {(reflectionSearch || reflectionStartDate || reflectionEndDate) ? (
            <Button icon={X} onClick={() => { setReflectionSearch(""); setReflectionStartDate(""); setReflectionEndDate(""); }} variant="quiet">Clear filters</Button>
          ) : null}
        </div>
        {isAddingReflection ? (
          <div className="entry-form reflection-create-form">
            <div className="entry-field-grid">
              <label className="entry-field"><span>Title <strong>Required</strong></span><input onChange={(event) => setReflectionTitle(event.target.value)} value={reflectionTitle} /></label>
              <label className="entry-field"><span>Reflection date <strong>Required</strong></span><input onChange={(event) => setReflectionDate(event.target.value)} type="date" value={reflectionDate} /></label>
              <label className="entry-field entry-field-wide"><span>Reflection <strong>Required</strong></span><textarea onChange={(event) => setReflectionText(event.target.value)} rows={6} value={reflectionText} /></label>
            </div>
            <Button disabled={isSaving} icon={Save} onClick={() => void addReflection()} variant="primary">Save reflection</Button>
          </div>
        ) : null}
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
        <div className="record-list reflection-record-list">
          {detail.reflectionRecords.length === 0 ? (
            <div className="empty-row">No additional reflection records have been added.</div>
          ) : filteredReflectionRecords.length === 0 ? (
            <div className="empty-row">No reflection records match the selected filters.</div>
          ) : filteredReflectionRecords.map((reflection) => (
            <div className="record-row" key={reflection.id}>
              <div><strong>{reflection.title}</strong><span className="preserve-lines">{reflection.text}</span></div>
              <span>{reflection.reflectionDate}</span>
              <FullRecordLink label="Open record" recordId={reflection.recordId} recordType="reflection" />
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Actions</h2>
          <span>{openActionCount} open</span>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Assigned staff</th>
                <th>Owner</th>
                <th>Source</th>
                <th>Due</th>
                <th>Status</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {staffActions.length === 0 ? (
                <tr>
                  <td colSpan={7}>No permitted actions have been assigned to this staff member.</td>
                </tr>
              ) : (
                staffActions.map((action) => (
                  <tr key={action.id}>
                    <td>{action.title}</td>
                    <td>{action.subjectStaffName ?? "Not recorded"}</td>
                    <td>{action.ownerStaffName ?? "Not recorded"}</td>
                    <td>{action.sourceRecordTitle ?? "No source record"}</td>
                    <td>{action.dueDate ?? "No due date"}</td>
                    <td>
                      <span
                        className={`status-pill ${action.completedDate ? "status-complete" : action.isOverdue ? "status-overdue" : "status-open"}`}
                      >
                        {action.completedDate ? "Closed" : action.isOverdue ? "Overdue" : "Open"}
                      </span>
                    </td>
                    <td>
                      <div className="record-link-stack">
                        <ActionDetailLink actionId={action.id} label="View details" />
                        {action.sourceRecordId && action.sourceRecordType ? (
                          <FullRecordLink label="Open source" recordId={action.sourceRecordId} recordType={action.sourceRecordType} />
                        ) : null}
                      </div>
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

export function getReflectionTotal(completedScheduledReflections: number, unrestrictedReflectionRecords: number) {
  return completedScheduledReflections + unrestrictedReflectionRecords;
}

export function ElevateStatusTiles({ achievedLevels }: { achievedLevels: number }) {
  const achieved = Math.min(Math.max(achievedLevels, 0), 5);
  return (
    <section className="panel elevate-status-panel" aria-label="Elevate status levels">
      <div className="panel-heading"><h2>Elevate status</h2><span>{achieved} levels achieved</span></div>
      <div className="elevate-status-slots">
        {[1, 2, 3, 4, 5].map((level) => {
          const isAchieved = level <= achieved;
          return (
            <div aria-label={`Level ${level} ${isAchieved ? "achieved" : "not achieved"}`} className={`elevate-status-slot${isAchieved ? " elevate-status-slot-active" : ""}`} key={level}>
              {isAchieved ? <><small>Level</small><strong>{level}</strong><span>Achieved</span></> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatRecordType(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toLocaleUpperCase());
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
