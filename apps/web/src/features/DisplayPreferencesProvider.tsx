import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { applyDisplayPreferences, defaultDisplayPreferences, displayPreferencesKey, parseDisplayPreferences,
  readDisplayPreferences, resolvedAppearance, saveDisplayPreferences, type DisplayPreferences } from "../services/displayPreferences";
import { DisplaySettingsDialog } from "../components/DisplaySettingsDialog";

type DisplayPreferencesContextValue = {
  preferences: DisplayPreferences;
  appearance: "light" | "dark";
  updatePreferences: (patch: Partial<DisplayPreferences>) => void;
  openDisplaySettings: () => void;
};
const DisplayPreferencesContext = createContext<DisplayPreferencesContextValue | null>(null);

export function DisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readDisplayPreferences);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [isOpen, setIsOpen] = useState(false);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    applyDisplayPreferences(preferences, systemDark);
    setSaved(saveDisplayPreferences(preferences));
  }, [preferences, systemDark]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== displayPreferencesKey && event.key !== null) return;
      try { setPreferences(event.newValue ? parseDisplayPreferences(JSON.parse(event.newValue)) : { ...defaultDisplayPreferences }); }
      catch { /* A malformed external update must not interrupt the current page. */ }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const value = useMemo<DisplayPreferencesContextValue>(() => ({
    preferences, appearance: resolvedAppearance(preferences, systemDark),
    updatePreferences: patch => setPreferences(current => parseDisplayPreferences({ ...current, ...patch })),
    openDisplaySettings: () => setIsOpen(true)
  }), [preferences, systemDark]);

  return <DisplayPreferencesContext.Provider value={value}>
    {children}
    {isOpen ? <DisplaySettingsDialog preferences={preferences} saved={saved} onChange={value.updatePreferences}
      onReset={() => setPreferences({ ...defaultDisplayPreferences })} onClose={() => setIsOpen(false)} /> : null}
  </DisplayPreferencesContext.Provider>;
}

export function useDisplayPreferences(): DisplayPreferencesContextValue {
  const context = useContext(DisplayPreferencesContext);
  if (!context) throw new Error("Display preferences must be used inside their provider.");
  return context;
}
