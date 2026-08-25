import { Archive, Pencil, Plus, RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { QaActivityTypeSummary, QaQuestionSummary } from "../services/types";

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

export function QaQuestionBankAdmin() {
  const [activities, setActivities] = useState<QaActivityTypeSummary[]>([]);
  const [questions, setQuestions] = useState<QaQuestionSummary[]>([]);
  const [activity, setActivity] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState<QuestionStatusFilter>("active");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<QuestionEditor | null>(null);
  const [workingQuestionId, setWorkingQuestionId] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const editorRef = useRef<HTMLElement | null>(null);

  const loadQuestions = useCallback(async () => {
    try {
      setQuestions(await api.qaQuestions(undefined, true));
      setLoadError("");
    } catch {
      setLoadError("The QA question bank could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void api.qaActivityTypes()
      .then(setActivities)
      .catch(() => setLoadError("QA activities and templates could not be loaded."));
  }, []);

  useEffect(() => { void loadQuestions(); }, [loadQuestions]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return questions.filter((question) => (!activity || question.activityTypeId === activity)
      && (!tag || question.questionTag === tag)
      && (status === "all"
        || status === "active" && question.isActive && question.sourceStatus === "active"
        || status === "draft" && question.sourceStatus === "draft"
        || status === "archived" && isArchived(question))
      && (!normalizedQuery || `${question.themeOrWeek ?? ""} ${question.questionText} ${question.activityName} ${question.questionTag}`.toLowerCase().includes(normalizedQuery)));
  }, [activity, query, questions, status, tag]);

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

  function showEditor(nextEditor: QuestionEditor) {
    setEditor(nextEditor);
    setMessage(null);
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function startNew(activityTypeId = activity || activities[0]?.id || "") {
    setEditor({
      id: "",
      activityTypeId,
      themeOrWeek: "",
      questionText: "",
      guidance: "",
      displayOrder: questions.filter((item) => item.activityTypeId === activityTypeId).length * 10 + 10,
      isRequired: true,
      allowsNotApplicable: false,
      commentRequiredAtExpected: false,
      isActive: true,
      sourceStatus: "active",
      questionTag: tag || "general"
    });
    setMessage(null);
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function startEdit(question: QaQuestionSummary) {
    showEditor({ ...question });
  }

  async function saveQuestion() {
    if (!editor) return;
    setWorkingQuestionId(editor.id || "new");
    const { id, ...request } = editor;
    const result = await api.saveQaQuestion(id || undefined, request);
    setWorkingQuestionId("");
    if (!result.ok) {
      setMessage({ kind: "error", text: result.message ?? "The question could not be saved." });
      return;
    }
    setEditor(null);
    setMessage({ kind: "success", text: id ? "Question updated as a new version. Existing reviews remain unchanged." : "Question added to the bank." });
    await loadQuestions();
  }

  async function setQuestionArchived(question: QaQuestionSummary, archived: boolean) {
    if (archived && !window.confirm(`Archive “${question.questionText}”?\n\nIt will be removed from future review setups but retained in version history and existing reviews.`)) return;
    setWorkingQuestionId(question.id);
    setMessage(null);
    const result = await api.saveQaQuestion(question.id, questionRequest(question, archived));
    setWorkingQuestionId("");
    if (!result.ok) {
      setMessage({ kind: "error", text: result.message ?? `The question could not be ${archived ? "archived" : "restored"}.` });
      return;
    }
    setMessage({ kind: "success", text: archived ? "Question archived. Existing reviews remain unchanged." : "Question restored and available for future reviews." });
    await loadQuestions();
  }

  return (
    <div className="route-stack qa-hub qa-admin-workspace">
      <section className="section-heading qa-admin-heading">
        <div>
          <p className="eyebrow">QA Reviews configuration</p>
          <h1>Question bank</h1>
          <p>Add and maintain criteria within the fixed QA activities. Every change is versioned and only affects future reviews.</p>
        </div>
        <Button disabled={activities.length === 0} icon={Plus} onClick={() => startNew()} variant="primary">Add question</Button>
      </section>

      {message ? <div className={message.kind === "success" ? "success-banner" : "notice-row"} role={message.kind === "success" ? "status" : "alert"}>{message.text}</div> : null}
      {loadError ? <div className="notice-row" role="alert">{loadError}</div> : null}

      {editor ? (
        <section className="panel qa-question-editor" ref={editorRef}>
          <div className="panel-heading"><div><h2>{editor.id ? "Edit question" : "Add question"}</h2><span>{editor.id ? "Saving creates a new version" : "Choose one of the fixed activities for this criterion"}</span></div></div>
          <div className="form-grid">
            <label><span>Activity <strong>Required</strong></span><select disabled={Boolean(editor.id)} onChange={(event) => setEditor({ ...editor, activityTypeId: event.target.value })} value={editor.activityTypeId}>{activities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>The activity is fixed after the question is created.</small></label>
            <label><span>Question tag</span><input list="qa-question-tag-options" onChange={(event) => setEditor({ ...editor, questionTag: event.target.value.trim().toLowerCase() })} placeholder="general" value={editor.questionTag} /><datalist id="qa-question-tag-options">{questionTags.map((questionTag) => <option key={questionTag} value={questionTag} />)}</datalist></label>
            <label><span>Theme or week</span><input onChange={(event) => setEditor({ ...editor, themeOrWeek: event.target.value })} value={editor.themeOrWeek ?? ""} /></label>
            <label className="field-wide"><span>Question <strong>Required</strong></span><textarea autoFocus onChange={(event) => setEditor({ ...editor, questionText: event.target.value })} placeholder="Enter the review criterion" rows={3} value={editor.questionText} /></label>
            <label className="field-wide"><span>Guidance</span><textarea onChange={(event) => setEditor({ ...editor, guidance: event.target.value })} rows={2} value={editor.guidance ?? ""} /></label>
            <label><span>Status</span><select onChange={(event) => setEditor({ ...editor, sourceStatus: event.target.value as QaQuestionSummary["sourceStatus"], isActive: event.target.value === "active" })} value={editor.sourceStatus}><option value="active">Active</option><option value="draft">Draft</option></select><small>Use Archive on the question card to retire a criterion.</small></label>
            <label><span>Display order</span><input min={0} onChange={(event) => setEditor({ ...editor, displayOrder: Number(event.target.value) })} type="number" value={editor.displayOrder} /></label>
            <label className="inline-check"><input checked={editor.isRequired} onChange={(event) => setEditor({ ...editor, isRequired: event.target.checked })} type="checkbox" />Required</label>
            <label className="inline-check"><input checked={editor.allowsNotApplicable} onChange={(event) => setEditor({ ...editor, allowsNotApplicable: event.target.checked })} type="checkbox" />Allow N/A</label>
            <div className="toolbar toolbar-end field-wide"><Button onClick={() => setEditor(null)}>Cancel</Button><Button disabled={!editor.questionText.trim() || Boolean(workingQuestionId)} onClick={() => void saveQuestion()} variant="primary">{workingQuestionId ? "Saving…" : editor.id ? "Save new version" : "Add question"}</Button></div>
          </div>
        </section>
      ) : null}

      <section className="panel qa-question-catalogue">
        <div className="panel-heading"><div><h2>Review criteria</h2><span>The activity processes are fixed; questions can be added, versioned, archived and restored.</span></div><div className="qa-question-catalogue-summary"><strong>{filtered.length} shown</strong><span>{statusCounts.active} active · {statusCounts.draft} draft · {statusCounts.archived} archived</span></div></div>
        <div className="filter-toolbar qa-question-filters">
          <label className="search-box"><Search size={16} aria-hidden="true" /><input aria-label="Search questions" onChange={(event) => setQuery(event.target.value)} placeholder="Search criteria, theme or activity" value={query} /></label>
          <label><span>Activity</span><select aria-label="Activity" onChange={(event) => setActivity(event.target.value)} value={activity}><option value="">All activities</option>{activities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Question tag</span><select aria-label="Question tag" onChange={(event) => setTag(event.target.value)} value={tag}><option value="">All tags</option>{questionTags.map((questionTag) => <option key={questionTag} value={questionTag}>{questionTag === "general" ? "General" : questionTag}</option>)}</select></label>
          <label><span>Status</span><select aria-label="Question status" onChange={(event) => setStatus(event.target.value as QuestionStatusFilter)} value={status}><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option><option value="all">All statuses</option></select></label>
        </div>

        {questionGroups.length === 0 && !loadError ? <p className="empty-state">No questions match these filters.</p> : null}
        <div className="qa-question-groups">
          {questionGroups.map((group, index) => (
            <CollapsibleSection
              className="qa-question-group"
              count={group.questions.length}
              defaultExpanded={index === 0 || Boolean(query || activity)}
              actions={<Button icon={Plus} onClick={() => startNew(group.activity.id)} variant="quiet">Add question</Button>}
              key={group.activity.id}
              persistState={!query && !activity}
              statusSummary={group.activity.description}
              storageKey={`admin-qa-questions-${group.activity.id}`}
              title={group.activity.name}
            >
              {group.questions.length === 0 ? <div className="qa-question-group-empty"><strong>No {status === "all" ? "" : `${status} `}questions</strong><span>Add a question to this fixed activity or change the filters.</span><Button icon={Plus} onClick={() => startNew(group.activity.id)} variant="primary">Add question</Button></div> : (
                <div className="qa-question-bank">
                  {group.questions.map((question) => {
                    const archived = isArchived(question);
                    const busy = workingQuestionId === question.id;
                    return (
                      <article className={archived ? "is-archived" : ""} key={question.id}>
                        <div className="qa-question-card-top">
                          <div className="qa-question-meta"><span className={`status-pill status-${archived ? "archived" : question.sourceStatus}`}>{archived ? "Archived" : question.sourceStatus}</span><span className="qa-question-tag">{question.questionTag === "general" ? "General" : question.questionTag}</span><small>{question.themeOrWeek ?? "General"} · v{question.versionNumber}</small></div>
                          <div className="qa-question-actions">
                            {!archived ? <Button disabled={busy} icon={Pencil} onClick={() => startEdit(question)} variant="quiet">Edit</Button> : null}
                            <Button disabled={busy} icon={archived ? RotateCcw : Archive} onClick={() => void setQuestionArchived(question, !archived)} variant={archived ? "secondary" : "danger"}>{busy ? "Saving…" : archived ? "Restore" : "Archive"}</Button>
                          </div>
                        </div>
                        <strong>{question.questionText}</strong>
                        <span>{question.isRequired ? "Required" : "Optional"}{question.allowsNotApplicable ? " · N/A enabled" : ""}{question.commentRequiredAtExpected ? " · Comment required at expected" : ""}</span>
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
