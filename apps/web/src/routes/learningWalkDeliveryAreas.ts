export const unrecordedDeliveryAreaKey = "__not_recorded__";

type DeliveryAreaRecord = {
  id: string;
  deliveryAreaKey?: string;
  deliveryAreaName?: string;
  createdAt: string;
};

export function deliveryAreaKey(record: DeliveryAreaRecord): string {
  return record.deliveryAreaKey?.trim() || unrecordedDeliveryAreaKey;
}

export function deliveryAreaLabel(record: DeliveryAreaRecord): string {
  return record.deliveryAreaName?.trim() || record.deliveryAreaKey?.trim() || "Not recorded";
}

export function buildLearningWalkDeliveryAreas(records: DeliveryAreaRecord[]) {
  const groups = new Map<string, { key: string; label: string; value: number }>();
  const seen = new Set<string>();
  // Most recent saved wording represents a key in the chart; each record keeps its own wording in detail.
  const ordered = [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  for (const record of ordered) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    const key = deliveryAreaKey(record);
    const group = groups.get(key);
    if (group) group.value += 1;
    else groups.set(key, { key, label: deliveryAreaLabel(record), value: 1 });
  }
  return [...groups.values()].sort((left, right) => right.value - left.value || left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
}
