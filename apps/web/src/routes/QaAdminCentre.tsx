import { useCallback, useEffect, useMemo, useState } from "react";
import { accessibleQaAdminSections, qaAdminPath, resolveQaAdminSectionKey } from "../app/qaAdminNavigation";
import { AdminSettingsLayout } from "../components/AdminSettingsLayout";
import { confirmUnsavedNavigation } from "../components/UnsavedChangesGuard";
import { Button } from "../design-system/Button";
import type { CurrentUser } from "../services/types";
import { AdminManagedLists } from "./AdminManagedLists";
import { AdminCsvImport } from "./AdminCsvImport";
import { DashboardFacultyAdmin } from "./DashboardFacultyAdmin";
import { QaFormAccessAdmin } from "./QaFormAccessAdmin";
import { QaQuestionBankAdmin } from "./QaQuestionBankAdmin";
import { QaRatingLabelsAdmin } from "./QaRatingLabelsAdmin";

const actionThemeKeys = ["action_theme_qa_review"] as const;
const deliveryAreaKeys = ["liv_delivery_area"] as const;

export function QaAdminCentre({ user, initialSection = "overview", onNavigate, canManageReviews = false, canAccessReviews = false }: {
  user: CurrentUser;
  initialSection?: string;
  onNavigate: (path: string) => void | Promise<void>;
  canManageReviews?: boolean;
  canAccessReviews?: boolean;
}) {
  const entries = useMemo(() => accessibleQaAdminSections(user.permissions, user.isAdministrator === true), [user.permissions, user.isAdministrator]);
  const current = resolveQaAdminSectionKey(initialSection);
  const permitted = entries.some(entry => entry.key === current);
  const [busy, setBusy] = useState(false);
  const trackChanges = useCallback((_dirty: boolean, saving = false) => setBusy(saving), []);
  useEffect(() => setBusy(false), [current]);
  const navigate = useCallback(async (path: string) => {
    if (busy || !await confirmUnsavedNavigation()) return;
    await onNavigate(path);
  }, [busy, onNavigate]);
  const selectSection = useCallback(async (key: string) => {
    if (busy || key === current) return;
    await navigate(qaAdminPath(key));
  }, [busy, current, navigate]);

  if (!entries.length) return <section className="access-denied-panel"><div><h1>QA administration unavailable</h1><p>Your account does not have permission to manage QA settings.</p></div></section>;

  return <AdminSettingsLayout
    title="QA Hub administration"
    description="Maintain QA evidence forms, participation, reference choices and reporting. Use a review's Configuration page for its own setup."
    entries={entries}
    activeKey={permitted ? current! : "unavailable"}
    onSelect={selectSection}
    storageKey="qa-admin-navigation"
    busy={busy}
  >
    {!permitted ? <section className="panel" role="alert"><h2>Setting unavailable</h2><p>This setting does not exist or your account does not have permission to change it. Choose one of the available sections.</p><Button onClick={() => void selectSection("overview")}>QA admin home</Button></section> : null}
    {permitted && current === "questions" ? <QaQuestionBankAdmin embedded user={user} onDirtyChange={trackChanges} onImport={() => void selectSection("question-import")} /> : null}
    {permitted && current === "question-import" ? <AdminCsvImport kind="qa-questions" user={user} onDirtyChange={trackChanges} onOpenDestination={navigate} /> : null}
    {permitted && (current === "outcomes" || current === "not-seen") ? <QaRatingLabelsAdmin key={current} user={user} mode={current === "outcomes" ? "labels" : "not-seen"} onDirtyChange={trackChanges} /> : null}
    {permitted && current === "form-access" ? <QaFormAccessAdmin user={user} onDirtyChange={trackChanges} /> : null}
    {permitted && current === "action-themes" ? <AdminManagedLists key={current} lookupKeys={actionThemeKeys} onDirtyChange={trackChanges} /> : null}
    {permitted && current === "delivery-areas" ? <AdminManagedLists key={current} lookupKeys={deliveryAreaKeys} onDirtyChange={trackChanges} /> : null}
    {permitted && current === "dashboard-faculties" ? <DashboardFacultyAdmin dashboardKey="qa_review" onDirtyChange={trackChanges} /> : null}
    {permitted && current === "workflow" ? <section className="panel admin-workflow-guide">
      <div className="panel-heading"><div><h2>Review setup</h2><p>Choose between a shared QA default and the setup of one review.</p></div></div>
      <details open={current === "workflow"}><summary><strong>Shared settings across QA Hub</strong></summary><p>Questions and guidance, outcome wording, Not seen availability, QA Staff form access, action themes, delivery areas and reporting faculty selections have their own pages in this area.</p><p>Question changes apply to future review setups. Outcome wording and form-template access or availability settings can also affect existing evidence displays and further edits; each settings page explains its scope.</p></details>
      <details open><summary><strong>Change one review's owner, dates, activities or teams</strong></summary><ol><li>Open QA Hub, choose the review, then open Configuration.</li><li>For a draft, choose its owner, dates, question sets and activities, then allocate faculties and teams and save.</li><li>Review the setup summary and publish when ready. Published questions stay fixed; use the available configuration and lifecycle controls to update permitted details or allocations.</li><li>Use the review's evidence, dashboard and actions sections to collect evidence and follow up findings. Close, reopen or archive from that review when appropriate.</li></ol><p>A person's QA role, review allocation and template-level form access work together. Selecting someone in form access does not grant a QA role or add them to a review team.</p>
        {canAccessReviews ? <div className="toolbar"><Button disabled={busy} onClick={() => void navigate("/qa-hub/reviews")}>Open QA reviews</Button>{canManageReviews ? <Button disabled={busy} onClick={() => void navigate("/qa-hub/reviews/new")} variant="primary">Set up a new review</Button> : null}</div> : <p className="muted-copy">Review setup and evidence require separate QA review access. Your available administration settings are shown in this directory.</p>}
      </details>
    </section> : null}
  </AdminSettingsLayout>;
}
