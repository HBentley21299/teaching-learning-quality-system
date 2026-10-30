import type { ActionSummary } from "./types";

type ResponsibleAction = Pick<ActionSummary, "ownerStaffId" | "ownerStaffName" | "responsibleStaffIds" | "responsibleStaffNames">;

/** One action can have several responsible people without duplicating the action. */
export function actionResponsiblePeople(action: ResponsibleAction) {
  const people = new Map<string, { id: string; name: string }>();
  for (const [index, id] of (action.responsibleStaffIds ?? []).entries()) {
    if (id && !people.has(id)) people.set(id, { id, name: action.responsibleStaffNames?.[index]
      || (id === action.ownerStaffId ? action.ownerStaffName : undefined) || "Name unavailable" });
  }
  if (action.ownerStaffId && !people.has(action.ownerStaffId)) people.set(action.ownerStaffId,
    { id: action.ownerStaffId, name: action.ownerStaffName || "Name unavailable" });
  return [...people.values()];
}

export function isActionResponsible(action: ResponsibleAction, staffId?: string | null) {
  return Boolean(staffId && (action.ownerStaffId === staffId || action.responsibleStaffIds?.includes(staffId)));
}

export function actionResponsibleNames(action: ResponsibleAction) {
  return actionResponsiblePeople(action).map(person => person.name).join("; ");
}
