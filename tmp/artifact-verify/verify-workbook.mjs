import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/Harry/OneDrive/Documents/New project 2/tmp/spreadsheets/learning-walks.xlsx";
const previewPath = "C:/Users/Harry/OneDrive/Documents/New project 2/tmp/spreadsheets/learning-walks-question-level.png";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 8000,
  tableMaxRows: 4,
  tableMaxCols: 8,
  tableMaxCellChars: 100
});
const formulae = await workbook.inspect({
  kind: "formula",
  sheetId: "Question-Level Results",
  range: "A1:Z200",
  maxChars: 2500,
  options: { maxResults: 100 }
});
const preview = await workbook.render({
  sheetName: "Question-Level Results",
  autoCrop: "all",
  scale: 1,
  format: "png"
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

process.stdout.write(JSON.stringify({ summary, formulae, previewPath }, null, 2));
