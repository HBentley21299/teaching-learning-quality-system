import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sources = [
  "C:/Users/Harry/Downloads/CURC English.xlsx",
  "C:/Users/Harry/Downloads/CURC Maths.xlsx",
  "C:/Users/Harry/Downloads/E&M TImetables 28.8.26 FINAL.xlsx",
  "C:/Users/Harry/Downloads/FPST ENGLISH AND MATHS GROUPINGS.xlsx",
  "C:/Users/Harry/Downloads/M+E Groups - New CUCB.xlsx",
];
const outputDir = "C:/Users/Harry/OneDrive/Documents/New project 2/.codex_spreadsheet_work/source_sample_previews";
await fs.mkdir(outputDir, { recursive: true });

for (const filePath of sources) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
  for (let index = 0; index < workbook.worksheets.items.length; index += 1) {
    const sheet = workbook.worksheets.getItemAt(index);
    const used = sheet.getUsedRange(true);
    const rows = used?.values?.length ?? 1;
    const cols = used?.values?.reduce((m, row) => Math.max(m, row.length), 0) ?? 1;
    const endRow = Math.min(rows, 45);
    const endColNumber = Math.min(cols, 26);
    let n = endColNumber;
    let endCol = "";
    while (n > 0) {
      n -= 1;
      endCol = String.fromCharCode(65 + (n % 26)) + endCol;
      n = Math.floor(n / 26);
    }
    const safeBase = path.basename(filePath, path.extname(filePath)).replace(/[^A-Za-z0-9_-]+/g, "_");
    const safeSheet = sheet.name.replace(/[^A-Za-z0-9_-]+/g, "_");
    const outPath = path.join(outputDir, `${safeBase}__${index + 1}_${safeSheet}.png`);
    const preview = await workbook.render({ sheetName: sheet.name, range: `A1:${endCol}${endRow}`, scale: 1, format: "png" });
    await fs.writeFile(outPath, new Uint8Array(await preview.arrayBuffer()));
    console.log(outPath);
  }
}
