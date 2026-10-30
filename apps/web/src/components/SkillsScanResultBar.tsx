import "./SkillsScanResultBar.css";

/** Read-only result on the Skills Scan's 1–5 scale, with room for the marker at both ends. */
export function SkillsScanResultBar({ value, label, axis = true }: { value: number; label: string; axis?: boolean }) {
  if (!Number.isFinite(value) || value < 1 || value > 5) return null;
  const position = `${(value - 1) / 4 * 100}%`;
  return <div className="skills-scan-result-graphic">
    <div className="skills-scan-result-meter" role="meter" aria-label={label} aria-valuemin={1} aria-valuemax={5} aria-valuenow={value}>
      <div className="skills-scan-result-track">
        <span className="skills-scan-result-fill" style={{ width: position }} aria-hidden="true" />
        <span className="skills-scan-result-ball" style={{ left: position }} aria-hidden="true" />
      </div>
    </div>
    {axis ? <div className="skills-scan-result-axis" aria-hidden="true"><span>1</span><span>5</span></div> : null}
  </div>;
}
