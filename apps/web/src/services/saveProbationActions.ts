import type { CreateActionRequest } from "./types";

type ActionDraft = Pick<CreateActionRequest, "actionTheme" | "title" | "ownerStaffId" | "dueDate">;
type SaveResult = { ok: boolean; message?: string };

/** Acknowledge a created action before saving its stage, so a stage retry cannot create it twice. */
export async function saveProbationActions(draft: ActionDraft | undefined, persistence: {
  createAction: (draft: ActionDraft) => Promise<SaveResult>;
  actionSaved: () => void;
  saveStage?: () => Promise<SaveResult>;
}): Promise<SaveResult> {
  if (draft) {
    if (!draft.actionTheme.trim() || !draft.title.trim() || !draft.ownerStaffId || !draft.dueDate) {
      return { ok: false, message: "Complete the action theme, description, owner and implementation date." };
    }
    const result = await persistence.createAction({
      ...draft, actionTheme: draft.actionTheme.trim(), title: draft.title.trim()
    });
    if (!result.ok) return { ok: false, message: result.message ?? "The action could not be saved. Your changes are still here." };
    persistence.actionSaved();
  }

  if (persistence.saveStage) {
    const result = await persistence.saveStage();
    if (!result.ok) return {
      ok: false,
      message: `${draft ? "The action was created, but the stage could not be saved. " : ""}${result.message ?? "The action stage could not be saved."}`
    };
  }
  return { ok: true };
}
