import { useEffect, useRef, type ReactNode } from "react";

/** Native modal focus containment, Escape cancellation, and focus restoration. */
export function ModalDialog({ label, className, onClose, busy = false, children }: {
  label: string; className?: string; onClose: () => void; busy?: boolean; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // A heading or safe action can opt into initial focus. Otherwise retain the
    // browser's native autofocus choice, including the search field in choosers.
    element?.querySelector<HTMLElement>("[data-dialog-initial-focus], [data-dialog-heading]")?.focus({ preventScroll: true });
    return () => {
      if (element?.open) element.close();
      if (origin?.isConnected) origin.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className={`app-dialog ${className ?? ""}`.trim()} aria-label={label} aria-busy={busy || undefined} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>{children}</dialog>;
}
