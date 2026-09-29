import { confirmUnsavedNavigation } from "../components/UnsavedChangesGuard";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { availableFormFamilies } from "../app/formEditorNavigation";
import { legacyFormLocations } from "../app/adminNavigation";
import type { CurrentUser } from "../services/types";
import { FormBuilder } from "./FormBuilder";
import { AdminManagedLists } from "./AdminManagedLists";
import { QaQuestionBankAdmin } from "./QaQuestionBankAdmin";
import { QaRatingLabelsAdmin } from "./QaRatingLabelsAdmin";
import { QaFormAccessAdmin } from "./QaFormAccessAdmin";

export function FormEditor({ user, initialLocation = "forms", onDirtyChange, renderSettings }: {
  user: CurrentUser;
  initialLocation?: string;
  onDirtyChange?: (dirty: boolean, saving?: boolean) => void;
  renderSettings: (family: string, onDirtyChange: (dirty: boolean, saving?: boolean) => void) => ReactNode;
}) {
  const families = availableFormFamilies(user.permissions);
  const location = legacyFormLocations[initialLocation];
  const [familyKey, setFamilyKey] = useState(location?.family ?? families[0]?.key);
  const [panel, setPanel] = useState(location?.panel ?? "layout");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const trackChanges = useCallback((changed: boolean, busy = false) => { setDirty(changed); setSaving(busy); }, []);
  const family = families.find((item) => item.key === familyKey) ?? families[0];
  const canLists = user.permissions.includes("lists.manage");
  const canForms = user.permissions.includes("forms.manage");
  const canQa = user.permissions.includes("qa_reviews.manage");
  useEffect(() => { onDirtyChange?.(dirty, saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  if (!family) return <p>No form settings are available for your permissions.</p>;
  const panels = [
    ...(family.templateModule && canForms ? [{ key: "layout", label: "Layout & wording" }] : []),
    ...(family.key === "qa" && canQa ? [{ key: "questions", label: "Questions & guidance" }, { key: "ratings", label: "Scale settings" }, { key: "access", label: "Form access" }] : []),
    ...(canLists ? [{ key: "lists", label: "Lists & choices" }] : []),
    ...(family.settings && (canLists || (canForms && family.key !== "coaching")) ? [{ key: "settings", label: family.settings }] : [])
  ];
  const activePanel = panels.some((item) => item.key === panel) ? panel : panels[0]?.key;
  return <div className="route-stack unified-form-editor">
    <section className="panel form-editor-picker">
      <label className="entry-field"><span>Choose a form</span><select disabled={saving} value={family.key} onChange={async (event) => { const next = event.target.value; if (!await confirmUnsavedNavigation()) return; setDirty(false); setFamilyKey(next); setPanel("layout"); }}>
        {families.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select></label>
      <p>Keep wording, response choices and related settings together. Choose a form, then the part you want to change.</p>
    </section>
    <div className="form-editor-tabs" role="group" aria-label={`${family.label} settings`}>
      {panels.map((item) => <button type="button" key={item.key} disabled={saving} aria-pressed={item.key === activePanel} onClick={async () => { if (item.key !== activePanel && await confirmUnsavedNavigation()) { setDirty(false); setPanel(item.key); } }}>{item.label}</button>)}
    </div>
    {dirty ? <p className="notice-row" role="status">Unsaved changes. When switching forms or settings, choose Save, Discard or Stay.</p> : null}
    <div key={`${family.key}-${activePanel}`}>
      {activePanel === "layout" ? <FormBuilder embedded user={user} moduleKey={family.templateModule} onDirtyChange={trackChanges} /> : null}
      {activePanel === "questions" ? <QaQuestionBankAdmin onDirtyChange={trackChanges} /> : null}
      {activePanel === "ratings" ? <QaRatingLabelsAdmin user={user} onDirtyChange={trackChanges} /> : null}
      {activePanel === "access" ? <QaFormAccessAdmin user={user} onDirtyChange={trackChanges} /> : null}
      {activePanel === "lists" ? <>
        <p className="muted-copy form-editor-explanation">{family.key === "all_lists" ? "Shared choices used across the system." : `Shared choices used by ${family.label}.`} Check “Used in” before changing a shared list. Existing identifiers stay fixed; deactivate choices to retire them.</p>
        {!family.templateModule && family.key !== "qa" && family.key !== "all_lists" ? <p className="muted-copy form-editor-explanation">This form’s layout and workflow are controlled by the application. The settings below are editable.</p> : null}
        <AdminManagedLists lookupKeys={family.key === "all_lists" ? undefined : family.lists} onDirtyChange={trackChanges} />
      </> : null}
      {activePanel === "settings" ? renderSettings(family.key, trackChanges) : null}
    </div>
  </div>;
}
