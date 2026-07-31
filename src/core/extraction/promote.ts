// Candidate → field promotion rules — SPEC.md F-06 step 5. Pure, deterministic,
// no I/O. The model proposes; this function is the only thing allowed to
// write to the authoritative profile.

import type { FieldStatus, LeadField } from "@/domain/types";

export interface RawCandidate {
  fieldPath: string;
  value: unknown;
  confidence: number;
  transcriptTurnRefs: number[];
  sourceType: "BORROWER_STATED" | "OFFICER_ENTERED" | "FORM" | "PROVIDER";
}

export interface PromotionResult {
  status: FieldStatus;
  value: unknown;
  conflictingValue?: unknown;
  promoted: boolean;
  ruleCode: string;
}

/**
 * Decide what a single new candidate does to the authoritative LeadField.
 * Never mutates its inputs — returns the field state the caller should write.
 */
export function promoteCandidate(candidate: RawCandidate, existing: LeadField | undefined): PromotionResult {
  const hasEvidence = candidate.transcriptTurnRefs.length > 0;
  const isUnknown = candidate.value === "UNKNOWN" || candidate.value === null || candidate.value === undefined;
  const alreadyConfirmed = existing?.status === "CONFIRMED" || existing?.status === "VERIFIED";

  // Officer-entered values are the highest-precedence source and are never
  // touched by an automated re-extraction, agreeing or not.
  if (existing?.sourceType === "OFFICER_ENTERED") {
    return { status: existing.status, value: existing.value, promoted: false, ruleCode: "OFFICER_ENTERED_LOCKED" };
  }

  if (isUnknown) {
    // Never overwrite a confirmed value just because a later pass came back
    // unsure — silence from one extraction run isn't evidence of anything.
    if (alreadyConfirmed) {
      return { status: existing!.status, value: existing!.value, promoted: false, ruleCode: "KEEP_EXISTING_CONFIRMED" };
    }
    return { status: "UNKNOWN", value: "UNKNOWN", promoted: false, ruleCode: "VALUE_UNKNOWN" };
  }

  // A confirmed/verified value (from a form or a prior extraction) that
  // disagrees with this candidate is never silently overwritten — both
  // values surface to the officer to resolve. SPEC.md calls this out
  // specifically for FORM data; the same protection applies to any already-
  // confirmed value, since a contradicting later statement is exactly the
  // kind of thing a human should adjudicate, not a rule.
  if (alreadyConfirmed && existing!.value !== candidate.value) {
    return {
      status: "CONFLICTED",
      value: existing!.value,
      conflictingValue: candidate.value,
      promoted: false,
      ruleCode: existing!.sourceType === "FORM" ? "CONFLICTS_WITH_FORM" : "CONFLICTS_WITH_CONFIRMED",
    };
  }

  // Non-negotiable: a field with no transcriptTurnRefs is never promoted,
  // whatever the confidence — if the model can't point at where it heard it,
  // it made it up.
  if (!hasEvidence) {
    return { status: existing?.status ?? "UNKNOWN", value: existing?.value ?? "UNKNOWN", promoted: false, ruleCode: "NO_EVIDENCE" };
  }

  if (candidate.confidence >= 0.85 && !alreadyConfirmed) {
    return { status: "CONFIRMED", value: candidate.value, promoted: true, ruleCode: "CONFIDENCE_HIGH" };
  }

  // Same value re-affirmed at a lower confidence than before — keep the
  // existing confirmed status rather than downgrading it.
  if (alreadyConfirmed) {
    return { status: existing!.status, value: existing!.value, promoted: false, ruleCode: "ALREADY_CONFIRMED" };
  }

  if (candidate.confidence >= 0.6) {
    return { status: "CANDIDATE", value: candidate.value, promoted: false, ruleCode: "CONFIDENCE_MEDIUM" };
  }

  return { status: existing?.status ?? "UNKNOWN", value: existing?.value ?? "UNKNOWN", promoted: false, ruleCode: "CONFIDENCE_LOW" };
}
