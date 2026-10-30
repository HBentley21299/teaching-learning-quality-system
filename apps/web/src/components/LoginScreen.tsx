import { useState } from "react";
import { KeyRound, LogIn, ShieldCheck, UserRound, SlidersHorizontal } from "lucide-react";
import { useDisplayPreferences } from "../features/DisplayPreferencesProvider";
import { isAuthEnabled, isLocalLoginEnabled, passwordResetUrl, signIn, signInWithPassword } from "../services/auth";

export function LoginScreen() {
  const { openDisplaySettings } = useDisplayPreferences();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitMicrosoftLogin() {
    setError(""); setIsSubmitting(true);
    try { await signIn(); }
    catch { setError("Microsoft sign-in could not be started. Try again or contact your administrator."); }
    finally { setIsSubmitting(false); }
  }

  async function submitPasswordLogin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await signInWithPassword(email.trim(), password);
      window.location.assign("/");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign in failed.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand" aria-hidden="true">iE</div>
        <p className="eyebrow">Teaching and Learning</p>
        <h1 id="login-title">Sign in to i-Elevate</h1>

        <p className="login-copy">
          {isAuthEnabled ? "Use your Oldham College Microsoft account to continue." : isLocalLoginEnabled ? "Use your test account to continue." : "Sign-in is unavailable. Contact your administrator."}
        </p>
        {isAuthEnabled ? <><button
          className="login-primary"
          onClick={() => void submitMicrosoftLogin()}
          disabled={isSubmitting}
          type="button"
        >
          <LogIn size={18} aria-hidden="true" />
          Sign in with Microsoft
        </button>
        <a className="login-reset" href={passwordResetUrl} rel="noreferrer" target="_blank">
          <KeyRound size={17} aria-hidden="true" />
          Reset Microsoft password
        </a></> : null}
        {error ? <p className="login-error" role="alert" id="sign-in-error">{error}</p> : null}
        {isLocalLoginEnabled ? <>
          {isAuthEnabled ? <div className="login-divider" role="presentation">
            <span>or use a test account</span>
          </div> : null}

          <form className="login-form" onSubmit={submitPasswordLogin} aria-busy={isSubmitting} aria-describedby={error ? "sign-in-error" : undefined}>
          <label>
            <span>Email address</span>
            <input
              autoComplete="username"
              disabled={isSubmitting}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              disabled={isSubmitting}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="login-primary" disabled={isSubmitting} type="submit">
            <UserRound size={18} aria-hidden="true" />
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
          </form>
        </> : null}

        <div className="login-security">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>{isAuthEnabled ? "Protected by Microsoft Entra ID" : isLocalLoginEnabled ? "Local test environment" : "Microsoft sign-in required"}</span>
        </div>
        <button className="button button-quiet login-display-settings" type="button" aria-haspopup="dialog" onClick={openDisplaySettings}><SlidersHorizontal size={17} aria-hidden="true" />Display &amp; accessibility</button>
      </section>
    </main>
  );
}
