import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { Button } from "../design-system/Button";
import { api, type ExportFilters } from "../services/api";

type ExportExcelButtonProps = {
  moduleKey: string;
  filters?: ExportFilters;
};

export function ExportExcelButton({ moduleKey, filters }: ExportExcelButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState("");

  async function download() {
    setIsExporting(true);
    setMessage("");
    const result = await api.exportExcel(moduleKey, filters);
    setIsExporting(false);
    if (!result.ok) setMessage(result.message ?? "The export could not be created.");
  }

  return (
    <span className="export-control">
      <Button disabled={isExporting} icon={Download} onClick={() => void download()}>
        {isExporting ? "Preparing..." : "Export Excel"}
      </Button>
      {message ? <small aria-live="polite" className="error-copy">{message}</small> : null}
    </span>
  );
}

export function ExportWordButton({ recordId }: { recordId: string }) {
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState("");

  async function download() {
    setIsExporting(true);
    setMessage("");
    const result = await api.exportRecordWord(recordId);
    setIsExporting(false);
    if (!result.ok) setMessage(result.message ?? "The report could not be created.");
  }

  return (
    <span className="export-control">
      <Button disabled={isExporting} icon={FileText} onClick={() => void download()}>
        {isExporting ? "Preparing..." : "Export Word"}
      </Button>
      {message ? <small aria-live="polite" className="error-copy">{message}</small> : null}
    </span>
  );
}
