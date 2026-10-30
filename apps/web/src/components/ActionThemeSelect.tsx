import { useEffect, useMemo, useState, type AriaAttributes } from "react";
import { api } from "../services/api";
import { LoadingState } from "./LoadingState";
import type { LookupValueSummary } from "../services/types";

export function ActionThemeSelect({
  disabled = false,
  id,
  onChange,
  sourceFormType,
  value,
  "aria-invalid": ariaInvalid,
  "aria-describedby": describedBy,
  "aria-required": ariaRequired
}: {
  disabled?: boolean;
  id: string;
  onChange: (value: string) => void;
  sourceFormType: string;
  value: string;
} & Pick<AriaAttributes, "aria-invalid" | "aria-describedby" | "aria-required">) {
  const [options, setOptions] = useState<LookupValueSummary[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setLoading(true);
    setOptions([]);
    void api.actionThemes(sourceFormType)
      .then((nextOptions) => {
        if (!cancelled) { setOptions(nextOptions); setLoading(false); }
      })
      .catch(() => {
        if (!cancelled) { setFailed(true); setLoading(false); }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceFormType, attempt]);

  const includesCurrentValue = useMemo(
    () => options.some((option) => option.displayName === value),
    [options, value]
  );

  return (
    <>
      <select
        disabled={disabled || failed || loading}
        aria-busy={loading || undefined}
        aria-describedby={[failed ? `${id}-status` : "", describedBy].filter(Boolean).join(" ") || undefined}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">{loading ? "Loading themes…" : failed ? "Themes unavailable" : "Select action theme"}</option>
        {value && !includesCurrentValue ? <option value={value}>{value} (existing)</option> : null}
        {options.map((option) => (
          <option key={option.id} value={option.displayName}>{option.displayName}</option>
        ))}
      </select>
      {loading ? <LoadingState size="inline" label="Loading action themes…" /> : null}
      {failed ? <small id={`${id}-status`} className="error-copy" role="alert">Action themes could not be loaded. <button className="button button-quiet" disabled={disabled} onClick={() => setAttempt(current => current + 1)} type="button">Try again</button></small> : null}
    </>
  );
}
