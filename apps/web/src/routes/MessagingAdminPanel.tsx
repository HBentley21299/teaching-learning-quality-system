import {
  Archive,
  ArchiveRestore,
  Copy,
  Eye,
  History,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  MessageDeliverySummary,
  MessagePreview,
  MessageTemplateSummary,
  MessageTemplateVersionSummary,
  MessagingParameter,
  SaveMessageTemplateRequest
} from "../services/types";

const eventOptions = [
  ["manual", "Manual message"],
  ["action.assigned", "Action assigned"],
  ["action.due_soon", "Action approaching due date"],
  ["action.overdue", "Action overdue"],
  ["action.completed", "Action completed"],
  ["coaching.session_recorded", "Coaching session recorded"],
  ["coaching.action_assigned", "Coaching action assigned"],
  ["form.submitted", "Form submitted"],
  ["record.reopened", "Record reopened"],
  ["record.status_changed", "Record status changed"],
  ["record.reviewer_allocated", "Reviewer allocated"],
  ["report.available", "Report available"],
  ["reflection.window_opened", "Reflection window opened"],
  ["reflection.deadline_approaching", "Reflection deadline approaching"],
  ["cpd.registered", "CPD registration"],
  ["cpd.reminder", "CPD reminder"]
] as const;

const recipientOptions = [
  ["staff", "Staff member"],
  ["action_owner", "Action owner"],
  ["record_creator", "Record creator"],
  ["line_manager", "Line manager"],
  ["reviewer", "Allocated reviewer"]
] as const;

type EditorTarget = "subject" | "plain" | "html";
type EditorState = {
  id?: string;
  messageKey: string;
  name: string;
  internalDescription: string;
  subject: string;
  plainText: string;
  html: string;
  recipients: string[];
  ccRecipients: string[];
  bccRecipients: string[];
  eventType: string;
  recordType: string;
  recordStatus: string;
  facultyCode: string;
  teamCode: string;
  scheduleMode: "immediate" | "relative";
  daysOffset: string;
  isActive: boolean;
};

const emptyEditor: EditorState = {
  messageKey: "",
  name: "",
  internalDescription: "",
  subject: "",
  plainText: "",
  html: "",
  recipients: ["staff"],
  ccRecipients: [],
  bccRecipients: [],
  eventType: "manual",
  recordType: "",
  recordStatus: "",
  facultyCode: "",
  teamCode: "",
  scheduleMode: "immediate",
  daysOffset: "0",
  isActive: false
};

