import { KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { passwordResetUrl, signIn } from "../services/auth";

export function LoginScreen() {
  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand" aria-hidden="true">TL</div>
        <p className="eyebrow">Teaching &amp; Learning Quality</p>
        <h1 id="login-title">Sign in to the Quality System</h1>
        <p className="login-copy">
          Use your Oldham College Microsoft account to continue.
        </p>
        <button className="login-primary" onClick={signIn} type="button">
          <LogIn size={18} aria-hidden="true" />
          Sign in with Microsoft
        </button>
        <a className="login-reset" href={passwordResetUrl} rel="noreferrer" target="_blank">
          <KeyRound size={17} aria-hidden="true" />
          Reset Microsoft password
        </a>
        <div className="login-security">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>Protected by Microsoft Entra ID</span>
        </div>
      </section>
    </main>
  );
}
