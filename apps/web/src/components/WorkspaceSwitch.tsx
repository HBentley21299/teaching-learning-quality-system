import { ArrowUpRight, Check, GraduationCap, ShieldCheck } from "lucide-react";

type WorkspaceSwitchProps = {
  active: "elevate" | "qa";
  onChange: (workspace: "elevate" | "qa") => void;
};

const workspaces = [
  { key: "elevate", label: "i-Elevate", description: "Staff development, forms and profiles", icon: GraduationCap },
  { key: "qa", label: "QA Hub", description: "Quality reviews, evidence and improvement", icon: ShieldCheck }
] as const;

export function WorkspaceSwitch({ active, onChange }: WorkspaceSwitchProps) {
  return (
    <nav aria-label="Choose workspace" className="workspace-picker">
      <p className="workspace-picker-label">Your workspaces <span>Choose an area to get started</span></p>
      <div className="workspace-switch">
        {workspaces.map(({ key, label, description, icon: Icon }) => (
          <button aria-current={active === key ? "true" : undefined}
            className={active === key ? "is-active" : ""} key={key}
            onClick={() => { if (active !== key) onChange(key); }} type="button">
            <Icon aria-hidden="true" className="workspace-icon" size={24} />
            <span className="workspace-copy"><strong>{label}</strong><span>{description}</span></span>
            <span className="workspace-status">{active === key ? <>You’re here <Check size={16} aria-hidden="true" /></> : <>Open <ArrowUpRight size={16} aria-hidden="true" /></>}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
