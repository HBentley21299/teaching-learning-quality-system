import { ArrowLeft, Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FullRecordLink } from "../components/FullRecordLink";
import { Button } from "../design-system/Button";
import { api, ApiRequestError } from "../services/api";
import type {
  ActionDetail,
  CoachingSessionDetail,
  ElevatePracticeWorkspace,
  LivRecordSummary,
  RecordDetail,
  StaffReflectionDetail
} from "../services/types";

export type DetailRoute =
  | { kind: "record"; recordId: string; recordType: string }
  | { kind: "action"; actionId: string };

type LoadedDetail =
  | { kind: "form"; value: RecordDetail }
  | { kind: "coaching"; value: CoachingSessionDetail }
  | { kind: "liv"; value: LivRecordSummary }
  | { kind: "reflection"; value: StaffReflectionDetail }
  | { kind: "practice"; value: ElevatePracticeWorkspace }
  | { kind: "action"; value: ActionDetail };

export function RecordDetailPage({ route, onBack }: { route: DetailRoute; onBack: () => void }) {
  const [detail, setDetail] = useState<LoadedDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "missing" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setDetail(null);
    loadDetail(route)
      .then((loaded) => {
        if (!cancelled) {
          setDetail(loaded);
          setState("ready");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.status === 403) setState("forbidden");
        else if (error instanceof ApiRequestError && error.status === 404) setState("missing");
        else setState("error");
      });
    return () => { cancelled = true; };
  }, [route]);

  const title = useMemo(() => detailTitle(detail), [detail]);

  return (
    <div className="route-stack full-record-route">
      <div className="route-header">
        <div>
          <p className="eyebrow">Complete record</p>
          <h1>{title}</h1>
        </div>
        <div className="toolbar">
          {detail ? <Button icon={Download} onClick={() => exportDetail(detail)}>Export CSV</Button> : null}
          <Button icon={ArrowLeft} onClick={onBack} variant="secondary">Back</Button>
        </div>
      </div>

      {state === "loading" ? <section className="panel"><p className="muted-copy">Loading the complete record...</p></section> : null}
      {state === "forbidden" ? <AccessState title="Access denied" copy="You do not have permission to view this record. No record data has been disclosed." /> : null}
      {state === "missing" ? <AccessState title="Record unavailable" copy="This record does not exist or has been archived or deactivated." /> : null}
      {state === "error" ? <AccessState title="Record could not be loaded" copy="The API could not return the record. Try again or use Back to return to the previous view." /> : null}
      {detail?.kind === "form" ? <FormRecordDetail detail={detail.value} /> : null}
      {detail?.kind === "coaching" ? <CoachingRecordDetail detail={detail.value} /> : null}
      {detail?.kind === "liv" ? <LivRecordDetail detail={detail.value} /> : null}
      {detail?.kind === "reflection" ? <ReflectionRecordDetail detail={detail.value} /> : null}
      {detail?.kind === "practice" ? <PracticeRecordDetail detail={detail.value} /> : null}
      {detail?.kind === "action" ? <ActionRecordDetail detail={detail.value} /> : null}
    </div>
  );
}

async function loadDetail(route: DetailRoute): Promise<LoadedDetail> {
  if (route.kind === "action") return { kind: "action", value: await api.actionDetail(route.actionId) };
  if (route.recordType === "coaching_session") return { kind: "coaching", value: await api.coachingRecord(route.recordId) };
  if (["liv", "liv_record"].includes(route.recordType)) return { kind: "liv", value: await api.livRecordByRecordId(route.recordId) };
  if (route.recordType === "reflection") return { kind: "reflection", value: await api.reflectionRecord(route.recordId) };
  if (["elevate_practice", "elevate_practice_assessment"].includes(route.recordType)) return { kind: "practice", value: await api.elevatePracticeRecord(route.recordId) };
  return { kind: "form", value: await api.recordDetail(route.recordId) };
}

function AccessState({ title, copy }: { title: string; copy: string }) {
  return <section className="panel access-denied-panel"><div><h2>{title}</h2><p>{copy}</p></div></section>;
}

