import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { initializeAuth } from "./services/auth";
import "./app/styles.css";

// Complete the MSAL redirect flow (or start sign-in) before mounting the app so
// every API call can attach an access token. A no-op when auth is not configured.
void initializeAuth().then(() => {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});

