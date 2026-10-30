import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { Archive, Copy, Pencil, Plus, RotateCcw, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { Button } from "../design-system/Button";
import { LoadingState } from "../components/LoadingState";
import { api } from "../services/api";
import type { CurrentUser, QaActivityTypeSummary, QaQuestionSummary } from "../services/types";
import { canUseAdminCsvImport } from "../services/csvImportPresentation";
import { AdminListSort } from "../components/AdminListSort";
import { matchesListSearch, sortListRows } from "../services/listQuery";
import { WorkflowFilters } from "../components/WorkflowFilters";

type QuestionEditor = Omit<QaQuestionSummary, "activityKey" | "activityName" | "versionNumber" | "createdAt">;
type QuestionStatusFilter = "active" | "draft" | "archived" | "all";

function isArchived(question: QaQuestionSummary) {
  return question.sourceStatus === "inactive";
}

function questionRequest(question: QaQuestionSummary, archived: boolean) {
  return {
    activityTypeId: question.activityTypeId,
    themeOrWeek: question.themeOrWeek,
    questionText: question.questionText,
    guidance: question.guidance,
    displayOrder: question.displayOrder,
    isRequired: question.isRequired,
    allowsNotApplicable: question.allowsNotApplicable,
    commentRequiredAtExpected: question.commentRequiredAtExpected,
    isActive: !archived,
    sourceStatus: archived ? "inactive" as const : "active" as const,
    questionTag: question.questionTag
  };
}

export function QaQuestionBankAdmin({ user, onImport, onDirtyChange, embedded = false }: { user?: CurrentUser; onImport?: () => void; onDirtyChange?: (dirty: boolean, saving?: boolean) => void; embedded?: boolean }) {
  const [activities, setActivities] = useState<QaActivityTypeSummary[]>([]);
  const [questions, setQuestions] = useState<QaQuestionSummary[]>([]);
  const [activity, setActivity] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState<QuestionStatusFilter>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("configured");
  const [requiredFilter, setRequiredFilter] = useState("");
  const [editor, setEditor] = useState<QuestionEditor | null>(null);
  const [editorBaseline, setEditorBaseline] = useState("");
  const [workingQuestionId, setWorkingQuestionId] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);
  const mutationInFlight = useRef(false);
  const dirty = Boolean(editor && JSON.stringify(editor) !== editorBaseline);
  const clearGuard = useUnsavedChanges({ label: "QA question wording", dirty, saving: Boolean(workingQuestionId), onSave: saveQuestion, onDiscard: () => { setEditor(null); clearGuard(); } });
  useEffect(() => { onDirtyChange?.(dirty, Boolean(workingQuestionId)); }, [dirty, workingQuestionId, onDirtyChange]);
  const editorRef = useRef<HTMLElement | null>(null);

  const loadQuestions = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setLoadError("");
    try {
      const [nextActivities, nextQuestions] = await Promise.all([api.qaActivityTypes(), api.qaQuestions(undefined, true)]);
      if (sequence !== loadSequence.current) return;
      setActivities(nextActivities); setQuestions(nextQuestions);
    } catch {
      if (sequence === loadSequence.current) setLoadError("The QA question bank could not be loaded. Check your connection and try again.");
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);

  useEffect(() => { void loadQuestions(); return () => { ++loadSequence.current; }; }, [loadQuestions]);

  const filtered = useMemo(() => {
    return sortListRows(questions.filter((question) => (!activity || question.activityTypeId === activity)
      && (!tag || question.questionTag === tag)
      && (status === "all"
        || status === "active" && question.isActive && question.sourceStatus === "active"
        || status === "draft" && question.sourceStatus === "draft"
        || status === "archived" && isArchived(question))
      && (!requiredFilter || question.isRequired === (requiredFilter === "required"))
      && matchesListSearch(query, question.themeOrWeek, question.questionText, question.guidance, question.activityName, question.activityKey, question.questionTag, question.sourceStatus)),
      question => sort === "configured" ? question.displayOrder : sort.startsWith("tag") ? question.questionTag : sort.startsWith("version") ? question.versionNumber : question.questionText,
      sort.endsWith("desc") ? "desc" : "asc", question => question.id);
  }, [activity, query, questions, status, tag, sort, requiredFilter]);

  const statusCounts = useMemo(() => ({
    active: questions.filter((question) => question.isActive && question.sourceStatus === "active").length,
    archived: questions.filter(isArchived).length,
    draft: questions.filter((question) => question.sourceStatus === "draft").length
  }), [questions]);

  const questionTags = useMemo(() => Array.from(new Set(["general", ...questions.map((question) => question.questionTag)]))
    .filter(Boolean).sort((left, right) => left === "general" ? -1 : right === "general" ? 1 : left.localeCompare(right)), [questions]);

  const questionGroups = useMemo(() => activities
    .map((item) => ({ activity: item, questions: filtered.filter((question) => question.activityTypeId === item.id) }))
    .filter((group) => group.questions.length > 0
      || (!query.trim() && !tag && (!activity || activity === group.activity.id))), [activities, activity, filtered, query, tag]);

  async function showEditor(nextEditor: QuestionEditor, copied = false) {
    if (mutationInFlight.current || !await confirmUnsavedNavigation()) return;
    if (mutationInFlight.current) return;
    setEditor(nextEditor); setEditorBaseline(copied ? "" : JSON.stringify(nextEditor));
    setMessage(copied ? { kind: "success", text: "Copied into a new draft. Review the activity, wording and options, then save to add it to the question bank." } : null);
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function startNew(activityTypeId = activity || activities[0]?.id || "") {
    if (mutationInFlight.current || editor) return;
    const nextEditor: QuestionEditor = {
      id: "",
      activityTypeId,
      themeOrWeek: "",
      questionText: "",
      guidance: "",
      displayOrder: nextDisplayOrder(activityTypeId),
      isRequired: true,
      allowsNotApplicable: false,
      commentRequiredAtExpected: false,
      isActive: true,
      sourceStatus: "active",
      questionTag: tag || "general"
    };
    setEditor(nextEditor); setEditorBaseline(JSON.stringify(nextEditor));
    setMessage(null);
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function startEdit(question: QaQuestionSummary) {
    void showEditor({ ...question });
  }

  function nextDisplayOrder(activityTypeId: string) {
    return Math.min(2147483647, Math.max(0, ...questions.filter(item => item.activityTypeId === activityTypeId).map(item => item.displayOrder)) + 10);
  }

  function copyQuestion(question: QaQuestionSummary) {
    void showEditor({ ...questionRequest(question, false), id: "", displayOrder: nextDisplayOrder(question.activityTypeId),
      sourceStatus: "draft", isActive: false }, true);
  }

  async function saveQuestion() {
    if (!editor || workingQuestionId || mutationInFlight.current) return false;
    if (!editor.activityTypeId || !editor.questionText.trim()) {
      setMessage({ kind: "error", text: "Choose an activity and enter the question before saving." }); return false;
    }
    if (!Number.isInteger(editor.displayOrder) || editor.displayOrder < 0 || editor.displayOrder > 2147483647) {
      setMessage({ kind: "error", text: "Enter a whole-number display order from 0 to 2,147,483,647." }); return false;
    }
    mutationInFlight.current = true;
    setWorkingQuestionId(editor.id || "new");
    try {
      const { id, ...request } = editor;
      const result = await api.saveQaQuestion(id || undefined, request);
      if (!result.ok) { setMessage({ kind: "error", text: result.message ?? "The question could not be saved." }); return false; }
      setEditor(null);
      setMessage({ kind: "success", text: id ? "Question updated as a new version. Existing reviews remain unchanged." : editor.sourceStatus === "draft" ? "Draft question added. Find it under Draft or All statuses when you are ready to make it active." : "Question added to the bank." });
      await loadQuestions();
      clearGuard(); return true;
    } catch {
      setMessage({ kind: "error", text: "The question could not be saved. Your changes are still here; try again." }); return false;
    } finally { mutationInFlight.current = false; setWorkingQuestionId(""); }
  }

  async function cancelEditor() {
    if (workingQuestionId || !await confirmUnsavedNavigation()) return;
    setEditor(null); clearGuard();
  }

  async function setQuestionArchived(question: QaQuestionSummary, archived: boolean) {
    if (mutationInFlight.current || editor) return;
    if (archived && !window.confirm(`Archive “${question.questionText}”?\n\nIt will be removed from future review setups but retained in version history and existing reviews.`)) return;
    mutationInFlight.current = true;
    setWorkingQuestionId(question.id);
    setMessage(null);
    try {
      const result = await api.saveQaQuestion(question.id, questionRequest(question, archived));
      if (!result.ok) { setMessage({ kind: "error", text: result.message ?? `The question could not be ${archived ? "archived" : "restored"}.` }); return; }
      setMessage({ kind: "success", text: archived ? "Question archived. Existing reviews remain unchanged." : "Question restored and available for future reviews." });
      await loadQuestions();
    } catch { setMessage({ kind: "error", text: "The question could not be changed. Try again." }); }
    finally { mutationInFlight.current = false; setWorkingQuestionId(""); }
  }

  return (
    <div className="route-stack qa-hub qa-admin-workspace">
      <section className="section-heading qa-admin-heading" aria-label="Question bank actions">
        {!embedded ? <div>
          <p className="eyebrow">QA Reviews configuration</p>
          <h2>Questions & guidance</h2>
          <p>Add and maintain criteria within the fixed QA activities. Every change is versioned and only affects future reviews.</p>
        </div> : <span />}
        <div className="toolbar">{onImport && canUseAdminCsvImport(user, "qa-questions") ? <Button icon={Upload} disabled={Boolean(workingQuestionId)} onClick={onImport}>Import CSV</Button> : null}<Button disabled={loading || activities.length === 0 || Boolean(editor) || Boolean(workingQuestionId)} icon={Plus} onClick={() => startNew()} variant="primary">Add question</Button></div>
      </section>

      {message ? <div className={message.kind === "success" ? "success-banner" : "notice-row"} role={message.kind === "success" ? "status" : "alert"}>{message.text}</div> : null}
      {loadError ? <div className="notice-row" role="alert">{loadError}<Button disabled={loading || Boolean(workingQuestionId)} onClick={() => void loadQuestions()}>Try again</Button></div> : null}
      {loading ? <LoadingState label="Loading QA questions" /> : null}

      {editor ? (
        <section className="panel qa-question-editor" ref={editorRef}>
          <div className="panel-heading"><div><h2>{editor.id ? "Edit question" : "Add question"}</h2><span>{editor.id ? "Saving creates a new version" : "Choose one of the fixed activities for this criterion"}</span></div></div>
          <fieldset disabled={Boolean(workingQuestionId)} className="form-grid qa-question-fields">
            <label><span>Activity <strong>Required</strong></span><select disabled={Boolean(editor.id)} onChange={(event) => setEditor({ ...editor, activityTypeId: event.target.value })} value={editor.activityTypeId}>{activities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>The activity is fixed after the question is created.</small></label>
            <label><span>Question tag</span><input maxLength={80} list="qa-question-tag-options" onChange={(event) => setEditor({ ...editor, questionTag: event.target.value.trim().toLowerCase() })} placeholder="general" value={editor.questionTag} /><datalist id="qa-question-tag-options">{questionTags.map((questionTag) => <option key={questionTag} value={questionTag} />)}</datalist></label>
            <label><span>Theme or week</span><input maxLength={200} onChange={(event) => setEditor({ ...editor, themeOrWeek: event.target.value })} value={editor.themeOrWeek ?? ""} /></label>
            <label className="field-wide"><span>Question <strong>Required</strong></span><textarea maxLength={1000} autoFocus onChange={(event) => setEditor({ ...editor, questionText: event.target.value })} placeholder="Enter the review criterion" rows={3} value={editor.questionText} /></label>
            <label className="field-wide"><span>Guidance</span><textarea maxLength={2000} onChange={(event) => setEditor({ ...editor, guidance: event.target.value })} rows={2} value={editor.guidance ?? ""} /></label>
            <label><span>Status</span><select onChange={(event) => setEditor({ ...editor, sourceStatus: event.target.value as QaQuestionSummary["sourceStatus"], isActive: event.target.value === "active" })} value={editor.sourceStatus}><option value="active">Active</option><option value="draft">Draft</option></select><small>Use Archive on the question card to retire a criterion.</small></label>
            <label><span>Display order</span><input min={0} max={2147483647} step={1} onChange={(event) => setEditor({ ...editor, displayOrder: Number(event.target.value) })} type="number" value={editor.displayOrder} /></label>
            <label className="inline-check"><input checked={editor.isRequired} onChange={(event) => setEditor({ ...editor, isRequired: event.target.checked })} type="checkbox" />Required</label>
            <label className="inline-check"><input checked={editor.allowsNotApplicable} onChange={(event) => setEditor({ ...editor, allowsNotApplicable: event.target.checked })} type="checkbox" />Allow N/A</label>
            <p className="muted-copy field-wide">Evidence notes are optional for every outcome. An N/A answer requires a reason when N/A is enabled.</p>
            <div className="toolbar toolbar-end field-wide"><Button disabled={Boolean(workingQuestionId)} onClick={() => void cancelEditor()}>Cancel</Button><Button disabled={!editor.questionText.trim() || Boolean(workingQuestionId)} onClick={() => void saveQuestion()} variant="primary">{workingQuestionId ? "Saving…" : editor.id ? "Save new version" : "Add question"}</Button></div>
          </fieldset>
        </section>
      ) : null}

      <section className="panel qa-question-catalogue">
        <div className="panel-heading"><div><h2>Review criteria</h2><span>The activity processes are fixed; questions can be added, versioned, archived and restored.</span></div><div className="qa-question-catalogue-summary"><strong>{filtered.length} shown</strong><span>{statusCounts.active} active · {statusCounts.draft} draft · {statusCounts.archived} archived</span></div></div>
        <WorkflowFilters activeCount={[activity, tag, requiredFilter].filter(Boolean).length + Number(status !== "active")} hasQuery={Boolean(query)} onClear={() => { setActivity(""); setTag(""); setRequiredFilter(""); setStatus("active"); setQuery(""); }} primary={<>
          <label className="search-box"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search questions" onChange={(event) => setQuery(event.target.value)} placeholder="Search criteria, theme or activity" value={query} /></label>
          <AdminListSort value={sort} onChange={setSort} options={[["configured","Configured question order"],["question-asc","Question: A–Z"],["question-desc","Question: Z–A"],["tag-asc","Tag: A–Z"],["version-desc","Version: highest first"]]} />
        </>}>
          <label><span>Requirement</span><select value={requiredFilter} onChange={event => setRequiredFilter(event.target.value)}><option value="">All questions</option><option value="required">Required</option><option value="optional">Optional</option></select></label>
          <label><span>Activity</span><select aria-label="Activity" onChange={(event) => setActivity(event.target.value)} value={activity}><option value="">All activities</option>{activities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Question tag</span><select aria-label="Question tag" onChange={(event) => setTag(event.target.value)} value={tag}><option value="">All tags</option>{questionTags.map((questionTag) => <option key={questionTag} value={questionTag}>{questionTag === "general" ? "General" : questionTag}</option>)}</select></label>
          <label><span>Status</span><select aria-label="Question status" onChange={(event) => setStatus(event.target.value as QuestionStatusFilter)} value={status}><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option><option value="all">All statuses</option></select></label>
        </WorkflowFilters>

        {questionGroups.length === 0 && !loadError ? <p className="empty-state">No questions match these filters.</p> : null}
        <div className="qa-question-groups">
          {questionGroups.map((group, index) => (
            <CollapsibleSection
              className="qa-question-group"
              count={group.questions.length}
              defaultExpanded={index === 0 || Boolean(query || activity)}
              actions={<Button disabled={Boolean(editor) || Boolean(workingQuestionId)} icon={Plus} onClick={() => startNew(group.activity.id)} variant="quiet">Add question</Button>}
              key={group.activity.id}
              persistState={!query && !activity}
              statusSummary={group.activity.description}
              storageKey={`admin-qa-questions-${group.activity.id}`}
              title={group.activity.name}
            >
              {group.questions.length === 0 ? <div className="qa-question-group-empty"><strong>No {status === "all" ? "" : `${status} `}questions</strong><span>Add a question to this fixed activity or change the filters.</span><Button disabled={Boolean(editor) || Boolean(workingQuestionId)} icon={Plus} onClick={() => startNew(group.activity.id)} variant="primary">Add question</Button></div> : (
                <div className="qa-question-bank">
                  {group.questions.map((question) => {
                    const archived = isArchived(question);
                    const busy = workingQuestionId === question.id;
                    return (
                      <article className={archived ? "is-archived" : ""} key={question.id}>
                        <div className="qa-question-card-top">
                          <div className="qa-question-meta"><span className={`status-pill status-${archived ? "archived" : question.sourceStatus}`}>{archived ? "Archived" : question.sourceStatus}</span><span className="qa-question-tag">{question.questionTag === "general" ? "General" : question.questionTag}</span><small>{question.themeOrWeek ?? "General"} · v{question.versionNumber}</small></div>
                          <div className="qa-question-actions">
                            {!archived ? <Button disabled={Boolean(workingQuestionId) || Boolean(editor)} icon={Pencil} onClick={() => startEdit(question)} variant="quiet">Edit</Button> : null}
                            <Button disabled={Boolean(workingQuestionId) || Boolean(editor)} icon={Copy} onClick={() => copyQuestion(question)} variant="quiet">Copy question</Button>
                            <Button disabled={Boolean(workingQuestionId) || Boolean(editor)} icon={archived ? RotateCcw : Archive} onClick={() => void setQuestionArchived(question, !archived)} variant={archived ? "secondary" : "danger"}>{busy ? "Saving…" : archived ? "Restore" : "Archive"}</Button>
                          </div>
                        </div>
                        <strong>{question.questionText}</strong>
                        <span>{question.isRequired ? "Required outcome" : "Optional outcome"}{question.allowsNotApplicable ? " · N/A enabled" : ""} · Evidence notes optional</span>
                      </article>
                    );
                  })}
                </div>
              )}
            </CollapsibleSection>
          ))}
        </div>
      </section>
    </div>
  );
}
