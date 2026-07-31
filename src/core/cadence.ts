// Cadence resolution — SPEC.md F-04. Picks the most specific matching plan.

import type { CadencePlan, LoanIntent } from "@/domain/types";

export interface CadenceMatchInput {
  sourceId: string;
  stateCode: string;
  intent: LoanIntent;
}

export function resolveCadence(plans: CadencePlan[], input: CadenceMatchInput): CadencePlan {
  const scored = plans.map((plan) => {
    let score = 0;
    if (plan.sourceId && plan.sourceId === input.sourceId) score += 4;
    if (plan.stateCode && plan.stateCode === input.stateCode) score += 2;
    if (plan.intent && plan.intent === input.intent) score += 1;
    return { plan, score };
  });

  const matched = scored.filter((s) => s.score > 0);
  if (matched.length === 0) {
    return plans.find((p) => p.isDefault) ?? plans[0];
  }

  matched.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.plan.id.localeCompare(b.plan.id)));
  return matched[0].plan;
}
