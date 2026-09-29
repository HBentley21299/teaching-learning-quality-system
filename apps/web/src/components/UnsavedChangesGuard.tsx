import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "../design-system/Button";

type Editor = {
  label: string;
  dirty: boolean;
  saving?: boolean;
  onSave?: () => boolean | Promise<boolean>;
  onDiscard?: () => void;
};
const editors = new Map<symbol, Editor>();
const listeners = new Set<() => void>();
let pending: { resolve: (leave: boolean) => void; saving: boolean; message: string } | null = null;
let version = 0;
function notify() { version++; listeners.forEach(listener => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function activeEditors() { return [...editors.values()].filter(editor => editor.dirty || editor.saving); }
export function hasUnsavedChanges() { return activeEditors().length > 0; }

/** Register the actual unsaved editor, not merely whether its panel is open. */
export function useUnsavedChanges(editor: Editor) {
  const id = useRef(Symbol("unsaved-editor"));
  const latest = useRef(editor);
  latest.current = editor;
  useEffect(() => {
    editors.set(id.current, editor);
    notify();
  });
  useEffect(() => {
    const key = id.current;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (latest.current.dirty || latest.current.saving) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { editors.delete(key); notify(); window.removeEventListener("beforeunload", beforeUnload); };
  }, []);
  return () => {
    latest.current = { ...latest.current, dirty: false, saving: false };
    editors.set(id.current, latest.current);
    notify();
  };
}

/** The shell and editor-local navigation both await this before changing location. */
export function confirmUnsavedNavigation(): Promise<boolean> {
  if (!activeEditors().length) return Promise.resolve(true);
  // A second navigation gesture must not replace the first pending decision.
  if (pending) return Promise.resolve(false);
  return new Promise(resolve => { pending = { resolve, saving: false, message: "" }; notify(); });
}

export function UnsavedChangesGuard() {
  useSyncExternalStore(subscribe, () => version);
  const dialog = useRef<HTMLDialogElement>(null);
  const showing = Boolean(pending);
  useEffect(() => {
    if (showing && !dialog.current?.open) {
      const origin = document.activeElement as HTMLElement | null;
      dialog.current?.showModal();
      return () => { if (origin?.isConnected) origin.focus(); };
    }
    if (!showing && dialog.current?.open) dialog.current.close();
  }, [showing]);
  if (!pending) return null;
  const current = activeEditors();
  const busy = pending.saving || current.some(editor => editor.saving);
  const canSave = current.filter(editor => editor.dirty).every(editor => Boolean(editor.onSave));
  function finish(leave: boolean) {
    const decision = pending;
    pending = null;
    notify();
    decision?.resolve(leave);
  }
  async function save() {
    if (!pending || busy || !canSave) return;
    pending.saving = true; pending.message = ""; notify();
    try {
      // Resolve each editor afresh: saving a sibling may update shared row versions.
      for (const key of [...editors.keys()]) {
        const editor = editors.get(key);
        if (editor?.dirty && (!editor.onSave || !await editor.onSave())) {
          if (pending) { pending.saving = false; pending.message = `Check ${editor.label} before leaving. Your changes are still here.`; notify(); }
          return;
        }
        if (editor?.dirty) {
          const saved = editors.get(key);
          if (saved) editors.set(key, { ...saved, dirty: false, saving: false });
        }
      }
      finish(true);
    } catch {
      if (pending) { pending.saving = false; pending.message = "Changes could not be saved. Stay here and try again."; notify(); }
    }
  }
  return <dialog ref={dialog} aria-labelledby="unsaved-navigation-title" onCancel={event => { event.preventDefault(); if (!busy) finish(false); }} style={{ maxWidth: "min(34rem, calc(100vw - 2rem))", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--line-strong)", borderRadius: "1rem", padding: "1.5rem" }}>
    <h2 id="unsaved-navigation-title">Keep your changes?</h2>
    <p>{busy ? "Please wait for the current save to finish." : "Save your changes before leaving, discard them, or stay here to continue editing."}</p>
    <ul>{[...new Set(current.map(editor => editor.label))].map(label => <li key={label}>{label}</li>)}</ul>
    {!canSave ? <p>Some changes must be saved in their editor. Stay here to finish those changes.</p> : null}
    {pending.message ? <p role="alert">{pending.message}</p> : null}
    <div className="toolbar"><Button disabled={busy || !canSave} onClick={() => void save()} variant="primary">Save changes</Button><Button disabled={busy} onClick={() => {
      const discarded = [...editors.entries()].filter(([, editor]) => editor.dirty || editor.saving);
      discarded.forEach(([key, editor]) => {
        editor.onDiscard?.();
        const remaining = editors.get(key);
        if (remaining) editors.set(key, { ...remaining, dirty: false, saving: false });
      });
      finish(true);
    }}>Discard changes</Button><Button disabled={busy} onClick={() => finish(false)}>Stay here</Button></div>
  </dialog>;
}
