import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sources = [
  { file: "C:/Users/Harry/Downloads/CURC English.xlsx", label: "CURC English" },
  { file: "C:/Users/Harry/Downloads/CURC Maths.xlsx", label: "CURC Maths" },
  { file: "C:/Users/Harry/Downloads/E&M TImetables 28.8.26 FINAL.xlsx", label: "E&M Timetables" },
  { file: "C:/Users/Harry/Downloads/FPST ENGLISH AND MATHS GROUPINGS.xlsx", label: "FPST Groupings" },
  { file: "C:/Users/Harry/Downloads/M+E Groups - New CUCB.xlsx", label: "CUCB Groups" },
];

function text(value) {
  return value == null ? "" : String(value).trim();
}

function normalizedName(value) {
  return text(value)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ");
}

function normalizeId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return text(value).replace(/\.0+$/, "");
}

function findHeader(values) {
  for (let rowIndex = 0; rowIndex < Math.min(values.length, 15); rowIndex += 1) {
    const row = values[rowIndex].map((v) => text(v).toLowerCase());
    const perCode = row.indexOf("percode");
    const learner = row.indexOf("learner");
    const childGroup = row.indexOf("child group");
    if (perCode >= 0 && learner >= 0 && childGroup >= 0) return { rowIndex, perCode, learner, childGroup };
  }
  return null;
}

function isUsableGroup(value) {
  const group = text(value);
  return group !== "" && !/^\d+(?:\.0+)?$/.test(group);
}

const people = new Map();
const sheets = [];
const allAssignments = [];

for (const source of sources) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source.file));
  for (const sheet of workbook.worksheets.items) {
    const values = sheet.getUsedRange(true)?.values ?? [];
    const header = findHeader(values);
    if (!header) {
      sheets.push({ source: source.label, sheet: sheet.name, skipped: true, reason: "No PerCode/Learner/Child Group header" });
      continue;
    }

    let sourceRows = 0;
    let usableAssignments = 0;
    let blankGroups = 0;
    let numericGroups = 0;
    const groupCounts = new Map();
    for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex];
      const upn = normalizeId(row[header.perCode]);
      const learner = normalizedName(row[header.learner]);
      const rawGroup = text(row[header.childGroup]);
      if (!upn || !learner) continue;
      sourceRows += 1;

      if (!people.has(upn)) people.set(upn, { names: new Map(), groups: new Set(), sourceRows: [] });
      const person = people.get(upn);
      person.names.set(learner, (person.names.get(learner) ?? 0) + 1);
      person.sourceRows.push({ source: source.label, sheet: sheet.name, row: rowIndex + 1, learner, rawGroup });

      if (!rawGroup) {
        blankGroups += 1;
      } else if (!isUsableGroup(rawGroup)) {
        numericGroups += 1;
      } else {
        usableAssignments += 1;
        person.groups.add(rawGroup);
        groupCounts.set(rawGroup, (groupCounts.get(rawGroup) ?? 0) + 1);
        allAssignments.push({ upn, learner, group: rawGroup, source: source.label, sheet: sheet.name, row: rowIndex + 1 });
      }
    }

    sheets.push({
      source: source.label,
      sheet: sheet.name,
      skipped: false,
      sourceRows,
      usableAssignments,
      blankGroups,
      numericGroups,
      distinctGroups: groupCounts.size,
      groups: [...groupCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([group, count]) => ({ group, count })),
    });
  }
}

const nameConflicts = [];
const noClassPeople = [];
const multiClass = [];
for (const [upn, person] of people.entries()) {
  if (person.names.size > 1) nameConflicts.push({ upn, names: [...person.names.entries()], sources: person.sourceRows });
  if (person.groups.size === 0) noClassPeople.push({ upn, names: [...person.names.entries()], sources: person.sourceRows });
  if (person.groups.size > 2) multiClass.push({ upn, names: [...person.names.entries()], groups: [...person.groups], sources: person.sourceRows });
}

const assignmentKeys = new Set();
let duplicateAssignmentRows = 0;
for (const item of allAssignments) {
  const key = `${item.upn}\u0000${item.group}`;
  if (assignmentKeys.has(key)) duplicateAssignmentRows += 1;
  assignmentKeys.add(key);
}

const report = {
  totals: {
    uniquePeople: people.size,
    peopleWithAtLeastOneClass: [...people.values()].filter((p) => p.groups.size > 0).length,
    peopleWithNoUsableClass: noClassPeople.length,
    distinctAssignments: assignmentKeys.size,
    duplicateAssignmentRows,
    nameConflictCount: nameConflicts.length,
    moreThanTwoClassesCount: multiClass.length,
  },
  sheets,
  nameConflicts: nameConflicts.slice(0, 50),
  noClassPeople: noClassPeople.slice(0, 50),
  moreThanTwoClasses: multiClass.slice(0, 50),
};

console.log(JSON.stringify(report, null, 2));
