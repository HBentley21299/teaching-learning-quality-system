export const displayPreferencesKey = "ielevate-display-preferences";

export type DisplayPreferences = {
  appearance: "system" | "light" | "dark";
  textSize: "standard" | "large" | "larger";
  contrast: "standard" | "high";
  density: "comfortable" | "compact";
  motion: "system" | "reduced";
  links: "standard" | "underlined";
  reading: "standard" | "spacious";
  navigation: "expanded" | "compact";
};

export const defaultDisplayPreferences: Readonly<DisplayPreferences> = Object.freeze({
  appearance: "system", textSize: "standard", contrast: "standard", density: "comfortable",
  motion: "system", links: "standard", reading: "standard", navigation: "expanded"
});

const choices: { [K in keyof DisplayPreferences]: readonly DisplayPreferences[K][] } = {
  appearance: ["system", "light", "dark"], textSize: ["standard", "large", "larger"],
  contrast: ["standard", "high"], density: ["comfortable", "compact"], motion: ["system", "reduced"],
  links: ["standard", "underlined"], reading: ["standard", "spacious"], navigation: ["expanded", "compact"]
};

/** Only known display choices are accepted; stored data never controls styles or navigation paths. */
export function parseDisplayPreferences(value: unknown): DisplayPreferences {
  const result = { ...defaultDisplayPreferences };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const key of Object.keys(choices) as Array<keyof DisplayPreferences>) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && (choices[key] as readonly string[]).includes(candidate)) {
      (result as Record<string, string>)[key] = candidate;
    }
  }
  return result;
}

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function readDisplayPreferences(storage?: PreferenceStorage): DisplayPreferences {
  try {
    const source = storage ?? window.localStorage;
    const saved = source.getItem(displayPreferencesKey);
    if (saved) return parseDisplayPreferences(JSON.parse(saved));
    return parseDisplayPreferences({
      appearance: source.getItem("ielevate-theme") ?? "system",
      navigation: source.getItem("ielevate-navigation-collapsed") === "true" ? "compact" : "expanded"
    });
  } catch { return { ...defaultDisplayPreferences }; }
}

export function saveDisplayPreferences(preferences: DisplayPreferences, storage?: PreferenceStorage): boolean {
  try {
    (storage ?? window.localStorage).setItem(displayPreferencesKey, JSON.stringify(parseDisplayPreferences(preferences)));
    return true;
  } catch { return false; }
}

export function resolvedAppearance(preferences: DisplayPreferences, systemDark: boolean): "light" | "dark" {
  return preferences.appearance === "system" ? systemDark ? "dark" : "light" : preferences.appearance;
}

export function applyDisplayPreferences(preferences: DisplayPreferences, systemDark: boolean, element = document.documentElement): void {
  element.dataset.theme = resolvedAppearance(preferences, systemDark);
  element.dataset.appearance = preferences.appearance;
  element.dataset.textSize = preferences.textSize;
  element.dataset.contrast = preferences.contrast;
  element.dataset.density = preferences.density;
  element.dataset.motion = preferences.motion;
  element.dataset.links = preferences.links;
  element.dataset.reading = preferences.reading;
}
