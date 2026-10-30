import { useEffect, useState } from "react";
import defaults from "../../../../shared/workflow-form-content.json";
import { api } from "./api";
import type { WorkflowFormContent } from "./types";

const requests = new Map<string, { expires: number; promise: Promise<WorkflowFormContent> }>();
export function invalidateFormContent(formKey: string) { requests.delete(formKey); }
function load(formKey: string) {
  const existing = requests.get(formKey);
  if (existing && existing.expires > Date.now()) return existing.promise;
  const promise = api.formContent(formKey).catch(error => { requests.delete(formKey); throw error; });
  requests.set(formKey, { expires: Date.now() + 60_000, promise });
  return promise;
}
/** Wording is supplementary configuration; the real form and answers remain usable if it cannot be read. */
export function useFormContent(formKey: string) {
  const [saved, setSaved] = useState<WorkflowFormContent | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSaved(null);
    void load(formKey).then(content => { if (!cancelled) setSaved(content); }).catch(() => { /* Use the shipped wording when configuration is unavailable. */ });
    return () => { cancelled = true; };
  }, [formKey]);
  const content = saved?.formKey === formKey ? saved : defaults.find(form => form.formKey === formKey);
  return { field(key: string, fallbackLabel: string, fallbackHelp?: string) {
    const field = content?.fields.find(field => field.key === key);
    return { label: field?.label ?? fallbackLabel, helpText: field ? field.helpText : fallbackHelp };
  } };
}
