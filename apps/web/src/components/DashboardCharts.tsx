const chartColors = ["#0F766E", "#2563EB", "#7C3AED", "#D97706", "#DC2626", "#0891B2", "#4D7C0F", "#BE185D"];

export type ChartDatum = { label: string; value: number; detail?: string };

export function MonthlyActivityChart({
  title,
  subtitle,
  data,
  recordType
}: {
  title: string;
  subtitle: string;
  data: ChartDatum[];
  recordType: string;
}) {
  const maximum = Math.max(...data.map((item) => item.value), 1);
  const width = 640;
  const height = 250;
  const plotLeft = 58;
  const plotTop = 18;
  const plotWidth = 550;
  const plotHeight = 176;
  const barGap = 8;
  const barWidth = data.length ? Math.max((plotWidth - barGap * data.length) / data.length, 3) : 0;
  const tickValues = Array.from(new Set([0, Math.ceil(maximum / 2), maximum])).sort((a, b) => a - b);

  return (
    <section className="panel dashboard-chart-panel">
      <div className="panel-heading"><h2>{title}</h2><span>{subtitle}</span></div>
      {data.length === 0 ? <div className="empty-row">No data in the current view.</div> : (
        <div className="chart-shell">
          <svg aria-labelledby="activity-chart-title activity-chart-desc" className="activity-chart" role="img" viewBox={`0 0 ${width} ${height}`}>
            <title id="activity-chart-title">{title}</title>
            <desc id="activity-chart-desc">Calendar month on the horizontal axis and record count on the vertical axis for {recordType}.</desc>
            {tickValues.map((tick) => {
              const y = plotTop + plotHeight - (tick / maximum) * plotHeight;
              return <g key={tick}><line className="chart-grid-line" x1={plotLeft} x2={plotLeft + plotWidth} y1={y} y2={y} /><text className="chart-tick" textAnchor="end" x={plotLeft - 8} y={y + 4}>{tick}</text></g>;
            })}
            <line className="chart-axis" x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotTop + plotHeight} />
            <line className="chart-axis" x1={plotLeft} x2={plotLeft + plotWidth} y1={plotTop + plotHeight} y2={plotTop + plotHeight} />
            {data.map((item, index) => {
              const x = plotLeft + index * (barWidth + barGap) + barGap / 2;
              const renderedHeight = (item.value / maximum) * plotHeight;
              return (
                <g aria-label={`${item.label}: ${item.value} ${recordType} records`} key={item.label} role="graphics-symbol" tabIndex={0}>
                  <title>{`${item.label} - ${item.value} ${recordType} ${item.value === 1 ? "record" : "records"}`}</title>
                  <rect className="activity-chart-bar" height={renderedHeight} rx="3" width={barWidth} x={x} y={plotTop + plotHeight - renderedHeight} />
                  <text className="chart-tick chart-month-tick" textAnchor="middle" x={x + barWidth / 2} y={plotTop + plotHeight + 17}>{item.label}</text>
                </g>
              );
            })}
            <text className="chart-axis-label" textAnchor="middle" x={plotLeft + plotWidth / 2} y={height - 4}>Calendar month</text>
            <text className="chart-axis-label" textAnchor="middle" transform={`rotate(-90 14 ${plotTop + plotHeight / 2})`} x={14} y={plotTop + plotHeight / 2}>Number of records</text>
          </svg>
        </div>
      )}
    </section>
  );
}

export function AccessiblePieChart({ title, subtitle, data }: { title: string; subtitle: string; data: ChartDatum[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let currentAngle = -Math.PI / 2;
  const radius = 74;
  const center = 90;
  return (
    <section className="panel dashboard-chart-panel pie-chart-panel">
      <div className="panel-heading"><h2>{title}</h2><span>{subtitle}</span></div>
      {total === 0 ? <div className="empty-row">No data in the current view.</div> : (
        <div className="pie-chart-layout">
          <svg aria-label={`${title}. Total ${total}.`} className="pie-chart" role="img" viewBox="0 0 180 180">
            {data.map((item, index) => {
              const startAngle = currentAngle;
              const sliceAngle = (item.value / total) * Math.PI * 2;
              currentAngle += sliceAngle;
              const path = describeArc(center, center, radius, startAngle, currentAngle);
              const percentage = (item.value / total) * 100;
              return (
                <path
                  aria-label={`${item.label}: ${item.value}, ${percentage.toFixed(1)} percent`}
                  d={path}
                  fill={chartColors[index % chartColors.length]}
                  key={item.label}
                  role="graphics-symbol"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  tabIndex={0}
                >
                  <title>{`${item.label} - ${item.value} (${percentage.toFixed(1)}%)`}</title>
                </path>
              );
            })}
          </svg>
          <ul aria-label={`${title} legend`} className="pie-chart-legend">
            {data.map((item, index) => (
              <li key={item.label}>
                <span aria-hidden="true" style={{ background: chartColors[index % chartColors.length] }} />
                <strong>{item.label}</strong>
                <small>{item.value} ({((item.value / total) * 100).toFixed(1)}%)</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  if (endAngle - startAngle >= Math.PI * 2 - 0.0001) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius} Z`;
  }
  const start = polar(cx, cy, radius, startAngle);
  const end = polar(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function polar(cx: number, cy: number, radius: number, angle: number) {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}
