import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const templatePath = "C:/Users/Harry/Downloads/students_template.csv";
const outputDir = "C:/Users/Harry/OneDrive/Documents/New project 2/outputs/01a052e2-5225-7902-887e-358626f8edd1";
const outputPath = path.join(outputDir, "CENTURY_students_collated.csv");
const previewPath = "C:/Users/Harry/OneDrive/Documents/New project 2/.codex_spreadsheet_work/CENTURY_students_collated_preview.png";

const sources = [
  { file: "C:/Users/Harry/Downloads/FPST ENGLISH AND MATHS GROUPINGS.xlsx", label: "FPST Groupings", priority: 0 },
  { file: "C:/Users/Harry/Downloads/CURC English.xlsx", label: "CURC English", priority: 10, fixedSubject: "E" },
  { file: "C:/Users/Harry/Downloads/CURC Maths.xlsx", label: "CURC Maths", priority: 10, fixedSubject: "M" },
  { file: "C:/Users/Harry/Downloads/E&M TImetables 28.8.26 FINAL.xlsx", label: "E&M Timetables", priority: 10 },
  { file: "C:/Users/Harry/Downloads/M+E Groups - New CUCB.xlsx", label: "CUCB Groups", priority: 10 },
];

const expectedHeaders = [
  "UPN", "First Name", "Last Name", "Email", "Username", "Classes", "Password", "Date of Birth",
  "Sex", "Ethnicity", "SEN Status", "SEN Description", "Pupil Premium", "EAL", "Tags", "Year Group",
];

const clean = (value) => value == null ? "" : String(value).trim();
const cleanName = (value) => clean(value).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");
const cleanId = (value) => typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : clean(value).replace(/\.0+$/, "");

function findHeader(values) {
  for (let rowIndex = 0; rowIndex < Math.min(values.length, 15); rowIndex += 1) {
    const row = values[rowIndex].map((value) => clean(value).toLowerCase());
    const header = {
      rowIndex,
      perCode: row.indexOf("percode"),
      learner: row.indexOf("learner"),
      childGroup: row.indexOf("child group"),
      childCourse: row.indexOf("child course"),
      childCourseDesc: row.indexOf("child course desc"),
    };
    if (header.perCode >= 0 && header.learner >= 0 && header.childGroup >= 0) return header;
  }
  return null;
}

function subjectFor(source, sheetName, row, header) {
  if (source.fixedSubject) return source.fixedSubject;
  if (/english/i.test(sheetName)) return "E";
  if (/maths/i.test(sheetName)) return "M";
  const hint = `${clean(row[header.childCourse])} ${clean(row[header.childCourseDesc])}`.toUpperCase();
  if (hint.includes("ENGLISH") || hint.includes("AENG")) return "E";
  if (hint.includes("MATHS") || hint.includes("AMTH")) return "M";
  return "";
}

function isValidGroup(value, subject) {
  return new RegExp(`^${subject}G[A-Z0-9]+$`).test(clean(value));
}

function splitName(fullName) {
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) throw new Error(`Cannot split learner name into first and last name: ${fullName}`);
  const lastName = parts.pop();
  return { firstName: parts.join(" "), lastName };
}

function compareUpn(a, b) {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) - Number(b);
  return a.localeCompare(b);
}

function compareGroups(a, b) {
  const subjectOrder = a[0] === b[0] ? 0 : a[0] === "E" ? -1 : 1;
  return subjectOrder || a.localeCompare(b);
}

