type Kpi = {
  label: string;
  value: string | number;
  tone: "blue" | "green" | "amber" | "red";
};

export function KpiStrip({ items }: { items: Kpi[] }) {
  if (items.length === 0) return null;
  return (
    <dl className="kpi-strip" aria-label="Key metrics">
      {items.map((item) => (
        <div className={`kpi kpi-${item.tone}`} key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

