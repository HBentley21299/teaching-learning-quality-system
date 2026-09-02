import fs from "node:fs/promises";
import { Workbook } from "@oai/artifact-tool";

const inputPath = "C:/Users/Harry/OneDrive/Documents/New project 2/outputs/01a052e2-5225-7902-887e-358626f8edd1/CENTURY_students_collated.csv";
const previewPath = "C:/Users/Harry/OneDrive/Documents/New project 2/.codex_spreadsheet_work/CENTURY_students_before_email_update.png";
const csvText = (await fs.readFile(inputPath, "utf8")).replace(/^\uFEFF/, "");
const workbook = await Workbook.fromCSV(csvText, { sheetName: "Students" });
const sheet = workbook.worksheets.getItem("Students");
const rows = sheet.getUsedRange(true)?.values ?? [];
for (const [column, width] of Object.entries({ A: 12, B: 24, C: 20, D: 30, E: 22, F: 36, G: 18, H: 15, I: 10, J: 18, K: 14, L: 20, M: 16, N: 10, O: 16, P: 12 })) {
  sheet.getRange(`${column}1:${column}${rows.length}`).format.columnWidth = width;
}
sheet.getRange("A1:P1").format = { fill: "#1F4E78", font: { bold: true, color: "#FFFFFF" } };
const preview = await workbook.render({ sheetName: "Students", range: "A1:P20", scale: 1, format: "png" });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
const inspection = await workbook.inspect({ kind: "table", range: "Students!A1:G8", include: "values,formulas", tableMaxRows: 8, tableMaxCols: 7, maxChars: 7000 });
console.log(JSON.stringify({ previewPath, rowCount: rows.length - 1, inspection: inspection.ndjson }, null, 2));
