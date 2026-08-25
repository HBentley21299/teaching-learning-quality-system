import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { LoginScreen } from "./components/LoginScreen";
import { hasSignedInAccount, initializeAuth, isAuthEnabled, isLocalLoginEnabled } from "./services/auth";
import "@fontsource-variable/inter";
import "./app/styles.css";
import "./app/theme.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("The application root element is missing.");
}

const root = createRoot(rootElement);

function render(content: React.ReactNode) {
  root.render(<React.StrictMode>{content}</React.StrictMode>);
}

// Complete any returning MSAL redirect before deciding whether to show the app
// or the explicit sign-in screen. This is a no-op in local development.
void initializeAuth().then(() => {
  const requiresInteractiveSignIn = isAuthEnabled || isLocalLoginEnabled;
  render(!requiresInteractiveSignIn || hasSignedInAccount() ? <App /> : <LoginScreen />);
}).catch(() => {
  render(
    <main className="startup-error-shell">
      <section className="access-denied-panel" role="alert">
        <div>
          <h1>Sign-in could not be started</h1>
          <p>The authentication service did not respond. No application data has been loaded.</p>
        </div>
        <button onClick={() => window.location.reload()} type="button">Try again</button>
      </section>
    </main>
  );
});
