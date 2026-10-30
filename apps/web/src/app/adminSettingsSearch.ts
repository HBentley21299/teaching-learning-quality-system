export type AdminSettingsEntry = {
  key: string;
  group: string;
  label: string;
  description: string;
  keywords?: readonly string[];
  steps?: readonly string[];
  impact?: string;
  workspace?: string;
};

const fillerWords = new Set(['how', 'do', 'does', 'i', 'we', 'can', 'a', 'an', 'the', 'to', 'my', 'our', 'change', 'amend', 'edit', 'setting', 'settings']);

export function normalizeAdminSearch(value: string) {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/n\s*\/\s*a\b/g, 'not applicable').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function searchAdminSettings<T extends AdminSettingsEntry>(entries: readonly T[], query: string): T[] {
  const terms = normalizeAdminSearch(query).split(' ').filter(term => term && !fillerWords.has(term));
  return entries.filter(entry => {
    const text = normalizeAdminSearch([entry.label, entry.group, entry.description, entry.workspace,
      ...(entry.keywords ?? []), ...(entry.steps ?? []), entry.impact].filter(Boolean).join(' '));
    return terms.every(term => text.includes(term));
  });
}
