import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { LoginScreen } from "./components/LoginScreen";
import { hasSignedInAccount, initializeAuth, isAuthEnabled } from "./services/auth";
import "./app/styles.css";

// Complete any returning MSAL redirect before deciding whether to show the app
// or the explicit sign-in screen. This is a no-op in local development.
void initializeAuth().then(() => {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {isAuthEnabled && !hasSignedInAccount() ? <LoginScreen /> : <App />}
    </React.StrictMode>
  );
});
