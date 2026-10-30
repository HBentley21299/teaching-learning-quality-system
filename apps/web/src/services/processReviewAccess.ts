import type { ProcessReviewKey } from "./processReviewTypes";

export const processReviewKeys: readonly ProcessReviewKey[] = ["digital_learning_walk", "activate_growth_review"];

export function isProcessReviewKey(value: string): value is ProcessReviewKey {
  return processReviewKeys.includes(value as ProcessReviewKey);
}

/** The API further limits these readers to their own or explicitly scoped records. */
export function canAccessProcessReviews(key: ProcessReviewKey, permissions: readonly string[]) {
  return permissions.includes("forms.manage") || ["submit", "manage", "view_all", "view_scoped"].some(suffix => permissions.includes(`${key}.${suffix}`));
}
