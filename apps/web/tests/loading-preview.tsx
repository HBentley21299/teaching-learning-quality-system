// Development-only visual fixture. Vite's production entry does not include it.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DisplayPreferencesProvider, useDisplayPreferences } from "../src/features/DisplayPreferencesProvider";
import { LoadingState } from "../src/components/LoadingState";
import "@fontsource-variable/inter";
import "../src/app/styles.css";
import "../src/app/theme.css";
import "../src/app/product-polish.css";
import "../src/app/product-reporting.css";
import "../src/app/product-administration.css";
import "../src/app/product-shell.css";
import "../src/app/display-preferences.css";
import "../src/app/product-ios.css";
import "../src/app/loading-state.css";

function Preview() {
  const [size, setSize] = useState<"page" | "section" | "inline">("page");
  const { openDisplaySettings } = useDisplayPreferences();
  return <main style={{ maxWidth: "56rem", margin: "auto", padding: "1.25rem" }}>
    <header className="route-header"><div><p className="eyebrow">Design review · Loading preview</p><h1>A little ELI while you wait</h1><p>A visual fixture using the actual application component. No application data is loaded.</p></div><button className="button button-secondary" type="button" onClick={openDisplaySettings}>Display settings</button></header>
    <div className="segmented-control" style={{ marginBlock: "1.5rem" }} aria-label="Loading layout">{(["page", "section", "inline"] as const).map(value => <button type="button" key={value} aria-pressed={size === value} onClick={() => setSize(value)}>{value === "page" ? "Page" : value === "section" ? "Section" : "Inline"}</button>)}</div>
    <section className="panel"><LoadingState size={size} label="Loading your dashboard…" detail={size === "inline" ? undefined : "Bringing your reports together."} /></section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<DisplayPreferencesProvider><Preview /></DisplayPreferencesProvider>);
