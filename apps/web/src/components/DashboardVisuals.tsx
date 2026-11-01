import type { CSSProperties } from "react";
import "./DashboardVisuals.css";

export type DashboardVisualTone = "teal" | "blue" | "green" | "amber" | "violet" | "red";
type MetricProps = { label: string; value: string | number; detail?: string; active?: boolean; onSelect?: () => void; tone?: DashboardVisualTone };

export function DashboardMetricCard({ label, value, detail, active, onSelect, tone = "teal" }: MetricProps) {
  const content = <><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</>;
  const className = `dashboard-visual-metric tone-${tone}`;
  return onSelect
    ? <button type="button" className={className} aria-pressed={active === true} onClick={onSelect}>{content}</button>
    : <article className={className}>{content}</article>;
}

export function DashboardProgressRing({ value, label, detail, tone = "teal" }: { value: number | null; label: string; detail?: string; tone?: DashboardVisualTone }) {
  const percentage = value !== null && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  return <div className={`dashboard-visual-ring tone-${tone}`} role="img" aria-label={percentage === null ? `${label}: not available` : `${label}: ${Math.round(percentage)}%`} style={{ "--dashboard-visual-percentage": `${percentage ?? 0}%` } as CSSProperties}>
    <span><strong>{percentage === null ? "—" : `${Math.round(percentage)}%`}</strong><small>{label}</small>{detail ? <small>{detail}</small> : null}</span>
  </div>;
}

export type DashboardBreakdownItem = { key: string; label: string; value: number; detail?: string; tone?: DashboardVisualTone; disabled?: boolean };
export function DashboardBreakdown({ items, activeKey, onSelect, emptyMessage = "No matching data in this scope." }: { items: DashboardBreakdownItem[]; activeKey?: string; onSelect?: (key: string) => void; emptyMessage?: string }) {
  const maximum = Math.max(1, ...items.map(item => Number.isFinite(item.value) ? Math.max(0, item.value) : 0));
  if (!items.length) return <p className="dashboard-visual-empty">{emptyMessage}</p>;
  return <div className="dashboard-visual-breakdown">{items.map(item => {
    const count = Number.isFinite(item.value) && item.value >= 0 ? item.value : null;
    const content = <><span><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</span><span className="dashboard-visual-track" aria-hidden="true"><i style={{ width: `${(count ?? 0) * 100 / maximum}%` }} /></span><b>{count ?? "—"}</b></>;
    const className = `dashboard-visual-breakdown-row tone-${item.tone ?? "teal"}`;
    return onSelect
      ? <button key={item.key} type="button" className={className} aria-pressed={activeKey === item.key} disabled={item.disabled} onClick={() => onSelect(item.key)}>{content}</button>
      : <div key={item.key} className={className}>{content}</div>;
  })}</div>;
}
