import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import { changeLivStageVisibility, livStageVisibilityConfirmation } from "../services/livWorkflow";

export function LivStageVisibility({ recordId, stageId, sectionLabel, staffName, visibleToStaff, canManage, processKey, onChanged }: {
  recordId: string;
  stageId: string;
  sectionLabel: string;
  staffName: string;
  visibleToStaff: boolean;
  canManage: boolean;
  processKey: "liv" | "als_liv";
  onChanged: (message: string) => Promise<void>;
}) {
  const [visible, setVisible] = useState(visibleToStaff);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmationTarget, setConfirmationTarget] = useState<boolean | null>(null);
  useEffect(() => { setVisible(visibleToStaff); }, [visibleToStaff]);

  async function confirmVisibility() {
    if (saving || confirmationTarget === null) return;
    const next = confirmationTarget;
    setSaving(true);
    setMessage("");
    try {
      const result = await changeLivStageVisibility({
        visibleToStaff: next, sectionLabel, staffName,
        // Reached only after the owner confirms in the visible dialog.
        confirm: () => true,
        save: (value) => api.updateLivStageVisibility(recordId, stageId, value, processKey)
      });
      if (!result.ok) {
        if (!result.cancelled) setMessage(result.message ?? "Visibility could not be updated. The previous setting is unchanged.");
        return;
      }
      setVisible(next);
      setConfirmationTarget(null);
      try {
        await onChanged(`${sectionLabel} is now ${next ? "visible to" : "hidden from"} the staff member.`);
      } catch {
        setMessage("Visibility was saved, but the record could not be refreshed. Refresh to reload the record.");
      }
    } finally { setSaving(false); }
  }

  return <span className="liv-stage-visibility">
    <span className="liv-stage-visibility-control">
      <span aria-live="polite">{saving ? "Updating visibility…" : visible ? "Visible to staff" : "Hidden from staff"}</span>
      {canManage ? <button
        aria-checked={visible}
        aria-label={`Make ${sectionLabel} visible to ${staffName}`}
        className="liv-visibility-switch"
        disabled={saving}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMessage(""); setConfirmationTarget(!visible); }}
        onKeyDown={(event) => event.stopPropagation()}
        role="switch"
        type="button"
      ><span aria-hidden="true" /></button> : null}
    </span>
    {message && confirmationTarget === null ? <span className="liv-visibility-error" role="alert">{message}</span> : null}
    {confirmationTarget !== null ? createPortal(<LivVisibilityConfirmationDialog
      busy={saving}
      idPrefix={`liv-visibility-${stageId}`}
      message={message}
      onCancel={() => { if (!saving) { setConfirmationTarget(null); setMessage(""); } }}
      onConfirm={() => void confirmVisibility()}
      sectionLabel={sectionLabel}
      staffName={staffName}
      visibleToStaff={confirmationTarget}
    />, document.body) : null}
  </span>;
}

export function LivVisibilityConfirmationDialog({ visibleToStaff, sectionLabel, staffName, busy, message, onConfirm, onCancel, idPrefix }: {
  visibleToStaff: boolean;
  sectionLabel: string;
  staffName: string;
  busy: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  idPrefix: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLDivElement>(null);
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    const currentDialog = dialog.current;
    if (!currentDialog?.open) currentDialog?.showModal();
    cancelButton.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { currentDialog?.close(); if (origin?.isConnected) origin.focus(); };
  }, []);

  return <dialog
    aria-busy={busy}
    aria-describedby={descriptionId}
    aria-labelledby={titleId}
    aria-modal="true"
    className="liv-visibility-confirmation-dialog"
    id={idPrefix}
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => event.stopPropagation()}
    ref={dialog}
  >
    <h2 id={titleId}>{visibleToStaff ? "Make section visible?" : "Hide section?"}</h2>
    <p id={descriptionId}>{livStageVisibilityConfirmation(visibleToStaff, sectionLabel, staffName)}</p>
    {message ? <p className="liv-visibility-error" role="alert">{message}</p> : null}
    <div className="toolbar toolbar-end">
      <div ref={cancelButton}><Button disabled={busy} onClick={onCancel}>{visibleToStaff ? "Keep hidden" : "Keep visible"}</Button></div>
      <Button disabled={busy} onClick={onConfirm} variant="primary">{busy ? "Updating visibility…" : visibleToStaff ? "Make visible" : "Hide section"}</Button>
    </div>
  </dialog>;
}
