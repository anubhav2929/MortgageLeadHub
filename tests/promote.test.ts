import { describe, expect, it } from "vitest";
import { promoteCandidate, type RawCandidate } from "@/core/extraction/promote";
import type { LeadField } from "@/domain/types";

// This function is the boundary between "what a language model claimed it
// heard" and "what the system asserts about a borrower". Every rule here
// exists to stop a model's output from silently becoming a fact on a loan
// file, so each is pinned individually — including its ruleCode, which is
// what the audit log records when a reviewer asks why a field changed.

function candidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    fieldPath: "occupancy",
    value: "PRIMARY",
    confidence: 0.9,
    transcriptTurnRefs: [4],
    sourceType: "BORROWER_STATED",
    ...overrides,
  };
}

function field(overrides: Partial<LeadField> = {}): LeadField {
  return {
    fieldPath: "occupancy",
    value: "PRIMARY",
    status: "CONFIRMED",
    sourceType: "BORROWER_STATED",
    ...overrides,
  } as LeadField;
}

describe("evidence is mandatory", () => {
  it("refuses to promote a value the model can't point to in the transcript", () => {
    // High confidence with no citation is exactly the shape of a
    // hallucination, so confidence alone must not be enough.
    const result = promoteCandidate(candidate({ confidence: 0.99, transcriptTurnRefs: [] }), undefined);
    expect(result.promoted).toBe(false);
    expect(result.status).toBe("UNKNOWN");
    expect(result.ruleCode).toBe("NO_EVIDENCE");
  });

  it("leaves an existing value untouched when new evidence is missing", () => {
    const result = promoteCandidate(
      candidate({ value: "INVESTMENT", transcriptTurnRefs: [] }),
      field({ value: "PRIMARY", status: "CANDIDATE" })
    );
    expect(result.value).toBe("PRIMARY");
    expect(result.status).toBe("CANDIDATE");
  });
});

describe("confidence bands", () => {
  it("promotes to CONFIRMED at or above 0.85", () => {
    const result = promoteCandidate(candidate({ confidence: 0.85 }), undefined);
    expect(result).toMatchObject({ status: "CONFIRMED", value: "PRIMARY", promoted: true, ruleCode: "CONFIDENCE_HIGH" });
  });

  it("records a CANDIDATE between 0.6 and 0.85 without promoting it", () => {
    const result = promoteCandidate(candidate({ confidence: 0.6 }), undefined);
    expect(result).toMatchObject({ status: "CANDIDATE", promoted: false, ruleCode: "CONFIDENCE_MEDIUM" });
  });

  it("discards anything below 0.6", () => {
    const result = promoteCandidate(candidate({ confidence: 0.59 }), undefined);
    expect(result).toMatchObject({ status: "UNKNOWN", value: "UNKNOWN", ruleCode: "CONFIDENCE_LOW" });
  });

  it("does not downgrade a confirmed field when a low-confidence pass agrees", () => {
    // The already-confirmed guard is checked before the confidence bands, so
    // a weak re-affirmation is a no-op rather than a downgrade.
    const result = promoteCandidate(candidate({ confidence: 0.3 }), field());
    expect(result).toMatchObject({ status: "CONFIRMED", value: "PRIMARY", ruleCode: "ALREADY_CONFIRMED" });
  });
});

describe("officer-entered values are locked", () => {
  it("is never overwritten by an automated extraction", () => {
    // A human typed this. No amount of model confidence outranks that.
    const result = promoteCandidate(
      candidate({ value: "INVESTMENT", confidence: 0.99 }),
      field({ value: "PRIMARY", sourceType: "OFFICER_ENTERED" })
    );
    expect(result).toMatchObject({ value: "PRIMARY", promoted: false, ruleCode: "OFFICER_ENTERED_LOCKED" });
  });

  it("is not even marked conflicted when the model disagrees", () => {
    const result = promoteCandidate(
      candidate({ value: "SECOND_HOME" }),
      field({ sourceType: "OFFICER_ENTERED", status: "VERIFIED" })
    );
    expect(result.status).toBe("VERIFIED");
    expect(result.conflictingValue).toBeUndefined();
  });
});

describe("conflicts surface to a human instead of resolving themselves", () => {
  it("flags a disagreement with a confirmed form value", () => {
    const result = promoteCandidate(
      candidate({ value: "INVESTMENT", confidence: 0.95 }),
      field({ value: "PRIMARY", sourceType: "FORM" })
    );
    expect(result).toMatchObject({
      status: "CONFLICTED",
      value: "PRIMARY",
      conflictingValue: "INVESTMENT",
      promoted: false,
      ruleCode: "CONFLICTS_WITH_FORM",
    });
  });

  it("distinguishes a form conflict from a prior-extraction conflict in the audit code", () => {
    const result = promoteCandidate(
      candidate({ value: "INVESTMENT" }),
      field({ value: "PRIMARY", sourceType: "BORROWER_STATED" })
    );
    expect(result.ruleCode).toBe("CONFLICTS_WITH_CONFIRMED");
  });

  it("keeps the authoritative value as the live one while conflicted", () => {
    // The disputed value is surfaced alongside, never in place of, the
    // value the rest of the system is working from.
    const result = promoteCandidate(candidate({ value: "INVESTMENT" }), field({ value: "PRIMARY" }));
    expect(result.value).toBe("PRIMARY");
  });

  it("does not flag a conflict when the candidate agrees", () => {
    const result = promoteCandidate(candidate({ value: "PRIMARY" }), field({ value: "PRIMARY" }));
    expect(result.status).toBe("CONFIRMED");
    expect(result.conflictingValue).toBeUndefined();
    expect(result.ruleCode).toBe("ALREADY_CONFIRMED");
  });
});

describe("unknown values", () => {
  it.each(["UNKNOWN", null, undefined])("treats %s as no information at all", (value) => {
    const result = promoteCandidate(candidate({ value }), undefined);
    expect(result).toMatchObject({ status: "UNKNOWN", value: "UNKNOWN", promoted: false, ruleCode: "VALUE_UNKNOWN" });
  });

  it("does not erase a confirmed value when a later pass comes back unsure", () => {
    // Silence from one extraction run is not evidence that the earlier
    // answer was wrong.
    const result = promoteCandidate(candidate({ value: "UNKNOWN" }), field({ value: "PRIMARY" }));
    expect(result).toMatchObject({ value: "PRIMARY", status: "CONFIRMED", ruleCode: "KEEP_EXISTING_CONFIRMED" });
  });
});

describe("purity", () => {
  it("does not mutate the candidate or the existing field", () => {
    const c = candidate({ value: "INVESTMENT" });
    const f = field({ value: "PRIMARY" });
    const snapshot = { c: structuredClone(c), f: structuredClone(f) };
    promoteCandidate(c, f);
    expect(c).toEqual(snapshot.c);
    expect(f).toEqual(snapshot.f);
  });

  it("is deterministic for the same inputs", () => {
    const args = [candidate(), field({ status: "CANDIDATE" })] as const;
    expect(promoteCandidate(...args)).toEqual(promoteCandidate(...args));
  });
});
