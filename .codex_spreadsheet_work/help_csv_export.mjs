import { Workbook } from "@oai/artifact-tool";

const workbook = Workbook.create();
workbook.worksheets.add("Students");
console.log(workbook.help("*", { search: "CSV|exportCsv|toCSV|comma-separated", include: "index,examples,notes", maxChars: 8000 }).ndjson);
