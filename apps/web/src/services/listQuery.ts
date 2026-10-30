export type ListValue = string | number | boolean | Date | null | undefined;
export type ListDirection = "asc" | "desc";
const collator = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });
const absent = (value: ListValue) => value == null || value === "" || value instanceof Date && Number.isNaN(value.getTime()) || typeof value === "number" && Number.isNaN(value);

/** Empty values stay last in either direction. Text sorts naturally (Room 2 before Room 10). */
export function compareListValues(left: ListValue, right: ListValue, direction: ListDirection = "asc"): number {
  if (absent(left) || absent(right)) return absent(left) === absent(right) ? 0 : absent(left) ? 1 : -1;
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  const result = typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  return direction === "desc" ? -result : result;
}

/** Sort a copy, with a deterministic identity/name tie break and original-order final fallback. */
export function sortListRows<T>(rows: readonly T[], value: (row: T) => ListValue, direction: ListDirection = "asc", tieBreak?: (row: T) => ListValue): T[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => compareListValues(value(a.row), value(b.row), direction)
    || (tieBreak ? compareListValues(tieBreak(a.row), tieBreak(b.row)) : 0) || a.index - b.index).map(item => item.row);
}

export function normalizeListSearch(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-GB").trim();
}

/** Match every search term across supplied business fields, including nested multi-value labels. */
export function matchesListSearch(query: string, ...values: unknown[]): boolean {
  const terms = normalizeListSearch(query).split(/\s+/).filter(Boolean);
  const flatten = (value: unknown): string => Array.isArray(value) ? value.map(flatten).join(" ") : value == null ? "" : typeof value === "object" && !(value instanceof Date) ? Object.values(value).map(flatten).join(" ") : String(value);
  const haystack = normalizeListSearch(values.map(flatten).join(" "));
  return terms.every(term => haystack.includes(term));
}

/** Choices come from the complete permitted source, before table filters or pagination. */
export function distinctListValues(values: readonly (string | null | undefined)[]): string[] {
  return [...new Map(values.filter((value): value is string => Boolean(value?.trim())).map(value => [normalizeListSearch(value), value])).values()]
    .sort((left, right) => compareListValues(left, right));
}

export function listDateRangeError(query: { fromDate?: string; toDate?: string }): string {
  return query.fromDate && query.toDate && query.fromDate > query.toDate
    ? "The to date must be on or after the from date." : "";
}
