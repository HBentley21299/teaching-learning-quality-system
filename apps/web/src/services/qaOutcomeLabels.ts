import { createContext, useContext } from "react";
import type { QaOutcomeLabels } from "./types";

export const defaultQaOutcomeLabels: QaOutcomeLabels = { below: "Below standard", at: "At standard", above: "Above standard", notApplicable: "Not applicable" };
export const QaOutcomeLabelsContext = createContext<QaOutcomeLabels>(defaultQaOutcomeLabels);
export const useQaOutcomeLabels = () => useContext(QaOutcomeLabelsContext);
export const qaCombinedOutcomeLabel = (labels: QaOutcomeLabels) => `${labels.at} / ${labels.above}`;
