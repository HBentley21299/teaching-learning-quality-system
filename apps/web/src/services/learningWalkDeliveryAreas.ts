export type LearningWalkDeliveryArea = { key: string; name: string; isActive: boolean };

// A retired choice may be retained on its existing record, never offered as a new choice.
export function learningWalkDeliveryChoices(areas: readonly LearningWalkDeliveryArea[], savedKey = "", savedName?: string) {
  const choices = areas.filter((area) => area.isActive || area.key === savedKey)
    .map((area) => ({ ...area, name: area.key === savedKey && savedName ? savedName : area.name }));
  if (savedKey && !choices.some((area) => area.key === savedKey)) {
    choices.push({ key: savedKey, name: savedName || savedKey, isActive: false });
  }
  return choices;
}