function FormRecordDetail({ detail }: { detail: RecordDetail }) {
  return (
    <>
      <RecordMeta items={[
        ["Record type", formatRecordType(detail.recordType)], ["Date", detail.recordDate],
        ["Owner", detail.ownerDisplayName], ["Status", detail.submissionStatus],
        ["Organisation", [detail.parentOrgUnitCode, detail.orgUnitCode].filter(Boolean).join(" / ")],
        ["Template", `${detail.templateName} v${detail.templateVersion}`]
      ]} />
      {detail.sections.map((section) => (
        <section className="panel" key={section.id}>
          <div className="panel-heading"><h2>{section.title}</h2><span>{section.fields.length} fields</span></div>
          <div className="answer-grid full-record-answer-grid">
            {section.fields.map((field) => {
              const rubric = parseRubricValue(field.value);
              return (
                <div className="answer-item answer-item-wide" key={field.id}>
                  <span>{field.label}</span>
                  {rubric ? (
                    <div className="full-rubric-answer">
                      <strong><b style={{ background: rubric.color }}>{rubric.score}</b>{rubric.label}</strong>
                      <p>{rubric.descriptor}</p>
                    </div>
                  ) : <strong className="preserve-lines">{formatValue(field.value)}</strong>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

function CoachingRecordDetail({ detail }: { detail: CoachingSessionDetail }) {
  const fields: Array<[string, unknown]> = [
    ["Staff member", detail.staffName], ["Coach or mentor", detail.coachName], ["Cycle", detail.cycleNumber],
    ["Session", detail.sessionNumber], ["Date", detail.sessionDate], ["Type", detail.sessionType],
    ["Delivery method", detail.deliveryMethod], ["Duration (minutes)", detail.durationMinutes], ["Status", detail.status],
    ["Progress reflection", detail.progressReflection], ["Main focus", detail.mainFocus], ["Additional focus", detail.additionalFocusAreas],
    ["Reason", detail.sessionReason], ["Goal", detail.goal], ["Why this matters", detail.whyThisMatters],
    ["Confidence before", detail.confidenceBefore], ["Current situation", detail.currentSituation], ["What's working", detail.whatsWorking],
    ["Challenges", detail.challenges], ["Key discussion points", detail.keyDiscussionPoints], ["Support types", detail.supportTypes],
    ["Support and resources", detail.supportResources], ["Intended impact areas", detail.intendedImpactAreas], ["Impact statement", detail.impactStatement],
    ["Confidence to complete", detail.confidenceToComplete], ["Support needed", detail.supportNeeded], ["Additional support", detail.additionalSupportDetails],
    ["Key takeaway", detail.keyTakeaway], ["Session summary", detail.sessionSummary], ["Staff agrees", detail.staffAgrees ? "Yes" : "No"],
    ["Coach agrees", detail.coachAgrees ? "Yes" : "No"], ["Another session required", detail.anotherSessionRequired],
    ["Next session", detail.nextSessionDate], ["Next focus", detail.nextFocus], ["Completed", detail.completedAt]
  ];
  return (
    <>
      <DetailGrid title="Submitted coaching and mentoring report" fields={fields} />
      <DetailGrid title="Agreed actions" fields={detail.actions.map((action, index) => [
        `Action ${index + 1}`,
        `${action.actionText}\nOwner: ${action.ownerType}\nTarget: ${action.targetDate}${action.evidenceText ? `\nEvidence: ${action.evidenceText}` : ""}`
      ])} />
      <DetailGrid title="Previous-action updates" fields={detail.previousActionUpdates.map((update, index) => [
        `Update ${index + 1}`, `${update.status}${update.updateText ? ` - ${update.updateText}` : ""}`
      ])} />
    </>
  );
}

function LivRecordDetail({ detail }: { detail: LivRecordSummary }) {
  return <DetailGrid title="Learning and Innovation Visit report" fields={[
    ["Staff member", detail.subjectStaffName], ["Reviewer", detail.reviewerStaffName], ["Date", detail.livDate],
    ["Time", detail.livTime], ["Course seen", detail.courseSeen], ["Pre-conversation", detail.preConversation],
    ["LIV overview", detail.livOverview], ["Post-conversation", detail.postConversation],
    ["Projected follow-up", detail.followUpProjectedDate], ["Second LIV overview", detail.secondLivOverview], ["Status", detail.status]
  ]} />;
}

function ReflectionRecordDetail({ detail }: { detail: StaffReflectionDetail }) {
  return <DetailGrid title="Reflection" fields={[
    ["Staff member", detail.staffName], ["Reflection date", detail.reflectionDate], ["Title", detail.title],
    ["Reflection", detail.text], ["Created", detail.createdAt]
  ]} />;
}

function PracticeRecordDetail({ detail }: { detail: ElevatePracticeWorkspace }) {
  return (
    <>
      <RecordMeta items={[["Staff member", detail.staffName], ["Academic year", detail.academicYear], ["Status", detail.status], ["Submitted", detail.submittedAt]]} />
      {detail.areas.map((area) => (
        <section className="panel" key={area.id}>
          <div className="panel-heading"><h2>{area.name}</h2><span>{area.averageScore?.toFixed(2) ?? "Not scored"}</span></div>
          <div className="answer-grid full-record-answer-grid">
            {area.statements.map((statement) => <div className="answer-item answer-item-wide" key={statement.id}><span>{statement.text}</span><strong>{statement.score ?? "Not scored"} / 5</strong></div>)}
            <div className="answer-item answer-item-wide"><span>Reflection</span><strong className="preserve-lines">{area.reflection ?? "Not recorded"}</strong></div>
          </div>
        </section>
      ))}
    </>
  );
}

function ActionRecordDetail({ detail }: { detail: ActionDetail }) {
  return (
    <>
      <DetailGrid title="Action details" fields={[
        ["Description", detail.detail], ["Assigned staff member", detail.subjectStaffName], ["Owner", detail.ownerStaffName],
        ["Due date", detail.dueDate], ["Status", detail.completedDate ? "Complete" : detail.statusKey],
        ["Priority", detail.priorityKey], ["Created", detail.createdAt], ["Last updated", detail.updatedAt],
        ["Completed", detail.completedDate], ["Closure information", detail.completionNote]
      ]} />
      {detail.sourceRecordId && detail.sourceRecordType ? (
        <section className="panel source-record-panel">
          <div><h2>Source record</h2><p>{detail.sourceRecordTitle ?? formatRecordType(detail.sourceRecordType)}</p></div>
          <FullRecordLink label="Open source record" recordId={detail.sourceRecordId} recordType={detail.sourceRecordType} />
        </section>
      ) : null}
      <section className="panel">
        <div className="panel-heading"><h2>Audit history</h2><span>{detail.auditHistory.length} entries</span></div>
        {detail.auditHistory.length === 0 ? <div className="empty-row">No audit entries are available for this action.</div> : (
          <ol className="audit-history-list">
            {detail.auditHistory.map((entry) => <li key={entry.id}><strong>{formatRecordType(entry.action)}</strong><span>{entry.summary ?? "No summary"}</span><small>{entry.userDisplayName ?? "System"} - {formatDateTime(entry.createdAt)}</small></li>)}
          </ol>
        )}
      </section>
    </>
  );
}

function DetailGrid({ title, fields }: { title: string; fields: Array<[string, unknown]> }) {
  return (
    <section className="panel">
      <div className="panel-heading"><h2>{title}</h2></div>
      <div className="answer-grid full-record-answer-grid">
        {fields.map(([label, value], index) => <div className="answer-item answer-item-wide" key={`${label}-${index}`}><span>{label}</span><strong className="preserve-lines">{formatUnknown(value)}</strong></div>)}
      </div>
    </section>
  );
}

function RecordMeta({ items }: { items: Array<[string, unknown]> }) {
  return <section className="panel record-meta-panel">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{formatUnknown(value)}</strong></div>)}</section>;
}

function parseRubricValue(value?: string) {
  const [score, label, descriptor, color] = value?.split("::") ?? [];
  return score && label && descriptor ? { score, label, descriptor, color: color || "#0F766E" } : null;
}

function formatValue(value?: string) {
  return parseRubricValue(value)?.label ?? (value || "Not recorded");
}

function formatUnknown(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not recorded";
  if (value === undefined || value === null || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).replaceAll("_", " ");
}

function detailTitle(detail: LoadedDetail | null) {
  if (!detail) return "Record";
  if (detail.kind === "form") return detail.value.title;
  if (detail.kind === "coaching") return `Coaching and Mentoring - session ${detail.value.sessionNumber}`;
  if (detail.kind === "liv") return `LIV - ${detail.value.subjectStaffName}`;
  if (detail.kind === "reflection") return detail.value.title;
  if (detail.kind === "practice") return `Elevate Your Practice - ${detail.value.staffName}`;
  return detail.value.title;
}

function formatRecordType(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function exportDetail(detail: LoadedDetail) {
  const rows = detailToRows(detail);
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${detailTitle(detail).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "record"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function detailToRows(detail: LoadedDetail): string[][] {
  if (detail.kind === "form") return [["Section", "Field", "Value"], ...detail.value.sections.flatMap((section) => section.fields.map((field) => [section.title, field.label, field.value ?? ""]))];
  if (detail.kind === "action") return [["Field", "Value"], ["Title", detail.value.title], ["Description", detail.value.detail ?? ""], ["Owner", detail.value.ownerStaffName ?? ""], ["Due date", detail.value.dueDate ?? ""], ["Status", detail.value.completedDate ? "Complete" : detail.value.statusKey ?? ""], ["Closure", detail.value.completionNote ?? ""]];
  const object = detail.value as unknown as Record<string, unknown>;
  return [["Field", "Value"], ...Object.entries(object).map(([key, value]) => [formatRecordType(key), typeof value === "object" ? JSON.stringify(value) : formatUnknown(value)])];
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
