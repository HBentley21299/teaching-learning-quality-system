import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { LoginScreen } from "./components/LoginScreen";
import { LoadingState } from "./components/LoadingState";
import { hasSignedInAccount, initializeAuth, isAuthEnabled, isLocalLoginEnabled } from "./services/auth";
import { DisplayPreferencesProvider } from "./features/DisplayPreferencesProvider";
import { applyDisplayPreferences, readDisplayPreferences } from "./services/displayPreferences";
import "@fontsource-variable/inter";
import "./app/styles.css";
import "./app/theme.css";
import "./app/product-polish.css";
import "./app/product-reporting.css";
import "./app/product-administration.css";
import "./app/product-shell.css";
import "./app/display-preferences.css";
import "./app/product-ios.css";
import "./app/loading-state.css";

applyDisplayPreferences(readDisplayPreferences(), window.matchMedia("(prefers-color-scheme: dark)").matches);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("The application root element is missing.");
}

const root = createRoot(rootElement);

function render(content: React.ReactNode) {
  root.render(<React.StrictMode><DisplayPreferencesProvider>{content}</DisplayPreferencesProvider></React.StrictMode>);
}

// Complete any returning MSAL redirect before deciding whether to show the app
// or the explicit sign-in screen. This is a no-op in local development.
render(<main className="startup-loading-shell"><LoadingState size="page" label="Opening i-Elevate…" detail="Connecting to your workspace." /></main>);
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
