import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import type { LookupValueSummary } from "../services/types";

export function ActionThemeSelect({
  disabled = false,
  id,
  onChange,
  sourceFormType,
  value
}: {
  disabled?: boolean;
  id: string;
  onChange: (value: string) => void;
  sourceFormType: string;
  value: string;
}) {
  const [options, setOptions] = useState<LookupValueSummary[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void api.actionThemes(sourceFormType)
      .then((nextOptions) => {
        if (!cancelled) setOptions(nextOptions);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceFormType]);

  const includesCurrentValue = useMemo(
    () => options.some((option) => option.displayName === value),
    [options, value]
  );

  return (
    <>
      <select
        disabled={disabled || failed}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">{failed ? "Themes unavailable" : "Select action theme"}</option>
        {value && !includesCurrentValue ? <option value={value}>{value} (existing)</option> : null}
        {options.map((option) => (
          <option key={option.id} value={option.displayName}>{option.displayName}</option>
        ))}
      </select>
      {failed ? <small>Action themes could not be loaded.</small> : null}
    </>
  );
}
