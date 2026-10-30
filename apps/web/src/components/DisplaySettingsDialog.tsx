import { Laptop, Moon, RotateCcw, Sun, X } from "lucide-react";
import { useId } from "react";
import { ModalDialog } from "./ModalDialog";
import type { DisplayPreferences } from "../services/displayPreferences";

export function DisplaySettingsDialog({ preferences, saved, onChange, onReset, onClose }: {
  preferences: DisplayPreferences; saved: boolean;
  onChange: (patch: Partial<DisplayPreferences>) => void; onReset: () => void; onClose: () => void;
}) {
  const id = useId();
  return <ModalDialog label="Display & accessibility" className="display-settings-dialog" onClose={onClose}>
    <header className="display-settings-heading">
      <div><h2 data-dialog-heading tabIndex={-1}>Display &amp; accessibility</h2><p>Make i-Elevate easier for you to use.</p></div>
      <button className="icon-button" type="button" aria-label="Close display settings" onClick={onClose}><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="display-settings-body">
      <fieldset className="display-setting-group"><legend>Appearance</legend><p>Choose a colour scheme, or follow your device.</p>
        <div className="appearance-options">{([
          ["system", "Use device setting", Laptop], ["light", "Light", Sun], ["dark", "Dark", Moon]
        ] as const).map(([key, label, Icon]) => <label key={key} className={preferences.appearance === key ? "is-selected" : ""}>
          <input type="radio" name={`${id}-appearance`} value={key} checked={preferences.appearance === key} onChange={() => onChange({ appearance: key })} />
          <Icon size={21} aria-hidden="true" /><span>{label}</span>
        </label>)}</div>
      </fieldset>
      <div className="display-settings-columns">
        <label className="display-setting-select" htmlFor={`${id}-text-size`}><span id={`${id}-text-label`}>Text size</span><select id={`${id}-text-size`} aria-labelledby={`${id}-text-label`} aria-describedby={`${id}-text-help`} value={preferences.textSize} onChange={event => onChange({ textSize: event.target.value as DisplayPreferences["textSize"] })}>
          <option value="standard">Standard</option><option value="large">Large</option><option value="larger">Larger</option>
        </select><small id={`${id}-text-help`}>Browser zoom is also supported.</small></label>
        <label className="display-setting-select" htmlFor={`${id}-density`}><span id={`${id}-density-label`}>Space on the page</span><select id={`${id}-density`} aria-labelledby={`${id}-density-label`} aria-describedby={`${id}-density-help`} value={preferences.density} onChange={event => onChange({ density: event.target.value as DisplayPreferences["density"] })}>
          <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
        </select><small id={`${id}-density-help`}>Compact fits more rows without shrinking text.</small></label>
      </div>
      <fieldset className="display-setting-group"><legend>Reading and movement</legend>
        <PreferenceSwitch id={`${id}-contrast`} label="Stronger contrast" description="Make text, borders and controls stand out more." checked={preferences.contrast === "high"} onChange={checked => onChange({ contrast: checked ? "high" : "standard" })} />
        <PreferenceSwitch id={`${id}-reading`} label="More space between lines" description="Add breathing room to text and form answers." checked={preferences.reading === "spacious"} onChange={checked => onChange({ reading: checked ? "spacious" : "standard" })} />
        <PreferenceSwitch id={`${id}-links`} label="Underline links" description="Make links easier to distinguish from other text." checked={preferences.links === "underlined"} onChange={checked => onChange({ links: checked ? "underlined" : "standard" })} />
        <PreferenceSwitch id={`${id}-motion`} label="Reduce motion" description="Stop decorative movement. Your device’s reduced-motion setting is always respected." checked={preferences.motion === "reduced"} onChange={checked => onChange({ motion: checked ? "reduced" : "system" })} />
      </fieldset>
      <fieldset className="display-setting-group"><legend>Navigation</legend>
        <PreferenceSwitch id={`${id}-navigation`} label="Show navigation labels" description="Keep page names beside their icons on larger screens." checked={preferences.navigation === "expanded"} onChange={checked => onChange({ navigation: checked ? "expanded" : "compact" })} />
      </fieldset>
      {!saved ? <p className="display-settings-storage-message" role="alert">These settings apply now, but this browser could not save them for next time.</p> : null}
    </div>
    <footer className="display-settings-footer"><div><small>Changes apply immediately.</small><small>{saved ? "Saved in this browser. Your records are unaffected." : "Applied for this visit. Your records are unaffected."}</small></div>
      <button type="button" className="button button-quiet" onClick={onReset}><RotateCcw size={16} aria-hidden="true" />Reset display settings</button>
      <button type="button" className="button button-primary" onClick={onClose}>Done</button>
    </footer>
  </ModalDialog>;
}

function PreferenceSwitch({ id, label, description, checked, onChange }: {
  id: string; label: string; description: string; checked: boolean; onChange: (checked: boolean) => void;
}) {
  return <label className="display-preference-switch" htmlFor={id}>
    <span><strong id={`${id}-label`}>{label}</strong><small id={`${id}-help`}>{description}</small></span>
    <input id={id} type="checkbox" role="switch" checked={checked} aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} onChange={event => onChange(event.target.checked)} />
    <span className="display-preference-switch-track" aria-hidden="true"><span /></span>
  </label>;
}
