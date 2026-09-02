import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sources = [
  { file: "C:/Users/Harry/Downloads/FPST ENGLISH AND MATHS GROUPINGS.xlsx", label: "FPST Groupings", priority: 0 },
  { file: "C:/Users/Harry/Downloads/CURC English.xlsx", label: "CURC English", priority: 10, fixedSubject: "E" },
  { file: "C:/Users/Harry/Downloads/CURC Maths.xlsx", label: "CURC Maths", priority: 10, fixedSubject: "M" },
  { file: "C:/Users/Harry/Downloads/E&M TImetables 28.8.26 FINAL.xlsx", label: "E&M Timetables", priority: 10 },
  { file: "C:/Users/Harry/Downloads/M+E Groups - New CUCB.xlsx", label: "CUCB Groups", priority: 10 },
];

const clean = (value) => value == null ? "" : String(value).trim();
const cleanName = (value) => clean(value).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");
const cleanId = (value) => typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : clean(value).replace(/\.0+$/, "");

function headerMap(values) {
  for (let rowIndex = 0; rowIndex < Math.min(values.length, 15); rowIndex += 1) {
    const row = values[rowIndex].map((v) => clean(v).toLowerCase());
    const out = {
      rowIndex,
      perCode: row.indexOf("percode"),
      learner: row.indexOf("learner"),
      childGroup: row.indexOf("child group"),
      childCourse: row.indexOf("child course"),
      childCourseDesc: row.indexOf("child course desc"),
    };
    if (out.perCode >= 0 && out.learner >= 0 && out.childGroup >= 0) return out;
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

function validGroup(value, subject) {
  const group = clean(value);
  return new RegExp(`^${subject}G[A-Z0-9]+$`).test(group);
}

const people = new Map();
const unexpectedGroupValues = new Map();

for (const source of sources) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source.file));
  for (const sheet of workbook.worksheets.items) {
    const values = sheet.getUsedRange(true)?.values ?? [];
    const header = headerMap(values);
    if (!header) continue;
    for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex];
      const upn = cleanId(row[header.perCode]);
      const name = cleanName(row[header.learner]);
      if (!upn || !name) continue;
      const subject = subjectFor(source, sheet.name, row, header);
      if (!subject) continue;
      const group = clean(row[header.childGroup]);
      if (!people.has(upn)) people.set(upn, { name, subjects: { E: { priority: -1, groups: new Set(), rows: [] }, M: { priority: -1, groups: new Set(), rows: [] } } });
      const slot = people.get(upn).subjects[subject];
      if (source.priority > slot.priority) {
        slot.priority = source.priority;
        slot.groups.clear();
        slot.rows = [];
      }
      if (source.priority === slot.priority) {
        slot.rows.push({ source: source.label, sheet: sheet.name, row: rowIndex + 1, rawGroup: group });
        if (validGroup(group, subject)) slot.groups.add(group);
      }
      if (group && !validGroup(group, subject)) {
        const key = `${source.label}\u0000${sheet.name}\u0000${subject}\u0000${group}`;
        unexpectedGroupValues.set(key, (unexpectedGroupValues.get(key) ?? 0) + 1);
      }
    }
  }
}

const distribution = { 0: 0, 1: 0, 2: 0, moreThan2: 0 };
const multipleSameSubject = [];
for (const [upn, person] of people.entries()) {
  const e = [...person.subjects.E.groups];
  const m = [...person.subjects.M.groups];
  const count = e.length + m.length;
  if (count <= 2) distribution[count] += 1;
  else distribution.moreThan2 += 1;
  if (e.length > 1 || m.length > 1) multipleSameSubject.push({ upn, name: person.name, english: e, maths: m, detail: person.subjects });
}

console.log(JSON.stringify({
  uniquePeople: people.size,
  classCountDistribution: distribution,
  multipleSameSubjectCount: multipleSameSubject.length,
  multipleSameSubject: multipleSameSubject.slice(0, 100),
  unexpectedGroupValues: [...unexpectedGroupValues.entries()].map(([key, count]) => {
    const [source, sheet, subject, value] = key.split("\u0000");
    return { source, sheet, subject, value, count };
  }),
}, null, 2));
