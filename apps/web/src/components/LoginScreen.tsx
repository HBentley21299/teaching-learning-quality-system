import { useState } from "react";
import { KeyRound, LogIn, ShieldCheck, UserRound } from "lucide-react";
import { isAuthEnabled, isLocalLoginEnabled, passwordResetUrl, signIn, signInWithPassword } from "../services/auth";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
          Use your Oldham College Microsoft account to continue.
        </p>
        <button
          className="login-primary"
          onClick={() => {
            if (isAuthEnabled) {
              signIn();
            } else {
              setError("Microsoft sign-in is not configured in this environment. Use a test account below.");
            }
          }}
          type="button"
        >
          <LogIn size={18} aria-hidden="true" />
          Sign in with Microsoft
        </button>
        <a className="login-reset" href={passwordResetUrl} rel="noreferrer" target="_blank">
          <KeyRound size={17} aria-hidden="true" />
          Reset Microsoft password
        </a>
        {isLocalLoginEnabled ? <>
          <div className="login-divider" role="presentation">
            <span>or use a test account</span>
          </div>

          <form className="login-form" onSubmit={submitPasswordLogin}>
          <label>
            <span>Email address</span>
            <input
              autoComplete="username"
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
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="login-error" role="alert">{error}</p> : null}
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
      </section>
    </main>
  );
}