export function MessagingAdminPanel() {
  const [templates, setTemplates] = useState<MessageTemplateSummary[]>([]);
  const [parameters, setParameters] = useState<MessagingParameter[]>([]);
  const [deliveries, setDeliveries] = useState<MessageDeliverySummary[]>([]);
  const [versions, setVersions] = useState<MessageTemplateVersionSummary[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [activeTarget, setActiveTarget] = useState<EditorTarget>("plain");
  const [preview, setPreview] = useState<MessagePreview | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

  const groupedParameters = useMemo(() => {
    const groups = new Map<string, MessagingParameter[]>();
    parameters.forEach((parameter) => groups.set(parameter.category, [...(groups.get(parameter.category) ?? []), parameter]));
    return [...groups.entries()];
  }, [parameters]);

  useEffect(() => {
    void loadTemplates();
  }, [showDeleted]);

  useEffect(() => {
    void api.messagingParameters().then(setParameters).catch(() => setError("Approved message parameters could not be loaded."));
  }, []);

  async function loadTemplates() {
    setLoading(true);
    setError("");
    try {
      setTemplates(await api.messageTemplates(showDeleted));
    } catch {
      setError("Message templates could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    if (historyLoaded) return;
    try {
      setDeliveries(await api.messageDeliveries());
      setHistoryLoaded(true);
    } catch {
      setError("Delivery history could not be loaded.");
    }
  }

  async function editTemplate(template: MessageTemplateSummary) {
    setEditor(toEditor(template));
    setPreview(null);
    setMessage("");
    try {
      setVersions(await api.messageTemplateVersions(template.id));
    } catch {
      setVersions([]);
    }
  }

  function startNew() {
    setEditor({ ...emptyEditor, recipients: [...emptyEditor.recipients] });
    setVersions([]);
    setPreview(null);
    setMessage("");
  }

  async function saveTemplate() {
    if (!editor) return;
    setSaving(true);
    setError("");
    const request = toRequest(editor);
    const result = editor.id
      ? await api.updateMessageTemplate(editor.id, request)
      : await api.createMessageTemplate(request);
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "The message template could not be saved.");
      return;
    }
    setMessage(editor.id ? "A new template version has been saved." : "Message template created.");
    setEditor(null);
    await loadTemplates();
  }

  async function renderPreview() {
    if (!editor) return;
    const result = await api.previewMessageTemplate(toRequest(editor));
    if (!result.ok || !result.data) {
      setError(result.message ?? "The preview could not be generated.");
      return;
    }
    setPreview(result.data);
    setError("");
  }

  async function sendTest() {
    if (!editor?.id) {
      setError("Save the template before sending a test message.");
      return;
    }
    const result = await api.sendTestMessage(editor.id, testEmail);
    if (!result.ok) {
      setError(result.message ?? "The test message could not be queued.");
      return;
    }
    setMessage("Test message queued. Delivery remains pending while production messaging is disabled.");
    setHistoryLoaded(false);
  }

  async function duplicateTemplate(template: MessageTemplateSummary) {
    const suffix = Date.now().toString().slice(-6);
    const result = await api.duplicateMessageTemplate(template.id, `${template.messageKey}.copy-${suffix}`, `${template.name} copy`);
    if (!result.ok) setError(result.message ?? "The template could not be duplicated.");
    else {
      setMessage("Template duplicated as an inactive copy.");
      await loadTemplates();
    }
  }

  async function changeStatus(template: MessageTemplateSummary) {
    const activating = !template.isActive || template.isDeleted;
    const reason = window.prompt(activating ? "Reason for activating or restoring this template" : "Reason for deactivating this template");
    if (!reason) return;
    const result = await api.setMessageTemplateStatus(template.id, activating, template.isDeleted, reason);
    if (!result.ok) setError(result.message ?? "The template status could not be changed.");
    else await loadTemplates();
  }

  async function deleteTemplate(template: MessageTemplateSummary) {
    const reason = window.prompt("Reason for deleting this message template");
    if (!reason) return;
    const result = await api.deleteMessageTemplate(template.id, reason);
    if (!result.ok) setError(result.message ?? "The template could not be deleted.");
    else {
      setMessage("Template moved to deleted records.");
      await loadTemplates();
    }
  }

  async function retryDelivery(delivery: MessageDeliverySummary) {
    const reason = window.prompt("Reason for retrying this delivery");
    if (!reason) return;
    const result = await api.retryMessageDelivery(delivery.id, reason);
    if (!result.ok) setError(result.message ?? "The delivery could not be retried.");
    else {
      setDeliveries(await api.messageDeliveries());
      setMessage("Delivery returned to the queue.");
    }
  }

  function insertParameter(key: string) {
    if (!editor) return;
    const placeholder = `{{${key}}}`;
    setEditor({
      ...editor,
      subject: activeTarget === "subject" ? `${editor.subject}${placeholder}` : editor.subject,
      plainText: activeTarget === "plain" ? `${editor.plainText}${placeholder}` : editor.plainText,
      html: activeTarget === "html" ? `${editor.html}${placeholder}` : editor.html
    });
  }

  return (
    <div className="route-stack messaging-admin">
      <section className="panel">
        <div className="panel-heading messaging-heading">
          <div><h2>Messages</h2><span>Versioned templates and delivery rules</span></div>
          <div className="inline-actions">
            <label className="compact-checkbox"><input checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} type="checkbox" />Show deleted</label>
            <Button icon={Plus} onClick={startNew} variant="primary">Add message</Button>
          </div>
        </div>
        {message ? <div className="notice-row" role="status">{message}</div> : null}
        {error ? <div className="section-state section-state-error" role="alert">{error}</div> : null}
        {loading ? <div className="section-state">Loading message templates...</div> : null}
        {!loading && templates.length === 0 ? <div className="section-state">No message templates have been configured.</div> : null}
        <div className="message-template-list">
          {templates.map((template) => (
            <article className={template.isDeleted ? "message-template-row is-deleted" : "message-template-row"} key={template.id}>
              <div>
                <div className="message-title-line">
                  <strong>{template.name}</strong>
                  <span className={`status-badge status-${template.isDeleted ? "cancelled" : template.isActive ? "complete" : "draft"}`}>
                    {template.isDeleted ? "Deleted" : template.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <span>{template.messageKey} · version {template.versionNumber} · {eventLabel(template.eventType)}</span>
                <small>{template.pendingCount} queued · {template.sentCount} sent · {template.failedCount} failed</small>
              </div>
              <div className="icon-action-row">
                <button aria-label={`Edit ${template.name}`} onClick={() => void editTemplate(template)} title="Edit template" type="button"><Pencil size={17} /></button>
                <button aria-label={`Duplicate ${template.name}`} onClick={() => void duplicateTemplate(template)} title="Duplicate template" type="button"><Copy size={17} /></button>
                <button aria-label={`${template.isActive ? "Deactivate" : "Activate"} ${template.name}`} onClick={() => void changeStatus(template)} title={template.isDeleted ? "Restore template" : template.isActive ? "Deactivate template" : "Activate template"} type="button">
                  {template.isDeleted ? <ArchiveRestore size={17} /> : template.isActive ? <X size={17} /> : <RefreshCw size={17} />}
                </button>
                {!template.isDeleted ? <button aria-label={`Delete ${template.name}`} onClick={() => void deleteTemplate(template)} title="Delete template" type="button"><Archive size={17} /></button> : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      {editor ? (
        <>
        <section className="panel message-editor">
          <div className="panel-heading">
            <div><h2>{editor.id ? "Edit message" : "Add message"}</h2><span>{editor.id ? "Saving creates a new immutable version" : "Inactive until you choose to activate it"}</span></div>
            <button aria-label="Close message editor" className="icon-button" onClick={() => setEditor(null)} title="Close editor" type="button"><X size={18} /></button>
          </div>

          <div className="entry-field-grid message-editor-basics">
            <label className="entry-field"><span>Message name</span><input onChange={(event) => setEditor({ ...editor, name: event.target.value })} value={editor.name} /></label>
            <label className="entry-field"><span>Message key</span><input onChange={(event) => setEditor({ ...editor, messageKey: event.target.value })} placeholder="action.due_reminder" value={editor.messageKey} /></label>
            <label className="entry-field entry-field-wide"><span>Internal description</span><input onChange={(event) => setEditor({ ...editor, internalDescription: event.target.value })} value={editor.internalDescription} /></label>
          </div>

          <div className="message-config-grid">
            <fieldset className="message-config-group">
              <legend>Recipients</legend>
              <RecipientChecklist label="To" selected={editor.recipients} onChange={(recipients) => setEditor({ ...editor, recipients })} />
              <RecipientChecklist label="CC" selected={editor.ccRecipients} onChange={(ccRecipients) => setEditor({ ...editor, ccRecipients })} />
              <RecipientChecklist label="BCC" selected={editor.bccRecipients} onChange={(bccRecipients) => setEditor({ ...editor, bccRecipients })} />
            </fieldset>
            <fieldset className="message-config-group">
              <legend>Trigger</legend>
              <label className="entry-field"><span>Application event</span><select onChange={(event) => setEditor({ ...editor, eventType: event.target.value })} value={editor.eventType}>{eventOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <div className="two-column-compact">
                <label className="entry-field"><span>Record type</span><input onChange={(event) => setEditor({ ...editor, recordType: event.target.value })} placeholder="Optional" value={editor.recordType} /></label>
                <label className="entry-field"><span>Record status</span><input onChange={(event) => setEditor({ ...editor, recordStatus: event.target.value })} placeholder="Optional" value={editor.recordStatus} /></label>
                <label className="entry-field"><span>Faculty code</span><input onChange={(event) => setEditor({ ...editor, facultyCode: event.target.value })} placeholder="Optional" value={editor.facultyCode} /></label>
                <label className="entry-field"><span>Sub-team code</span><input onChange={(event) => setEditor({ ...editor, teamCode: event.target.value })} placeholder="Optional" value={editor.teamCode} /></label>
              </div>
            </fieldset>
            <fieldset className="message-config-group">
              <legend>Timing</legend>
              <div className="segmented-control" role="group" aria-label="Message timing">
                <button aria-pressed={editor.scheduleMode === "immediate"} onClick={() => setEditor({ ...editor, scheduleMode: "immediate" })} type="button">Immediate</button>
                <button aria-pressed={editor.scheduleMode === "relative"} onClick={() => setEditor({ ...editor, scheduleMode: "relative" })} type="button">Relative to date</button>
              </div>
              {editor.scheduleMode === "relative" ? <label className="entry-field"><span>Days before (-) or after (+)</span><input max={365} min={-365} onChange={(event) => setEditor({ ...editor, daysOffset: event.target.value })} type="number" value={editor.daysOffset} /></label> : null}
            </fieldset>
          </div>

          <div className="message-composer-grid">
            <div className="message-body-fields">
              <label className="entry-field"><span>Subject</span><input onChange={(event) => setEditor({ ...editor, subject: event.target.value })} onFocus={() => setActiveTarget("subject")} value={editor.subject} /></label>
              <label className="entry-field"><span>Plain-text message</span><textarea onChange={(event) => setEditor({ ...editor, plainText: event.target.value })} onFocus={() => setActiveTarget("plain")} rows={8} value={editor.plainText} /></label>
              <label className="entry-field"><span>HTML message <small>Optional; unsafe markup is removed</small></span><textarea onChange={(event) => setEditor({ ...editor, html: event.target.value })} onFocus={() => setActiveTarget("html")} rows={6} value={editor.html} /></label>
            </div>
            <aside className="parameter-picker" aria-label="Approved message parameters">
              <strong>Insert parameter</strong>
              <span>Inserts into the last selected message field.</span>
              {groupedParameters.map(([category, items]) => (
                <div key={category}><small>{category}</small>{items.map((parameter) => <button key={parameter.key} onClick={() => insertParameter(parameter.key)} title={parameter.sampleValue} type="button">{parameter.label}</button>)}</div>
              ))}
            </aside>
          </div>

          <div className="message-editor-actions">
            <label className="compact-checkbox"><input checked={editor.isActive} onChange={(event) => setEditor({ ...editor, isActive: event.target.checked })} type="checkbox" />Active after save</label>
            <div className="inline-actions">
              <Button icon={Eye} onClick={() => void renderPreview()}>Preview</Button>
              <Button disabled={saving} icon={Save} onClick={() => void saveTemplate()} variant="primary">{saving ? "Saving..." : "Save template"}</Button>
            </div>
          </div>

          {preview ? <div className="message-preview"><div><Mail size={18} /><strong>{preview.subject}</strong></div>{preview.htmlBody ? <div className="message-preview-body" dangerouslySetInnerHTML={{ __html: preview.htmlBody }} /> : <p>{preview.plainTextBody}</p>}<small>{preview.recipients.join(" · ")}</small></div> : null}

          {editor.id ? <div className="message-test-row"><label className="entry-field"><span>Test recipient</span><input onChange={(event) => setTestEmail(event.target.value)} placeholder="name@example.ac.uk" type="email" value={testEmail} /></label><Button icon={Send} onClick={() => void sendTest()}>Queue test</Button></div> : null}

        </section>
        {versions.length > 0 ? <CollapsibleSection count={versions.length} isEmpty={false} storageKey={`message-versions-${editor.id}`} title="Template versions"><div className="version-list">{versions.map((version) => <div key={version.id}><strong>Version {version.versionNumber}</strong><span>{new Date(version.createdAt).toLocaleString()} · {version.createdBy ?? "System"}</span><small>{version.subjectTemplate}</small></div>)}</div></CollapsibleSection> : null}
        </>
      ) : null}

      <CollapsibleSection
        count={deliveries.length}
        emptyMessage="No messages have been queued."
        isEmpty={historyLoaded && deliveries.length === 0}
        isLoading={!historyLoaded}
        onExpandedChange={(expanded) => { if (expanded) void loadHistory(); }}
        statusSummary={historyLoaded ? deliverySummary(deliveries) : "Load on opening"}
        storageKey="admin-message-deliveries"
        title="Delivery history"
      >
        <div className="delivery-list">
          {deliveries.map((delivery) => (
            <div key={delivery.id}>
              <span className={`status-badge status-${delivery.status}`}>{delivery.status}</span>
              <div><strong>{delivery.templateName}</strong><span>{delivery.recipients}</span><small>{new Date(delivery.queuedAt).toLocaleString()} · attempt {delivery.attemptCount}</small>{delivery.lastError ? <small className="error-copy">{delivery.lastError}</small> : null}</div>
              {delivery.status === "failed" || delivery.status === "cancelled" ? <button aria-label="Retry delivery" onClick={() => void retryDelivery(delivery)} title="Retry delivery" type="button"><RotateCcw size={17} /></button> : <History aria-hidden="true" size={17} />}
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
}

function RecipientChecklist({ label, selected, onChange }: { label: string; selected: string[]; onChange: (values: string[]) => void }) {
  return <div className="recipient-checklist"><strong>{label}</strong>{recipientOptions.map(([value, text]) => <label key={value}><input checked={selected.includes(value)} onChange={() => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])} type="checkbox" />{text}</label>)}</div>;
}

function toRequest(editor: EditorState): SaveMessageTemplateRequest {
  const conditions = Object.fromEntries(Object.entries({
    recordType: editor.recordType.trim(),
    recordStatus: editor.recordStatus.trim(),
    facultyCode: editor.facultyCode.trim(),
    teamCode: editor.teamCode.trim()
  }).filter(([, value]) => value));
  return {
    messageKey: editor.messageKey,
    name: editor.name,
    internalDescription: editor.internalDescription || undefined,
    subjectTemplate: editor.subject,
    plainTextTemplate: editor.plainText,
    htmlTemplate: editor.html || undefined,
    recipientConfigJson: JSON.stringify({ to: editor.recipients, cc: editor.ccRecipients, bcc: editor.bccRecipients }),
    eventType: editor.eventType,
    conditionConfigJson: JSON.stringify(conditions),
    scheduleConfigJson: JSON.stringify(editor.scheduleMode === "immediate" ? { mode: "immediate" } : { mode: "relative", daysOffset: Number(editor.daysOffset || 0) }),
    isActive: editor.isActive,
    attachments: []
  };
}

function toEditor(template: MessageTemplateSummary): EditorState {
  const recipients = parseObject(template.recipientConfigJson);
  const conditions = parseObject(template.conditionConfigJson);
  const schedule = parseObject(template.scheduleConfigJson);
  return {
    ...emptyEditor,
    id: template.id,
    messageKey: template.messageKey,
    name: template.name,
    internalDescription: template.internalDescription ?? "",
    subject: template.subjectTemplate,
    plainText: template.plainTextTemplate,
    html: template.htmlTemplate ?? "",
    recipients: stringArray(recipients.to),
    ccRecipients: stringArray(recipients.cc),
    bccRecipients: stringArray(recipients.bcc),
    eventType: template.eventType,
    recordType: textValue(conditions.recordType),
    recordStatus: textValue(conditions.recordStatus),
    facultyCode: textValue(conditions.facultyCode),
    teamCode: textValue(conditions.teamCode),
    scheduleMode: schedule.mode === "relative" ? "relative" : "immediate",
    daysOffset: String(typeof schedule.daysOffset === "number" ? schedule.daysOffset : 0),
    isActive: template.isActive
  };
}

function parseObject(value: string): Record<string, unknown> {
  try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function textValue(value: unknown) { return typeof value === "string" ? value : ""; }
function eventLabel(value: string) { return eventOptions.find(([key]) => key === value)?.[1] ?? value; }
function deliverySummary(items: MessageDeliverySummary[]) { return `${items.filter((item) => item.status === "sent").length} sent · ${items.filter((item) => item.status === "failed").length} failed · ${items.filter((item) => ["pending", "processing", "retrying"].includes(item.status)).length} queued`; }
