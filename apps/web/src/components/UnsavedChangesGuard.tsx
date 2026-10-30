import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "../design-system/Button";
import { ModalDialog } from "./ModalDialog";

type Editor = {
  label: string;
  dirty: boolean;
  saving?: boolean;
  /** Staff entry with an explicit draft/submission lifecycle. */
  submission?: boolean;
  onSave?: () => boolean | Promise<boolean>;
  onSubmit?: () => boolean | Promise<boolean>;
  submitLabel?: string;
  discardLabel?: string;
  discardMessage?: string;
  onDiscard?: () => void;
};
const editors = new Map<symbol, Editor>();
const latestEditors = new Map<symbol, { current: Editor }>();
const listeners = new Set<() => void>();
let pending: { resolve: (leave: boolean) => void; saving: boolean; message: string } | null = null;
let version = 0;
function notify() { version++; listeners.forEach(listener => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function activeEditors() { return [...editors.values()].filter(editor => editor.dirty || editor.saving); }
function clearEditor(key: symbol) {
  const latest = latestEditors.get(key);
  const editor = latest?.current ?? editors.get(key);
  if (!editor) return;
  const cleared = { ...editor, dirty: false, saving: false };
  if (latest) latest.current = cleared;
  editors.set(key, cleared);
}
export function hasUnsavedChanges() { return activeEditors().length > 0; }
/** Pause background draft saves while staff decide whether to discard them. */
export function useNavigationDecisionPending() {
  return useSyncExternalStore(subscribe, () => pending !== null, () => false);
}

/** Register the actual unsaved editor, not merely whether its panel is open. */
export function useUnsavedChanges(editor: Editor) {
  const id = useRef(Symbol("unsaved-editor"));
  const latest = useRef(editor);
  latest.current = editor;
  useEffect(() => {
    latestEditors.set(id.current, latest);
    editors.set(id.current, editor);
    notify();
  });
  useEffect(() => {
    if (!editor.dirty && !editor.saving) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (latest.current.dirty || latest.current.saving) { event.preventDefault(); event.returnValue = true; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("beforeunload", beforeUnload); };
  }, [Boolean(editor.dirty || editor.saving)]);
  useEffect(() => {
    const key = id.current;
    return () => {
      editors.delete(key);
      latestEditors.delete(key);
      if (pending && !pending.saving && !activeEditors().length) {
        const decision = pending;
        pending = null;
        decision.resolve(false);
      }
      notify();
    };
  }, []);
  return () => {
    clearEditor(id.current);
    notify();
  };
}

/** The shell and editor-local navigation both await this before changing location. */
export function confirmUnsavedNavigation(): Promise<boolean> {
  // A second navigation gesture must not replace the first pending decision.
  if (pending) return Promise.resolve(false);
  if (!activeEditors().length) return Promise.resolve(true);
  return new Promise(resolve => { pending = { resolve, saving: false, message: "" }; notify(); });
}

export function UnsavedChangesGuard() {
  useSyncExternalStore(subscribe, () => version, () => 0);
  if (!pending) return null;
  const current = activeEditors();
  const busy = pending.saving || current.some(editor => editor.saving);
  const changed = current.filter(editor => editor.dirty);
  const submission = current.some(editor => editor.submission);
  const canSave = changed.length > 0 && changed.every(editor => Boolean(editor.onSave));
  const canSubmit = changed.length > 0 && changed.every(editor => Boolean(editor.onSubmit));
  const submitLabels = [...new Set(changed.map(editor => editor.submitLabel ?? "Submit formally"))];
  const submitLabel = submitLabels.length === 1 ? submitLabels[0] : "Submit formally";
  const discardLabels = [...new Set(changed.map(editor => editor.discardLabel ?? (submission ? "Cancel submission" : "Discard and leave")))];
  const discardLabel = discardLabels.length === 1 ? discardLabels[0] : "Discard unsaved changes";
  const discardMessages = [...new Set(changed.map(editor => editor.discardMessage).filter(Boolean))];
  function isBusy() { return Boolean(pending?.saving || activeEditors().some(editor => editor.saving)); }
  function finish(leave: boolean) {
    const decision = pending;
    pending = null;
    notify();
    decision?.resolve(leave);
  }
  async function save(operation: "draft" | "submit") {
    if (!pending || isBusy()) return;
    const toSave = activeEditors().filter(editor => editor.dirty);
    if (!toSave.length || !toSave.every(editor => operation === "submit" ? editor.onSubmit : editor.onSave)) return;
    pending.saving = true; pending.message = ""; notify();
    try {
      // Resolve each editor afresh: saving a sibling may update shared row versions.
      for (const key of [...editors.keys()]) {
        const editor = editors.get(key);
        const action = operation === "submit" ? editor?.onSubmit : editor?.onSave;
        if (editor?.dirty && (!action || !await action())) {
          if (pending) { pending.saving = false; pending.message = `Check ${editor.label} before leaving. Your changes are still here.`; notify(); }
          return;
        }
        if (editor?.dirty) {
          clearEditor(key);
        }
      }
      if (activeEditors().some(editor => editor.dirty || editor.saving)) {
        if (pending) { pending.saving = false; pending.message = "There are further changes to check before leaving. Your work is still here."; notify(); }
        return;
      }
      finish(true);
    } catch {
      if (pending) { pending.saving = false; pending.message = operation === "submit" ? "Submission could not be completed. Your changes are still here. Keep editing or save a draft before trying again." : "Changes could not be saved. Stay here and try again."; notify(); }
    }
  }
  return <ModalDialog label={submission ? "Leave this submission?" : "Keep your changes?"} className="unsaved-navigation-dialog" busy={busy} onClose={() => { if (!isBusy()) finish(false); }}>
    <h2 id="unsaved-navigation-title">{submission ? "Leave this submission?" : "Keep your changes?"}</h2>
    <p>{busy ? "Please wait for the current save or submission to finish." : submission ? "You have changes that have not been saved or submitted. Choose what to do before leaving." : "You have unsaved changes. Save them before leaving, or keep editing."}</p>
    <ul>{[...new Set(current.map(editor => editor.label))].map(label => <li key={label}>{label}</li>)}</ul>
    {submission ? discardMessages.length ? discardMessages.map(message => <p key={message}>{message}</p>) : <p>Cancel submission discards unsaved changes without creating a new draft. Work saved earlier is retained.</p> : null}
    {!canSave ? <p>{submission ? "Draft saving is not available for every change on this page. Keep editing to finish those changes." : "Some changes must be saved in their editor. Keep editing to finish those changes."}</p> : null}
    {submission && !canSubmit ? <p>Formal submission is not available for every change on this page. Keep editing to complete the required steps.</p> : null}
    {pending.message ? <p role="alert">{pending.message}</p> : null}
    <div className="toolbar"><Button data-dialog-initial-focus autoFocus disabled={busy} onClick={() => { if (!isBusy()) finish(false); }}>Keep editing</Button><Button disabled={busy || !canSave} onClick={() => void save("draft")} variant={submission ? "secondary" : "primary"}>{submission ? "Save as draft" : "Save and leave"}</Button>{submission ? <Button disabled={busy || !canSubmit} onClick={() => void save("submit")} variant="primary">{submitLabel}</Button> : null}<Button disabled={busy} variant="danger" onClick={() => {
      if (!pending || isBusy()) return;
      try {
        const discarded = [...editors.entries()].filter(([, editor]) => editor.dirty || editor.saving);
        discarded.forEach(([key, editor]) => {
          editor.onDiscard?.();
          clearEditor(key);
        });
        finish(true);
      } catch {
        if (pending) { pending.message = "Changes could not be discarded. Keep editing to check this form."; notify(); }
      }
    }}>{discardLabel}</Button></div>
  </ModalDialog>;
}
