import type { AdminCsvImportKind, CurrentUser } from "./types";

export const csvImportFileLimit = 1024 * 1024;

export function canUseAdminCsvImport(user: CurrentUser | undefined, kind: AdminCsvImportKind) {
  if (user?.isAdministrator !== true) return false;
  const required = kind === "qa-questions" ? ["qa_reviews.manage"] : kind === "cpd-events" ? ["cpd.manage", "cpd.mandatory_log"] : ["lists.manage"];
  return required.some(permission => user.permissions.includes(permission));
}

/** Quote every cell, keep Excel's UTF-8 marker, and neutralise formula-like content in error/reference downloads. */
export function csvImportDownloadText(columns: string[], rows: Array<Array<string | number | null | undefined>>) {
  const cell = (value: string | number | null | undefined) => {
    const text = String(value ?? "");
    const safe = /^[\s\uFEFF]*[=+\-@]/u.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [columns, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function saveCsvImportDownload(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function readCsvImportFile(file: Pick<File, "name" | "size" | "arrayBuffer">) {
  if (!file.name.toLocaleLowerCase().endsWith(".csv")) throw new Error("Choose a CSV file saved as CSV UTF-8.");
  if (file.size > csvImportFileLimit) throw new Error("Choose a CSV file no larger than 1 MiB.");
  if (file.size === 0) throw new Error("This file is empty. Download a template and add your rows.");
  let csv: string;
  try { csv = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error("This file could not be read as UTF-8. Save it as CSV UTF-8 and choose it again."); }
  if (!csv.trim()) throw new Error("This file is empty. Download a template and add your rows.");
  return csv;
}
