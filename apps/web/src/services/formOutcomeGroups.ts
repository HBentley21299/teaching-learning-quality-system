type Fact = {
  dimensionKey: string;
  seriesKey: string;
  seriesLabel: string;
  numericValue?: number | null;
  valueLabel: string;
};

export function buildFormOutcomeGroups(facts: readonly Fact[], sectionDimension: string, statementDimension: string) {
  const sections = new Map<string, { label: string; facts: Fact[]; statements: Fact[] }>();
  for (const fact of facts.filter((row) => row.dimensionKey === sectionDimension)) {
    const section = sections.get(fact.seriesKey) ?? { label: fact.seriesLabel, facts: [], statements: [] };
    section.facts.push(fact);
    sections.set(fact.seriesKey, section);
  }
  for (const fact of facts.filter((row) => row.dimensionKey === statementDimension)) {
    const key = fact.seriesKey.split('::')[0];
    const section = sections.get(key) ?? { label: fact.seriesLabel.split('|||')[0], facts: [], statements: [] };
    section.statements.push(fact);
    sections.set(key, section);
  }
  return [...sections].map(([key, section]) => {
    const statements = new Map<string, Fact[]>();
    for (const fact of section.statements) {
      const rows = statements.get(fact.seriesKey) ?? [];
      rows.push(fact);
      statements.set(fact.seriesKey, rows);
    }
    return {
      key,
      label: section.label,
      summary: summarize(section.label, section.facts.length ? section.facts : section.statements),
      children: [...statements.values()].map((rows) => summarize(
        rows[0].seriesLabel.split('|||').slice(1).join('|||') || rows[0].seriesLabel,
        rows
      )).sort((a, b) => a.average - b.average || a.label.localeCompare(b.label))
    };
  }).sort((a, b) => a.summary.average - b.summary.average || a.label.localeCompare(b.label));
}

function summarize(label: string, facts: readonly Fact[]) {
  const numeric = facts.filter((fact) => fact.numericValue != null
    && Number.isFinite(fact.numericValue) && fact.numericValue >= 1 && fact.numericValue <= 5);
  const distribution = [0, 0, 0, 0, 0];
  for (const fact of numeric) distribution[Math.round(fact.numericValue!) - 1]++;
  const neutral = new Map<string, number>();
  for (const fact of facts) {
    if (fact.numericValue == null) neutral.set(fact.valueLabel, (neutral.get(fact.valueLabel) ?? 0) + 1);
  }
  return {
    label,
    responseCount: numeric.length,
    average: numeric.length ? numeric.reduce((total, fact) => total + fact.numericValue!, 0) / numeric.length : 0,
    secureOrAboveCount: numeric.filter((fact) => fact.numericValue! >= 3).length,
    distribution,
    neutralCounts: [...neutral].map(([label, count]) => ({ label, count }))
  };
}
