import { ArrowRight, Check, LayoutDashboard, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ModalDialog } from "./ModalDialog";

export type DashboardDestination = { key: string; label: string; group: string; description: string };
export function DashboardNavigator({ items, activeKey, onSelect, canViewQa = false }: {
  items: DashboardDestination[];
  activeKey: string;
  onSelect: (key: string) => void;
  canViewQa?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) searchInput.current?.focus(); }, [open]);
  const current = items.find(item => item.key === activeKey);
  const matches = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return items.filter(item => terms.every(term => `${item.key.replaceAll("_", " ")} ${item.label} ${item.description} ${item.group}`.toLocaleLowerCase().includes(term)));
  }, [items, query]);
  const groups = [...new Set(matches.map(item => item.group))];
  function close() { setOpen(false); setQuery(""); }
  return <>
    <nav className="dashboard-switcher" aria-label="Dashboard navigation">
      <div className="dashboard-switcher-location"><LayoutDashboard size={21} aria-hidden="true" /><span><small>Reporting / {current?.group ?? "Dashboards"}</small><strong>{current?.label ?? "Choose a dashboard"}</strong></span></div>
      <label className="dashboard-explorer-filter"><span className="sr-only">Dashboard</span><select aria-label="Dashboard" value={activeKey} onChange={event => { close(); if (event.target.value !== activeKey && items.some(item => item.key === event.target.value)) onSelect(event.target.value); }}>{[...new Set(items.map(item => item.group))].map(group => <optgroup key={group} label={group}>{items.filter(item => item.group === group).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup>)}</select></label>
      <button type="button" className="icon-button" aria-label="Search dashboards" title="Search dashboards" aria-haspopup="dialog" onClick={() => setOpen(true)}><Search size={18} aria-hidden="true" /></button>
    </nav>
    {open ? <ModalDialog label="Choose a dashboard" className="dashboard-picker-dialog" onClose={close}>
      <header><div><p className="eyebrow">Reporting</p><h2>Choose a dashboard</h2><p>Find the form, people or activity you want to explore.</p></div><button type="button" className="icon-button" aria-label="Close dashboard chooser" onClick={close}><X size={20} /></button></header>
      <label className="dashboard-picker-search"><Search size={19} aria-hidden="true" /><span className="sr-only">Search dashboards</span><input ref={searchInput} type="search" autoFocus value={query} placeholder="Search dashboards, forms or people" onChange={event => setQuery(event.target.value)} /></label>
      <div className="dashboard-picker-body">
        {matches.length ? <p className="sr-only" role="status">{matches.length} {matches.length === 1 ? "dashboard" : "dashboards"} found</p> : null}
        {groups.map(group => <section key={group}><h3>{group}</h3><div className="dashboard-picker-grid">{matches.filter(item => item.group === group).map(item => <button key={item.key} type="button" aria-current={activeKey === item.key ? "page" : undefined} onClick={() => { close(); if (item.key !== activeKey) onSelect(item.key); }}><span><strong>{item.label}</strong>{activeKey === item.key ? <Check size={18} aria-label="Current dashboard" /> : null}</span><p>{item.description}</p></button>)}</div></section>)}
        {!matches.length ? <p role="status">No dashboards match “{query}”. Try staff, visits, CPD or observations.</p> : null}
      </div>
      <footer><span>{items.length} available {items.length === 1 ? "dashboard" : "dashboards"}</span>{canViewQa ? <a href="/qa-hub/reviews">QA review dashboards <ArrowRight size={15} aria-hidden="true" /><small>Choose a review in QA Hub</small></a> : null}</footer>
    </ModalDialog> : null}
  </>;
}
