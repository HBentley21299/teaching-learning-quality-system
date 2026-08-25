import type { KeyboardEvent } from "react";

type WorkspaceSwitchProps = {
  active: "elevate" | "qa";
  onChange: (workspace: "elevate" | "qa") => void;
};

export function WorkspaceSwitch({ active, onChange }: WorkspaceSwitchProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "ArrowLeft" || event.key === "Home" ? "elevate" : "qa";
    onChange(next);
    const parent = event.currentTarget.parentElement;
    window.requestAnimationFrame(() => parent?.querySelector<HTMLButtonElement>(`[data-workspace="${next}"]`)?.focus());
  }

  return (
    <div aria-label="Choose workspace" className="workspace-switch" role="tablist">
      <button
        aria-selected={active === "elevate"}
        className={active === "elevate" ? "is-active" : ""}
        data-workspace="elevate"
        onClick={() => onChange("elevate")}
        onKeyDown={handleKeyDown}
        role="tab"
        tabIndex={active === "elevate" ? 0 : -1}
        type="button"
      >
        i-Elevate
      </button>
      <button
        aria-selected={active === "qa"}
        className={active === "qa" ? "is-active" : ""}
        data-workspace="qa"
        onClick={() => onChange("qa")}
        onKeyDown={handleKeyDown}
        role="tab"
        tabIndex={active === "qa" ? 0 : -1}
        type="button"
      >
        QA Hub
      </button>
    </div>
  );
}
