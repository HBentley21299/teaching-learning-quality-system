import { useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { useEffect, useState } from "react";
import { api } from "../services/api";
import { Button } from "../design-system/Button";
import type { OrgUnitSummary } from "../services/types";
const labels: Record<string,string> = { overview:"Executive overview", learning_walk:"Learning Walks", als_learning_walk:"ALS Learning Walks", liv:"LIV", als_liv:"ALS LIV", eli:"Elevate Learning and Innovation", probation_case:"Probationary Observations", elevate_environment:"Elevate Environments", coaching_session:"Coaching and Mentoring", work_scrutiny:"Work Scrutiny", cpd_event:"CPD", elevate_status:"Elevate Status", actions:"Actions", qa_review:"QA Hub", uco_tla_review:"UCO TLA" };
export function DashboardFacultyAdmin({ onDirtyChange }: { onDirtyChange?: (dirty: boolean, busy: boolean) => void }) {
 const [savedSelections,setSavedSelections]=useState("");
 const [units,setUnits]=useState<OrgUnitSummary[]>([]);
 const [selections,setSelections]=useState<{dashboardKey:string;excludedFacultyIds:string[]}[]>([]);
 const [selected,setSelected]=useState("overview"); const [message,setMessage]=useState(""); const [saving,setSaving]=useState(false);
 useEffect(()=>{void Promise.all([api.orgUnits(),api.dashboardFacultySelections()]).then(([u,s])=>{setUnits(u);setSelections(s);setSavedSelections(JSON.stringify(s));}).catch(()=>setMessage("Faculty settings could not be loaded. Refresh to try again."));},[]);
 const dirty = savedSelections !== "" && JSON.stringify(selections) !== savedSelections;
 const clearGuard = useUnsavedChanges({label:"Dashboard faculty selections",dirty,saving,onSave:save,onDiscard:()=>{if(savedSelections)setSelections(JSON.parse(savedSelections));clearGuard();}});
 useEffect(() => { onDirtyChange?.(dirty, saving); }, [dirty, saving, onDirtyChange]);
 useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
 const faculties=units.filter(u=>u.orgUnitType==="faculty").sort((a,b)=>a.name.localeCompare(b.name));
 const excluded=selections.find(s=>s.dashboardKey===selected)?.excludedFacultyIds ?? [];
 function change(ids:string[]){setMessage("");setSelections(current=>current.map(s=>s.dashboardKey===selected?{...s,excludedFacultyIds:ids}:s));}
 async function save(){setSaving(true);try{const result=await api.saveDashboardFacultySelections(selections);if(!result.ok)throw new Error();setSavedSelections(JSON.stringify(selections));setMessage("Faculty datasets saved. Refresh dashboards to use these selections.");clearGuard();return true;}catch{setMessage("Faculty selections could not be saved.");return false;}finally{setSaving(false);}}
 return <section className="panel"><div className="panel-heading"><div><h2>Faculties included in each dashboard</h2><p>Choose a dashboard, then tick the faculties whose data it should include. Their teams follow the same selection. Other dashboards keep their own choices.</p></div><Button disabled={saving||!dirty||!selections.length} onClick={()=>void save()}>{saving?"Saving…":"Save faculty selections"}</Button></div>
 <p className="muted-copy">These choices apply to totals, staff coverage and exports. Existing organisation-wide exclusions and access permissions still apply. New faculties are included by default.</p>
 {message?<p role="status">{message}</p>:null}
 <label className="entry-field"><span>Dashboard dataset</span><select disabled={saving} value={selected} onChange={e=>setSelected(e.target.value)}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <div className="toolbar"><Button disabled={saving||!selections.length} onClick={()=>change([])}>Include all faculties</Button><Button disabled={saving||!selections.length} onClick={()=>change(faculties.map(f=>f.id))}>Exclude all faculties</Button><span>{faculties.filter(f=>!excluded.includes(f.id)).length} of {faculties.length} selected</span></div>
 <fieldset className="support-options"><legend>{labels[selected]} faculties</legend>{faculties.map(f=><label key={f.id}><input type="checkbox" disabled={saving||!selections.length} checked={!excluded.includes(f.id)} onChange={e=>change(e.target.checked?excluded.filter(id=>id!==f.id):[...excluded,f.id])}/><span>{f.code} — {f.name}{!f.includeInDashboards?" (excluded organisation-wide)":""}</span></label>)}</fieldset>
 </section>;
}
