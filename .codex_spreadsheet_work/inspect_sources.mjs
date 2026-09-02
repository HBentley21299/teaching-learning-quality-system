import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const sources = [
  "C:/Users/Harry/Downloads/CURC English.xlsx",
  "C:/Users/Harry/Downloads/CURC Maths.xlsx",
  "C:/Users/Harry/Downloads/E&M TImetables 28.8.26 FINAL.xlsx",
  "C:/Users/Harry/Downloads/FPST ENGLISH AND MATHS GROUPINGS.xlsx",
  "C:/Users/Harry/Downloads/M+E Groups - New CUCB.xlsx",
];
const csvPath = "C:/Users/Harry/Downloads/students_template.csv";
const previewDir = "C:/Users/Harry/OneDrive/Documents/New project 2/.codex_spreadsheet_work/source_previews";
await fs.mkdir(previewDir, { recursive: true });

async function summarizeXlsx(filePath) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
  const sheetInfo = [];
  for (let index = 0; index < workbook.worksheets.items.length; index += 1) {
    const sheet = workbook.worksheets.getItemAt(index);
    const used = sheet.getUsedRange(true);
    const values = used ? used.values : [];
    const rowCount = values.length;
    const colCount = values.reduce((max, row) => Math.max(max, row.length), 0);
    const sample = values.slice(0, 20).map((row) => row.slice(0, 20));
    const safeBase = path.basename(filePath, path.extname(filePath)).replace(/[^A-Za-z0-9_-]+/g, "_");
    const safeSheet = sheet.name.replace(/[^A-Za-z0-9_-]+/g, "_");
    const previewPath = path.join(previewDir, `${safeBase}__${index + 1}_${safeSheet}.png`);
    const preview = await workbook.render({ sheetName: sheet.name, autoCrop: "all", scale: 0.8, format: "png" });
    await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
    sheetInfo.push({ name: sheet.name, rowCount, colCount, sample, previewPath });
  }
  return { file: filePath, sheets: sheetInfo };
}

const workbooks = [];
for (const source of sources) workbooks.push(await summarizeXlsx(source));

const csvText = await fs.readFile(csvPath, "utf8");
const csvWorkbook = await Workbook.fromCSV(csvText, { sheetName: "Students" });
const csvSheet = csvWorkbook.worksheets.getItem("Students");
const csvValues = csvSheet.getUsedRange(true)?.values ?? [];
const csvPreview = await csvWorkbook.render({ sheetName: "Students", autoCrop: "all", scale: 1.5, format: "png" });
const csvPreviewPath = path.join(previewDir, "students_template.png");
await fs.writeFile(csvPreviewPath, new Uint8Array(await csvPreview.arrayBuffer()));

console.log(JSON.stringify({ workbooks, template: { file: csvPath, values: csvValues, previewPath: csvPreviewPath } }, null, 2));
