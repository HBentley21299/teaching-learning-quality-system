import type { LivRecordSummary } from "./types";

export function isMyLivRecord(record: Pick<LivRecordSummary, "isCreatedByCurrentUser" | "subjectStaffId">, staffId?: string) {
  return record.isCreatedByCurrentUser || Boolean(staffId && record.subjectStaffId === staffId);
}

export function livCompletionOptions(cycleNumber: number, isProbation: boolean, processLabel: string) {
  const nextCycle = cycleNumber + 1;
  const options = [{
    openFollowUp: true,
    label: `Complete cycle and open cycle ${nextCycle}`,
    confirmation: `Complete cycle ${cycleNumber} and open cycle ${nextCycle}?${isProbation ? " Probation Observation 2 will remain in progress." : ""}`,
    successMessage: `Cycle ${cycleNumber} completed. Cycle ${nextCycle} is ready.${isProbation ? " Probation Observation 2 remains in progress." : ""}`
  }];
  if (cycleNumber >= 2) options.push({
    openFollowUp: false,
    label: isProbation ? "Complete Probation Observation 2" : `Complete cycle and close ${processLabel}`,
    confirmation: isProbation
      ? `Complete cycle ${cycleNumber}, close the ${processLabel} and complete Probation Observation 2? Observation 3 will be ready.`
      : `Complete cycle ${cycleNumber} and close the ${processLabel} without opening another cycle?`,
    successMessage: isProbation
      ? "Probation Observation 2 completed. Observation 3 is ready."
      : `Cycle completed and the ${processLabel} is now closed.`
  });
  return options;
}

export function livStageVisibilityConfirmation(visibleToStaff: boolean, sectionLabel: string, staffName: string) {
  return visibleToStaff
    ? `Make ${sectionLabel} visible to ${staffName}? They will be able to view the saved content in this section. Unsaved edits will only be shared after you save them.`
    : `Hide ${sectionLabel} from ${staffName}? They will no longer be able to view this section.`;
}

export async function changeLivStageVisibility(options: {
  visibleToStaff: boolean;
  sectionLabel: string;
  staffName: string;
  confirm: (message: string) => boolean;
  save: (visibleToStaff: boolean) => Promise<{ ok: boolean; message?: string }>;
}): Promise<{ ok: boolean; cancelled?: boolean; message?: string }> {
  const message = livStageVisibilityConfirmation(options.visibleToStaff, options.sectionLabel, options.staffName);
  if (!options.confirm(message)) return { ok: false, cancelled: true };
  try {
    return await options.save(options.visibleToStaff);
  } catch {
    return { ok: false, message: "Visibility could not be updated. Try again; the previous visibility setting is unchanged." };
  }
}
