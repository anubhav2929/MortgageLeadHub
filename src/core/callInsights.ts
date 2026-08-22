// What a call actually told us that the lead record does not yet say.
//
// The extraction pipeline (adapters/llm → core/extraction/promote) is sound:
// it writes evidence-backed candidates into db.leadFields with a status, and
// refuses to overwrite anything an officer entered or anything already
// confirmed that disagrees. What it does NOT do is touch the Lead record —
// lead.intent, lead.goal, lead.timeline and friends are written by exactly one
// thing, a manual officer edit.
//
// So a borrower who says "actually I want to pull cash out, not just lower my
// rate" produces a correctly-extracted, correctly-promoted field... while the
// lead header still reads REFINANCE / LOWER_PAYMENT. The officer reads the
// header, not the Package tab, and acts on the stale answer.
//
// This computes the difference so it can be shown and acted on. It does not
// resolve it: the lead record is what the borrower typed and consented to, and
// a model's reading of a phone call should not silently rewrite that. A person
// accepts, and the acceptance is recorded as officer-entered — which the
// promotion rules then lock against further automated change.

import type { FieldCandidate, FieldStatus, Lead, LeadField } from "@/domain/types";

/** LeadField paths that correspond to a column on the Lead record. */
export const FIELD_TO_LEAD_PROPERTY = {
  "loan.intent": "intent",
  "loan.purpose": "goal",
  "borrower.timeline": "timeline",
  "borrower.creditBand": "creditRange",
  "property.occupancy": "occupancy",
} as const;

export type MappedFieldPath = keyof typeof FIELD_TO_LEAD_PROPERTY;

export const FIELD_LABELS: Record<MappedFieldPath, string> = {
  "loan.intent": "Loan intent",
  "loan.purpose": "Goal",
  "borrower.timeline": "Timeline",
  "borrower.creditBand": "Credit band",
  "property.occupancy": "Occupancy",
};

export type InsightKind =
  /** The call answered something the lead record had no answer for. */
  | "NEW"
  /** The call contradicts what the borrower said on the form. */
  | "CHANGED"
  /** Two sources disagree and the pipeline refused to pick. */
  | "CONFLICT";

export interface CallInsight {
  fieldPath: MappedFieldPath;
  label: string;
  kind: InsightKind;
  /** What the lead record says today. */
  currentValue: unknown;
  /** What the call indicates. */
  callValue: unknown;
  confidence: number;
  status: FieldStatus;
  /** Transcript turns the claim rests on. Empty means it was never promoted. */
  turnRefs: number[];
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || v === "UNKNOWN" || v === "UNSURE";
}

/**
 * Compares extracted fields against the lead record.
 *
 * Only returns fields that (a) map to a real lead column and (b) actually
 * differ. A call that confirms everything the form already said produces no
 * insights, which is the correct outcome — a card listing five things that did
 * not change is noise, and noise here trains officers to skip the card that
 * matters.
 */
export function deriveCallInsights(lead: Lead, fields: LeadField[], candidates: FieldCandidate[] = []): CallInsight[] {
  const insights: CallInsight[] = [];

  // Evidence lives on the candidate, not the promoted field — a LeadField
  // records what was decided, a FieldCandidate records what it was decided
  // from. Newest candidate per path wins, since that is the one the most
  // recent call produced.
  const evidence = new Map<string, number[]>();
  for (const c of [...candidates].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    if (c.transcriptTurnRefs?.length) evidence.set(c.fieldPath, c.transcriptTurnRefs);
  }

  for (const field of fields) {
    const path = field.fieldPath as MappedFieldPath;
    const property = FIELD_TO_LEAD_PROPERTY[path];
    if (!property) continue;

    // Never surface an officer's own entry back at them as a suggestion.
    if (field.sourceType === "OFFICER_ENTERED") continue;

    const current = (lead as unknown as Record<string, unknown>)[property];
    const callValue = field.status === "CONFLICTED" ? field.conflictingValue : field.value;

    if (isEmpty(callValue)) continue;
    if (String(callValue) === String(current)) continue;

    const kind: InsightKind =
      field.status === "CONFLICTED" ? "CONFLICT" : isEmpty(current) ? "NEW" : "CHANGED";

    insights.push({
      fieldPath: path,
      label: FIELD_LABELS[path],
      kind,
      currentValue: current,
      callValue,
      confidence: field.confidence,
      status: field.status,
      turnRefs: evidence.get(path) ?? [],
    });
  }

  // Conflicts first — they are the ones a human genuinely has to adjudicate.
  // Then changes, then gaps being filled.
  const order: Record<InsightKind, number> = { CONFLICT: 0, CHANGED: 1, NEW: 2 };
  return insights.sort((a, b) => order[a.kind] - order[b.kind] || b.confidence - a.confidence);
}

/**
 * Whether this insight is safe to accept with one click.
 *
 * Requires transcript evidence. The promotion rules already refuse to promote
 * an unevidenced claim, but an insight can also be built from a CONFLICTED
 * field, and "the model asserted it with no citation" must not become a button
 * that rewrites the lead.
 */
export function canAcceptInsight(insight: CallInsight): boolean {
  return insight.turnRefs.length > 0;
}
