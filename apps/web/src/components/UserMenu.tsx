import { useState } from "react";
import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import { api } from "../services/api";
import { getLocalToken, isAuthEnabled, signOut } from "../services/auth";

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

  const hasLocalSession = Boolean(getLocalToken());
  const canSignOut = isAuthEnabled || hasLocalSession;

  function closeDialog() {
    setIsChangingPassword(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setFeedback("");
  }

  async function submitPasswordChange(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setFeedback("The new passwords do not match.");
      return;
    }
    setIsSaving(true);
    setFeedback("");
    const result = await api.changePassword({ currentPassword, newPassword });
    setIsSaving(false);
    if (result.ok) {
      closeDialog();
      return;
    }
    setFeedback(result.message ?? "The password could not be changed.");
  }

  return (
    <div className="user-chip user-menu">
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="user-menu-trigger"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <span>{displayName}</span>
        <ChevronDown aria-hidden="true" size={15} />
      </button>

      {isOpen ? (
        <>
          <div className="user-menu-backdrop" onClick={() => setIsOpen(false)} />
          <div className="user-menu-list" role="menu">
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
              <button onClick={signOut} role="menuitem" type="button">
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
        <div className="user-menu-dialog-backdrop" onClick={closeDialog}>
          <form
            className="panel user-menu-dialog"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitPasswordChange}
          >
            <h2>Change password</h2>
            <label>
              <span>Current password</span>
              <input
                autoComplete="current-password"
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
                minLength={10}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </label>
            {feedback ? <p className="login-error" role="alert">{feedback}</p> : null}
            <div className="user-menu-dialog-actions">
              <button className="button button-secondary" onClick={closeDialog} type="button">
                Cancel
              </button>
              <button className="button button-primary" disabled={isSaving} type="submit">
                {isSaving ? "Saving..." : "Change password"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
