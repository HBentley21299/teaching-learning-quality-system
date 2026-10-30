import { useEffect, useRef, useState } from "react";
import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import { api } from "../services/api";
import { confirmUnsavedNavigation } from "./UnsavedChangesGuard";
import { getLocalToken, isAuthEnabled, signOut } from "../services/auth";
import { ModalDialog } from "./ModalDialog";

/**
 * Topbar user chip: clicking the name opens a menu with sign out and, for
 * local test accounts, a change-password dialog.
 */
export function UserMenu({ displayName }: { displayName: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isOpen) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [isOpen]);

  const hasLocalSession = Boolean(getLocalToken());
  const canSignOut = isAuthEnabled || hasLocalSession;

  function closeDialog() {
    setIsChangingPassword(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setFeedback("");
    triggerRef.current?.focus();
  }

  async function submitPasswordChange(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setFeedback("The new passwords do not match.");
      return;
    }
    setIsSaving(true);
    setFeedback("");
    try {
      const result = await api.changePassword({ currentPassword, newPassword });
      if (result.ok) { closeDialog(); return; }
      setFeedback(result.message ?? "The password could not be changed. Try again.");
    } catch { setFeedback("The password could not be changed. Check your connection and try again."); }
    finally { setIsSaving(false); }
  }

  return (
    <div className="user-chip user-menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }} onKeyDown={event => {
      if (event.key === "Escape" && isOpen) { event.stopPropagation(); setIsOpen(false); triggerRef.current?.focus(); }
      if (isOpen && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        const options = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const next = options.indexOf(document.activeElement as HTMLButtonElement) + (event.key === "ArrowDown" ? 1 : -1);
        options[(next + options.length) % options.length]?.focus();
      }
    }}>
      {canSignOut ? <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        ref={triggerRef}
        className="user-menu-trigger"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <span>{displayName}</span>
        <ChevronDown aria-hidden="true" size={15} />
      </button> : <span className="user-menu-trigger"><span>{displayName}</span></span>}

      {isOpen ? (
        <>
          <div className="user-menu-backdrop" onClick={() => setIsOpen(false)} />
          <div className="user-menu-list" role="menu" aria-label="Your account" ref={menuRef}>
            {hasLocalSession ? (
              <button
                onClick={() => { setIsOpen(false); setIsChangingPassword(true); }}
                role="menuitem"
                type="button"
              >
                <KeyRound aria-hidden="true" size={15} />
                Change password
              </button>
            ) : null}
            {canSignOut ? (
              <button onClick={async () => { if (await confirmUnsavedNavigation()) signOut(); }} role="menuitem" type="button">
                <LogOut aria-hidden="true" size={15} />
                Sign out
              </button>
            ) : (
              <p className="user-menu-note">Signed in as the development user.</p>
            )}
          </div>
        </>
      ) : null}

      {isChangingPassword ? (
        <ModalDialog className="account-password-dialog" label="Change password" onClose={closeDialog} busy={isSaving}>
          <form
            className="panel user-menu-dialog"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitPasswordChange}
            aria-busy={isSaving}
            aria-describedby={feedback ? "password-change-feedback" : undefined}
          >
            <h2 data-dialog-heading tabIndex={-1}>Change password</h2>
            <label>
              <span>Current password</span>
              <input
                autoComplete="current-password"
                disabled={isSaving}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                type="password"
                value={currentPassword}
              />
            </label>
            <label>
              <span>New password (at least 10 characters)</span>
              <input
                autoComplete="new-password"
                disabled={isSaving}
                minLength={10}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </label>
            <label>
              <span>Confirm new password</span>
              <input
                autoComplete="new-password"
                disabled={isSaving}
                minLength={10}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </label>
            {feedback ? <p className="login-error" role="alert" id="password-change-feedback">{feedback}</p> : null}
            <div className="user-menu-dialog-actions">
              <button className="button button-secondary" disabled={isSaving} onClick={closeDialog} type="button">
                Cancel
              </button>
              <button className="button button-primary" disabled={isSaving} type="submit">
                {isSaving ? "Saving..." : "Change password"}
              </button>
            </div>
          </form>
        </ModalDialog>
      ) : null}
    </div>
  );
}
