export function historyPosition(): number {
  return typeof window.history.state?.ielevateIndex === "number" ? window.history.state.ielevateIndex : 0;
}

export function initialiseAppHistory() {
  if (typeof window.history.state?.ielevateIndex !== "number") {
    window.history.replaceState({ ...window.history.state, ielevateIndex: 0 }, "");
  }
}

export function writeAppPath(path: string, replace = false) {
  if (window.location.pathname === path && !window.location.search && !window.location.hash) return;
  window.history[replace ? "replaceState" : "pushState"]({ ...window.history.state, ielevateIndex: historyPosition() + (replace ? 0 : 1) }, "", path);
  window.dispatchEvent(new Event("app:history-written"));
}
