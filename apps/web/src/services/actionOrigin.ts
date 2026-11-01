type ActionOriginSource = { sourceRecordId?: string | null; sourceFormType?: string | null; sourceRecordTitle?: string | null };

export const missingActionOriginKey = "origin_not_recorded";

const actionSourceAliases: Record<string, string> = {
  probation_case: "probation_observation",
  coaching_session: "coaching_mentoring",
  elevate_practice_assessment: "elevate_practice",
  cpd_event: "cpd"
};

function canonicalActionSource(source?: string | null) {
  const value = source?.trim().toLowerCase() || "";
  return actionSourceAliases[value] ?? value;
}

const actionSourceLabels: Record<string, string> = {
  coaching_mentoring: "Coaching and Mentoring",
  elevate_environment: "Learning Environment",
  elevate_practice: "Elevate Learning and Innovation",
  learning_walk: "Learning Walk",
  als_learning_walk: "ALS Learning Walk",
  digital_learning_walk: "Digital Learning Walk",
  activate_growth_review: "Activate+ Growth Review",
  liv: "LIV",
  als_liv: "ALS LIV",
  probation_observation: "Probation Observation",
  qa_review: "QA Review",
  uco_tla_review: "UCO TLA Review",
  cpd: "CPD",
  reflection: "Reflection",
  reflections: "Reflections",
  work_scrutiny: "Work Scrutiny",
  source_record: "Source record",
  origin_not_recorded: "Origin not recorded",
  standalone: "Origin not recorded"
};

/** A process tag alone does not establish an action's origin. */
export function hasActionOrigin(action: ActionOriginSource) {
  return Boolean(action.sourceRecordId?.trim());
}

export function actionOriginKey(action: ActionOriginSource) {
  if (!hasActionOrigin(action)) return missingActionOriginKey;
  const source = canonicalActionSource(action.sourceFormType);
  return !source || source === "standalone" ? "source_record" : source;
}

export function actionSourceLabel(source?: string | null) {
  const key = canonicalActionSource(source) || missingActionOriginKey;
  return actionSourceLabels[key] ?? key.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

export function actionOriginLabel(action: ActionOriginSource) {
  return actionSourceLabel(actionOriginKey(action));
}

export function actionOriginRecordLabel(action: ActionOriginSource) {
  return hasActionOrigin(action)
    ? action.sourceRecordTitle?.trim() || "Linked source record"
    : "Earlier action without a linked source record";
}

/** These workflows keep approved plans or assignments alongside the central action row. */
export function actionStructureIsManagedAtSource(action: ActionOriginSource) {
  return hasActionOrigin(action) && ["qa_review", "uco_tla_review", "elevate_practice", "coaching_mentoring"].includes(actionOriginKey(action));
}
