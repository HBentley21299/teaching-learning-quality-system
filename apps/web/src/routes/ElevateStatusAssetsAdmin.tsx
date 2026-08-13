import { Image as ImageIcon, RotateCcw, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { ElevateStatusBadgeImage, invalidateElevateStatusBadgeCache } from "../components/ElevateStatusBadgeImage";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { AcademicYearSummary, ElevateStatusBadgeAssetSummary } from "../services/types";

const maximumFileSize = 5 * 1024 * 1024;
const acceptedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export function ElevateStatusAssetsAdmin() {
  const [academicYears, setAcademicYears] = useState<AcademicYearSummary[]>([]);
  const [academicYear, setAcademicYear] = useState("");
  const [assets, setAssets] = useState<ElevateStatusBadgeAssetSummary[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Record<number, File | undefined>>({});
  const [busyLevel, setBusyLevel] = useState<number>();
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api.academicYears()
      .then((years) => {
        if (cancelled) return;
        setAcademicYears(years);
        setAcademicYear(years.find((year) => year.isCurrent)?.academicYear ?? years[0]?.academicYear ?? "");
      })
      .catch(() => { if (!cancelled) setStatus("Academic years could not be loaded."); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!academicYear) return;
    let cancelled = false;
    setStatus("");
    setSelectedFiles({});
    void api.elevateStatusBadgeAssets(academicYear)
      .then((nextAssets) => { if (!cancelled) setAssets(nextAssets); })
      .catch(() => { if (!cancelled) setStatus("Elevate Status artwork could not be loaded."); });
    return () => { cancelled = true; };
  }, [academicYear]);

  async function chooseFile(levelNumber: number, file?: File) {
    setStatus("");
    if (!file) {
      setSelectedFiles((current) => ({ ...current, [levelNumber]: undefined }));
      return;
    }
    if (!acceptedTypes.has(file.type)) {
      setStatus("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > maximumFileSize) {
      setStatus("Badge images must be no larger than 5 MB.");
      return;
    }
    try {
      const image = await createImageBitmap(file);
      const isRenderable = image.width > 0 && image.height > 0;
      image.close();
      if (!isRenderable) throw new Error("Image has no displayable dimensions.");
    } catch {
      setStatus("That file could not be rendered as an image. Choose another PNG, JPEG or WebP file.");
      return;
    }
    setSelectedFiles((current) => ({ ...current, [levelNumber]: file }));
  }

  async function upload(levelNumber: number) {
    const file = selectedFiles[levelNumber];
    if (!file) return;
    setBusyLevel(levelNumber);
    setStatus("");
    const result = await api.uploadElevateStatusBadge(academicYear, levelNumber, file);
    setBusyLevel(undefined);
    if (!result.ok || !result.data) {
      setStatus(result.message ?? "The badge image could not be uploaded.");
      return;
    }
    invalidateElevateStatusBadgeCache(academicYear, levelNumber);
    setAssets(result.data);
    setSelectedFiles((current) => ({ ...current, [levelNumber]: undefined }));
    setStatus(`Level ${levelNumber} artwork updated for ${academicYear}.`);
  }

  async function reset(levelNumber: number) {
    if (!window.confirm(`Use the built-in Level ${levelNumber} artwork for ${academicYear}? The uploaded version will remain in the audit history.`)) return;
    setBusyLevel(levelNumber);
    setStatus("");
    const result = await api.resetElevateStatusBadge(academicYear, levelNumber);
    setBusyLevel(undefined);
    if (!result.ok || !result.data) {
      setStatus(result.message ?? "The badge image could not be reset.");
      return;
    }
    invalidateElevateStatusBadgeCache(academicYear, levelNumber);
    setAssets(result.data);
    setStatus(`Level ${levelNumber} now uses the built-in artwork for ${academicYear}.`);
  }

  return (
    <section className="panel elevate-status-assets-admin">
      <div className="panel-heading elevate-status-assets-heading">
        <div>
          <p className="eyebrow"><ImageIcon aria-hidden="true" size={15} />Elevate Status</p>
          <h2>Academic-year badge artwork</h2>
          <p className="muted-copy">Artwork is stored against the selected academic year. Updating this year will not alter badges shown on earlier profiles or dashboards.</p>
        </div>
        <label className="entry-field elevate-status-year-select">
          <span>Academic year</span>
          <select onChange={(event) => setAcademicYear(event.target.value)} value={academicYear}>
            {academicYears.map((year) => <option key={year.academicYear} value={year.academicYear}>{year.academicYear}{year.isCurrent ? " (current)" : ""}</option>)}
          </select>
        </label>
      </div>

      <div className="elevate-status-asset-grid">
        {assets.map((asset) => (
          <article className="elevate-status-asset-card" key={asset.levelNumber}>
            <div className="elevate-status-asset-preview">
              <ElevateStatusBadgeImage
                academicYear={academicYear}
                alt={`${asset.levelName} artwork`}
                customAssetId={asset.customAssetId}
                levelKey={asset.levelKey}
                levelNumber={asset.levelNumber}
              />
            </div>
            <div className="elevate-status-asset-copy">
              <span>Level {asset.levelNumber}</span>
              <h3>{asset.levelName}</h3>
              <p>{asset.customAssetId
                ? `${asset.fileName} · ${formatBytes(asset.contentLength ?? 0)}`
                : "Built-in artwork"}</p>
              {asset.uploadedAt ? <small>Uploaded {formatDateTime(asset.uploadedAt)} by {asset.uploadedByName}</small> : <small>Used when no year-specific image is uploaded.</small>}
            </div>
            <label className="elevate-status-file-input">
              <span>Replacement image</span>
              <input
                accept="image/png,image/jpeg,image/webp"
                disabled={busyLevel !== undefined}
                key={`${academicYear}-${asset.levelNumber}-${asset.customAssetId ?? "default"}`}
                onChange={(event) => void chooseFile(asset.levelNumber, event.target.files?.[0])}
                type="file"
              />
              <small>{selectedFiles[asset.levelNumber]?.name ?? "PNG, JPEG or WebP · maximum 5 MB"}</small>
            </label>
            <div className="button-row">
              <Button
                disabled={!selectedFiles[asset.levelNumber] || busyLevel !== undefined}
                icon={Upload}
                onClick={() => void upload(asset.levelNumber)}
                variant="primary"
              >
                {busyLevel === asset.levelNumber ? "Uploading..." : "Upload image"}
              </Button>
              {asset.customAssetId ? <Button
                disabled={busyLevel !== undefined}
                icon={RotateCcw}
                onClick={() => void reset(asset.levelNumber)}
                variant="quiet"
              >Use built-in</Button> : null}
            </div>
          </article>
        ))}
      </div>
      {status ? <p className="form-status" role="status">{status}</p> : null}
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
