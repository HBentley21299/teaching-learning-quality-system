type Kpi = {
  label: string;
  value: string | number;
  tone: "blue" | "green" | "amber" | "red";
};

export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <section className="kpi-strip" aria-label="Key metrics">
      {items.map((item) => (
        <div className={`kpi kpi-${item.tone}`} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </section>
  );
}

