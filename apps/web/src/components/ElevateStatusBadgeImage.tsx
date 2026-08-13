import { useEffect, useState } from "react";
import { api } from "../services/api";
import type { ElevateStatusLevelSummary } from "../services/types";

const objectUrlCache = new Map<string, Promise<string | null>>();

function defaultAsset(levelKey: ElevateStatusLevelSummary["levelKey"]) {
  return `/system-assets/elevate-status/${levelKey}.png`;
}

function cacheKey(academicYear: string, levelNumber: number, customAssetId: string) {
  return `${academicYear}:${levelNumber}:${customAssetId}`;
}

async function loadCustomAsset(academicYear: string, levelNumber: number) {
  const blob = await api.elevateStatusBadgeContent(academicYear, levelNumber);
  return blob ? URL.createObjectURL(blob) : null;
}

export function invalidateElevateStatusBadgeCache(academicYear: string, levelNumber: number) {
  const prefix = `${academicYear}:${levelNumber}:`;
  for (const [key, value] of objectUrlCache.entries()) {
    if (!key.startsWith(prefix)) continue;
    void value.then((url) => { if (url) URL.revokeObjectURL(url); });
    objectUrlCache.delete(key);
  }
}

export function ElevateStatusBadgeImage({
  academicYear,
  levelNumber,
  levelKey,
  customAssetId,
  alt,
  className,
  ariaHidden = false
}: {
  academicYear: string;
  levelNumber: number;
  levelKey: ElevateStatusLevelSummary["levelKey"];
  customAssetId?: string;
  alt: string;
  className?: string;
  ariaHidden?: boolean;
}) {
  const fallback = defaultAsset(levelKey);
  const [source, setSource] = useState(fallback);

  useEffect(() => {
    let isCurrent = true;
    if (!customAssetId) {
      setSource(fallback);
      return () => { isCurrent = false; };
    }

    const key = cacheKey(academicYear, levelNumber, customAssetId);
    let pending = objectUrlCache.get(key);
    if (!pending) {
      pending = loadCustomAsset(academicYear, levelNumber).catch(() => null);
      objectUrlCache.set(key, pending);
    }
    void pending.then((url) => {
      if (isCurrent) setSource(url ?? fallback);
    });
    return () => { isCurrent = false; };
  }, [academicYear, customAssetId, fallback, levelNumber]);

  return (
    <img
      alt={ariaHidden ? "" : alt}
      aria-hidden={ariaHidden ? "true" : undefined}
      className={className}
      onError={() => setSource(fallback)}
      src={source}
    />
  );
}