function csvCell(value) {
  const stringValue = value == null ? "" : String(value);
  return /[",\r\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

const templateBuffer = await fs.readFile(templatePath);
const templateHasBom = templateBuffer.length >= 3 && templateBuffer[0] === 0xef && templateBuffer[1] === 0xbb && templateBuffer[2] === 0xbf;
const templateText = templateBuffer.toString("utf8").replace(/^\uFEFF/, "");
const templateEol = templateText.includes("\r\n") ? "\r\n" : "\n";
const workbook = await Workbook.fromCSV(templateText, { sheetName: "Students" });
const sheet = workbook.worksheets.getItem("Students");
const templateHeaders = (sheet.getUsedRange(true)?.values?.[0] ?? []).map(clean);
if (JSON.stringify(templateHeaders) !== JSON.stringify(expectedHeaders)) {
  throw new Error(`Template headers do not match the expected CENTURY schema: ${JSON.stringify(templateHeaders)}`);
}

const people = new Map();
const sourceSummary = [];

for (const source of sources) {
  const sourceWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source.file));
  for (const sourceSheet of sourceWorkbook.worksheets.items) {
    const values = sourceSheet.getUsedRange(true)?.values ?? [];
    const header = findHeader(values);
    if (!header) {
      sourceSummary.push({ source: source.label, sheet: sourceSheet.name, skipped: true });
      continue;
    }

    let learnerRows = 0;
    let validAssignments = 0;
    let ignoredPlaceholders = 0;
    for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex];
      const upn = cleanId(row[header.perCode]);
      const learner = cleanName(row[header.learner]);
      if (!upn || !learner) continue;
      const subject = subjectFor(source, sourceSheet.name, row, header);
      if (!subject) continue;
      const group = clean(row[header.childGroup]);
      learnerRows += 1;

      if (!people.has(upn)) {
        people.set(upn, {
          names: new Set(),
          subjects: {
            E: { priority: -1, groups: new Set() },
            M: { priority: -1, groups: new Set() },
          },
        });
      }
      const person = people.get(upn);
      person.names.add(learner);
      const slot = person.subjects[subject];
      if (source.priority > slot.priority) {
        slot.priority = source.priority;
        slot.groups.clear();
      }
      if (source.priority === slot.priority && isValidGroup(group, subject)) {
        slot.groups.add(group);
        validAssignments += 1;
      } else if (!isValidGroup(group, subject)) {
        ignoredPlaceholders += 1;
      }
    }
    sourceSummary.push({ source: source.label, sheet: sourceSheet.name, learnerRows, validAssignments, ignoredPlaceholders });
  }
}

const nameConflicts = [...people.entries()].filter(([, person]) => person.names.size !== 1);
if (nameConflicts.length > 0) {
  throw new Error(`Conflicting learner names found for ${nameConflicts.length} UPN values.`);
}

const outputRows = [];
let excludedWithoutClass = 0;
for (const [upn, person] of [...people.entries()].sort((a, b) => compareUpn(a[0], b[0]))) {
  const groups = [...person.subjects.E.groups, ...person.subjects.M.groups].sort(compareGroups);
  if (groups.length === 0) {
    excludedWithoutClass += 1;
    continue;
  }
  const fullName = [...person.names][0];
  const { firstName, lastName } = splitName(fullName);
  outputRows.push([
    upn, firstName, lastName, `${upn}@live.oldham.ac.uk`, "", groups.join(";"), "", "", "", "", "", "", "", "", "", "",
  ]);
}

