import { useEffect, useRef, type ReactNode } from "react";

/** Native modal focus containment, Escape cancellation, and focus restoration. */
export function ModalDialog({ label, className, onClose, busy = false, children }: {
  label: string; className?: string; onClose: () => void; busy?: boolean; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { if (origin?.isConnected) origin.focus(); };
  }, []);
  return <dialog ref={dialog} className={className} aria-label={label} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>{children}</dialog>;
}
