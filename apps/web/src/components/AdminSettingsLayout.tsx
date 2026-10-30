import { ArrowRight, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { searchAdminSettings, type AdminSettingsEntry } from "../app/adminSettingsSearch";
export type { AdminSettingsEntry } from "../app/adminSettingsSearch";

export function AdminSettingsLayout({ title, description, entries, activeKey, onSelect, children, storageKey, busy = false }: {
  title: string;
  description: string;
  entries: readonly AdminSettingsEntry[];
  activeKey: string;
  onSelect: (key: string) => void | Promise<void>;
  children: ReactNode;
  storageKey: string;
  busy?: boolean;
}) {
  const [query, setQuery] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const previousKey = useRef<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(`admin-groups:${storageKey}`) ?? "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    }
    catch { return {}; }
  });
  const active = entries.find(entry => entry.key === activeKey);
  const destinations = entries.filter(entry => entry.key !== "overview");
  const matches = useMemo(() => searchAdminSettings(destinations, query), [entries, query]);
  const groups = [...new Set(matches.map(entry => entry.group))];
  const searching = Boolean(query.trim());
  useEffect(() => {
    if (previousKey.current === activeKey) return;
    previousKey.current = activeKey;
    heading.current?.focus();
  }, [activeKey]);
  useEffect(() => {
    if (typeof document !== "undefined") document.title = `${activeKey === "overview" ? title : active?.label ?? title} · i-Elevate`;
  }, [activeKey, active?.label, title]);
  useEffect(() => {
    if (active && active.key !== "overview") setExpanded(current => current[active.group] ? current : { ...current, [active.group]: true });
  }, [activeKey, active?.group]);
  useEffect(() => {
    try { window.sessionStorage.setItem(`admin-groups:${storageKey}`, JSON.stringify(expanded)); }
    catch { /* Navigation remains usable when browser storage is unavailable. */ }
  }, [expanded, storageKey]);

  function toggleGroup(group: string, open: boolean) {
    if (searching) return;
    setExpanded(current => Boolean(current[group]) === open ? current : { ...current, [group]: open });
  }
  const settingSearch = <>
    <label className="admin-setting-search"><span>Find a setting</span><span className="admin-search-input"><Search size={17} aria-hidden="true" /><input type="search" aria-label={`Search ${title}`} placeholder="Search a task, setting or keyword" value={query} onChange={event => setQuery(event.target.value)} />{query ? <button type="button" aria-label="Clear settings search" onClick={() => setQuery("")}><X size={16} aria-hidden="true" /></button> : null}</span></label>
    {searching ? <p className="admin-search-count" role="status">{matches.length} {matches.length === 1 ? "setting" : "settings"} found</p> : <p className="admin-search-count">{destinations.length} settings in {groups.length} groups</p>}
  </>;
  return <div className="route-stack admin-centre admin-settings-layout">
    <header className="route-header"><div><p className="eyebrow">{activeKey === "overview" ? "Administration" : title}</p><h1 ref={heading} tabIndex={-1}>{activeKey === "overview" ? title : active?.label ?? "Setting unavailable"}</h1><p>{activeKey === "overview" ? description : active?.description}</p></div></header>
    <div className={`admin-workbench${activeKey === "overview" ? " is-overview" : ""}`}>
      {activeKey === "overview" ? <section className="admin-directory admin-overview-search" aria-label={`${title} search`}>{settingSearch}</section> : null}
      <div className="admin-workspace">
        {activeKey !== "overview" ? <>
          <nav className="admin-breadcrumbs" aria-label="Setting location"><button disabled={busy} type="button" onClick={() => void onSelect("overview")}>{title}</button><span aria-hidden="true">/</span><span>{active?.group ?? "Settings"}</span></nav>
          {active?.impact ? <div className="admin-section-heading"><p className="admin-setting-impact">{active.impact}</p></div> : null}
          {active?.steps?.length ? <details className="admin-task-guidance"><summary>How to make this change</summary><ol>{active.steps.map(step => <li key={step}>{step}</li>)}</ol></details> : null}
        </> : <section className="admin-home-intro"><h2>What do you need to change?</h2><p>Search using the words you would use for the task, or expand a group below. Each setting opens on its own page.</p></section>}
        {activeKey === "overview" ? <div className="admin-grouped-tasks">{groups.map(group => <details key={group} className="panel admin-task-group" open={searching || undefined}>
          <summary><div><h3>{group}</h3><span>{matches.filter(entry => entry.group === group).length} {matches.filter(entry => entry.group === group).length === 1 ? "setting" : "settings"}</span></div><ChevronDown size={20} aria-hidden="true" /></summary>
          <div className="admin-task-directory">{matches.filter(entry => entry.group === group).map(entry => <button disabled={busy} type="button" key={entry.key} onClick={() => void onSelect(entry.key)}><strong>{entry.label}</strong><p>{entry.description}</p><span className="admin-task-open">{entry.workspace ? `Open in ${entry.workspace}` : "Open setting"}<ArrowRight size={15} aria-hidden="true" /></span></button>)}</div>
        </details>)}{matches.length === 0 ? <section className="panel" role="status"><h3>No settings match “{query}”</h3><p>Try an item such as course level, qualification, faculty, sender or archive.</p><button type="button" className="button" onClick={() => setQuery("")}>Browse all settings</button></section> : null}</div> : null}
        {children}
      </div>
      {activeKey !== "overview" ? <aside className="admin-directory" aria-label={`${title} navigation`}>
        {settingSearch}
        <nav aria-label="Admin sections">
          <button className="admin-directory-home" disabled={busy} type="button" onClick={() => void onSelect("overview")}>Administration home</button>
          {groups.map(group => <details className="admin-directory-group" key={group} open={searching || Boolean(expanded[group])} onToggle={event => toggleGroup(group, event.currentTarget.open)}>
            <summary><span>{group}</span><small>{matches.filter(entry => entry.group === group).length}</small><ChevronDown size={15} aria-hidden="true" /></summary>
            {matches.filter(entry => entry.group === group).map(entry => <button disabled={busy} type="button" key={entry.key} aria-current={activeKey === entry.key ? "page" : undefined} onClick={() => void onSelect(entry.key)}>{entry.label}{entry.workspace ? <small>{entry.workspace}</small> : null}</button>)}
          </details>)}
          {matches.length === 0 ? <p className="muted-copy">No matching settings. Try a shorter phrase, or clear the search to browse the groups.</p> : null}
        </nav>
      </aside> : null}
    </div>
  </div>;
}
