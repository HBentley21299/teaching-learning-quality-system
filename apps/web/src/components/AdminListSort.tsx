export function AdminListSort({ value, onChange, options, label = "Sort by", disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  label?: string;
  disabled?: boolean;
}) {
  return <label className="entry-field"><span>{label}</span><select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}
