import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { ActionOwnerOption } from "../services/types";

export function useActionOwners(recordId?: string, subjectStaffId?: string, process?: string, enabled = true) {
  const [owners, setOwners] = useState<ActionOwnerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const retry = useCallback(async () => {
    const request = ++generation.current;
    if (!enabled) { setOwners([]); setLoading(false); setError(""); return; }
    setLoading(true); setError(""); setOwners([]);
    try { const result = await api.actionOwnerOptions(recordId, subjectStaffId, process); if (request === generation.current) setOwners(result); }
    catch { if (request === generation.current) setError("Action owners could not be loaded. Your changes are still here. Try loading the owners again."); }
    finally { if (request === generation.current) setLoading(false); }
  }, [recordId, subjectStaffId, process, enabled]);
  useEffect(() => { void retry(); return () => { generation.current++; }; }, [retry]);
  return { owners, loading, error, retry };
}
