// 1003-aligned completeness scoring — SPEC.md F-07. Weighted, not a raw
// percentage. UNKNOWN and CONFLICTED both score 0 for their field.

import type { FieldStatus } from "@/domain/types";

export interface CompletenessInputs {
  contactable: FieldStatus;
  intent: FieldStatus;
  propertyIdentified: FieldStatus;
  occupancy: FieldStatus;
  loanPurpose: FieldStatus;
  timeline: FieldStatus;
  creditBand: FieldStatus;
  incomeBand: FieldStatus;
}

const WEIGHTS: Record<keyof CompletenessInputs, number> = {
  contactable: 20,
  intent: 15,
  propertyIdentified: 15,
  occupancy: 10,
  loanPurpose: 10,
  timeline: 10,
  creditBand: 10,
  incomeBand: 10,
};

const SCORING_STATUSES: FieldStatus[] = ["CONFIRMED", "VERIFIED", "CANDIDATE"];

export function computeCompleteness(inputs: CompletenessInputs): {
  score: number;
  missing: (keyof CompletenessInputs)[];
} {
  let score = 0;
  const missing: (keyof CompletenessInputs)[] = [];

  for (const key of Object.keys(WEIGHTS) as (keyof CompletenessInputs)[]) {
    const status = inputs[key];
    if (SCORING_STATUSES.includes(status)) {
      score += WEIGHTS[key];
    } else {
      missing.push(key);
    }
  }

  return { score, missing };
}

export const COMPLETENESS_FIELD_LABELS: Record<keyof CompletenessInputs, string> = {
  contactable: "Contactable",
  intent: "Loan intent",
  propertyIdentified: "Property identified",
  occupancy: "Occupancy stated",
  loanPurpose: "Loan purpose",
  timeline: "Timeline",
  creditBand: "Credit band",
  incomeBand: "Income band",
};
