type ChoiceField = { fieldKey: string; fieldType: string };
export function isCustomChoiceField(field: ChoiceField) {
  return field.fieldKey.startsWith("custom_") && ["multi_select", "checkbox_group"].includes(field.fieldType);
}
/** Read the new JSON format and older pipe values without splitting a JSON answer containing a pipe. */
export function parseChoiceAnswers(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch { /* Older answers use the pipe format. */ }
  return value.split("|").filter(Boolean);
}
export function serializeChoiceAnswers(fieldKey: string, values: string[]) {
  return fieldKey.startsWith("custom_") ? JSON.stringify(values) : values.join("|");
}
export function normalizeFormAnswer(field: ChoiceField, value?: string) {
  return isCustomChoiceField(field) && value?.trim() ? JSON.stringify(parseChoiceAnswers(value)) : value;
}
export function hasFormAnswer(field: ChoiceField, value?: string) {
  return Boolean(value?.trim()) && (!isCustomChoiceField(field) || parseChoiceAnswers(value).length > 0);
}
