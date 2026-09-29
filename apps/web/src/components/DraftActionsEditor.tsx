import { Button } from "../design-system/Button";
import { ActionThemeSelect } from "./ActionThemeSelect";
import { StaffSearchSelect } from "./StaffSearchSelect";
import type { DraftFormAction, StaffSummary } from "../services/types";

export function DraftActionsEditor({ actions, onChange, staff, process, disabled = false }: {
  actions: DraftFormAction[]; onChange: (actions: DraftFormAction[]) => void; staff: StaffSummary[]; process: string; disabled?: boolean;
}) {
  function update(index: number, patch: Partial<DraftFormAction>) { onChange(actions.map((action, i) => i === index ? { ...action, ...patch } : action)); }
  return <fieldset className="entry-section" disabled={disabled}><legend>Draft actions</legend>
    <p>These actions stay with this draft. They are assigned and included in reporting only when the record is submitted.</p>
    {actions.map((action, index) => <div className="form-stack" key={index}>
      <label className="entry-field"><span>Action {index + 1} theme</span><ActionThemeSelect id={`draft-action-theme-${index}`} sourceFormType={process} value={action.actionTheme ?? ""} onChange={actionTheme => update(index, { actionTheme })}/></label>
      <label className="entry-field"><span>Action description</span><textarea maxLength={300} value={action.title ?? ""} onChange={event => update(index, { title: event.target.value })}/></label>
      <label className="entry-field"><span>Owner</span><StaffSearchSelect id={`draft-action-owner-${index}`} staff={staff} value={action.ownerStaffId ?? ""} onChange={ownerStaffId => update(index, { ownerStaffId: ownerStaffId || undefined })}/></label>
      <label className="entry-field"><span>Implementation date</span><input type="date" value={action.dueDate ?? ""} onChange={event => update(index, { dueDate: event.target.value || undefined })}/></label>
      <label className="entry-field"><span>Expected impact and follow-up</span><textarea maxLength={4000} value={action.detail ?? ""} onChange={event => update(index, { detail: event.target.value })}/></label>
      <Button onClick={() => onChange(actions.filter((_, i) => i !== index))}>{`Remove action ${index + 1}`}</Button>
    </div>)}
    <Button onClick={() => onChange([...actions, {}])}>Add draft action</Button>
  </fieldset>;
}