const validationErrors = [];
const seenUpns = new Set();
const allowedName = /^[\p{L}\p{M}\p{N} .()\[\]'\-]+$/u;
for (let index = 0; index < outputRows.length; index += 1) {
  const rowNumber = index + 2;
  const [upn, firstName, lastName, email, username, classes, password] = outputRows[index];
  if (!/^\S{1,32}$/.test(upn)) validationErrors.push(`Row ${rowNumber}: invalid UPN`);
  if (seenUpns.has(upn)) validationErrors.push(`Row ${rowNumber}: duplicate UPN ${upn}`);
  seenUpns.add(upn);
  for (const [label, value] of [["First Name", firstName], ["Last Name", lastName]]) {
    if (value.length < 1 || value.length > 64 || !allowedName.test(value)) validationErrors.push(`Row ${rowNumber}: invalid ${label} '${value}'`);
  }
  if (email !== `${upn}@live.oldham.ac.uk` || !/^\d+@live\.oldham\.ac\.uk$/.test(email)) validationErrors.push(`Row ${rowNumber}: invalid Email '${email}'`);
  if (username !== "" || password !== "") validationErrors.push(`Row ${rowNumber}: Username or Password is not blank`);
  const groups = classes.split(";");
  if (groups.some((group) => !/^[EM]G[A-Z0-9]+$/.test(group) || group.length > 200)) validationErrors.push(`Row ${rowNumber}: invalid Classes '${classes}'`);
  if (new Set(groups).size !== groups.length) validationErrors.push(`Row ${rowNumber}: duplicate class within Classes`);
}
if (validationErrors.length > 0) throw new Error(validationErrors.slice(0, 25).join("\n"));

const matrix = [expectedHeaders, ...outputRows];
const previousUsed = sheet.getUsedRange();
if (previousUsed) previousUsed.clear({ applyTo: "all" });
sheet.getRangeByIndexes(0, 0, matrix.length, expectedHeaders.length).values = matrix;
sheet.freezePanes.freezeRows(1);
sheet.showGridLines = false;
sheet.getRange(`A1:P${matrix.length}`).format.font = { name: "Aptos", size: 10 };
sheet.getRange("A1:P1").format = {
  fill: "#1F4E78",
  font: { name: "Aptos", size: 10, bold: true, color: "#FFFFFF" },
  wrapText: true,
  rowHeight: 30,
};
sheet.getRange(`A2:A${matrix.length}`).format.numberFormat = "@";
for (const [column, width] of Object.entries({ A: 12, B: 24, C: 20, D: 24, E: 22, F: 36, G: 18, H: 15, I: 10, J: 18, K: 14, L: 20, M: 16, N: 10, O: 16, P: 12 })) {
  sheet.getRange(`${column}1:${column}${matrix.length}`).format.columnWidth = width;
}

const topInspection = await workbook.inspect({
  kind: "table",
  range: "Students!A1:P12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 16,
  maxChars: 12000,
});
const lastStart = Math.max(2, matrix.length - 9);
const bottomInspection = await workbook.inspect({
  kind: "table",
  range: `Students!A${lastStart}:P${matrix.length}`,
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 16,
  maxChars: 10000,
});
const errorInspection = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
  maxChars: 3000,
});

const preview = await workbook.render({ sheetName: "Students", range: "A1:P35", scale: 1, format: "png" });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const authoredValues = sheet.getUsedRange(true)?.values ?? [];
const csvBody = authoredValues.map((row) => expectedHeaders.map((_, columnIndex) => csvCell(row[columnIndex] ?? "")).join(",")).join(templateEol) + templateEol;
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, `${templateHasBom ? "\uFEFF" : ""}${csvBody}`, "utf8");

const verificationText = (await fs.readFile(outputPath, "utf8")).replace(/^\uFEFF/, "");
const verificationWorkbook = await Workbook.fromCSV(verificationText, { sheetName: "Students" });
const verificationValues = verificationWorkbook.worksheets.getItem("Students").getUsedRange(true)?.values ?? [];
if (verificationValues.length !== matrix.length || verificationValues[0].length !== expectedHeaders.length) {
  throw new Error(`CSV re-import shape mismatch: expected ${matrix.length}x${expectedHeaders.length}, got ${verificationValues.length}x${verificationValues[0]?.length ?? 0}`);
}
for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
  for (let columnIndex = 0; columnIndex < expectedHeaders.length; columnIndex += 1) {
    if (clean(verificationValues[rowIndex][columnIndex]) !== clean(matrix[rowIndex][columnIndex])) {
      throw new Error(`CSV re-import mismatch at row ${rowIndex + 1}, column ${columnIndex + 1}`);
    }
  }
}

const classCounts = outputRows.reduce((counts, row) => {
  const count = row[5].split(";").length;
  counts[count] = (counts[count] ?? 0) + 1;
  return counts;
}, {});

console.log(JSON.stringify({
  outputPath,
  previewPath,
  studentRows: outputRows.length,
  excludedWithoutClass,
  uniqueUpns: seenUpns.size,
  classCounts,
  emailsPopulated: outputRows.length,
  usernameAndPasswordBlank: true,
  sourceSummary,
  topInspection: topInspection.ndjson,
  bottomInspection: bottomInspection.ndjson,
  errorInspection: errorInspection.ndjson,
}, null, 2));
