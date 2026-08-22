import { describe, expect, it } from "vitest";
import { canAcceptInsight, deriveCallInsights } from "@/core/callInsights";
import type { FieldCandidate, Lead, LeadField } from "@/domain/types";

// Extraction has always written into db.leadFields. The Lead record — the
// header an officer reads before dialling — is written only by a manual edit.
// So a borrower who corrected their goal on a call left the header stale and
// the correction buried in the Package tab.

const lead = {
  id: "l1",
  intent: "REFINANCE",
  goal: "LOWER_PAYMENT",
  timeline: "EXPLORING",
  creditRange: "UNSURE",
  occupancy: "PRIMARY",
} as unknown as Lead;

function field(over: Partial<LeadField> & Pick<LeadField, "fieldPath" | "value">): LeadField {
  return {
    id: `f_${over.fieldPath}`,
    leadId: "l1",
    status: "CONFIRMED",
    confidence: 0.9,
    sourceType: "BORROWER_STATED",
    collectedAt: "2026-08-16T12:00:00Z",
    verificationStatus: "UNVERIFIED",
    supersededCandidateIds: [],
    ...over,
  } as LeadField;
}

function candidate(fieldPath: string, turnRefs: number[]): FieldCandidate {
  return {
    id: `c_${fieldPath}`,
    leadId: "l1",
    fieldPath,
    value: "x",
    confidence: 0.9,
    sourceType: "BORROWER_STATED",
    transcriptTurnRefs: turnRefs,
    createdAt: "2026-08-16T12:00:00Z",
    promoted: true,
  };
}

describe("surfacing what the call changed", () => {
  it("flags a value that contradicts the form", () => {
    const [i] = deriveCallInsights(lead, [field({ fieldPath: "loan.purpose", value: "CASH_OUT" })]);
    expect(i.kind).toBe("CHANGED");
    expect(i.currentValue).toBe("LOWER_PAYMENT");
    expect(i.callValue).toBe("CASH_OUT");
  });

  it("flags a gap the call filled as NEW, not CHANGED", () => {
    // The form said UNSURE, which is an absence rather than an answer.
    const [i] = deriveCallInsights(lead, [field({ fieldPath: "borrower.creditBand", value: "GOOD_680_739" })]);
    expect(i.kind).toBe("NEW");
  });

  it("reads the disputed value from a CONFLICTED field", () => {
    // CONFLICTED keeps the existing value and parks the challenger separately.
    const [i] = deriveCallInsights(lead, [
      field({ fieldPath: "loan.intent", value: "REFINANCE", status: "CONFLICTED", conflictingValue: "CASH_OUT" }),
    ]);
    expect(i.kind).toBe("CONFLICT");
    expect(i.callValue).toBe("CASH_OUT");
  });

  it("puts conflicts first — they are what a human must adjudicate", () => {
    const out = deriveCallInsights(lead, [
      field({ fieldPath: "borrower.creditBand", value: "GOOD_680_739" }),
      field({ fieldPath: "loan.intent", value: "REFINANCE", status: "CONFLICTED", conflictingValue: "CASH_OUT" }),
    ]);
    expect(out[0].kind).toBe("CONFLICT");
  });
});

describe("staying quiet when there is nothing to say", () => {
  it("returns nothing when the call agreed with the form", () => {
    // A card listing five unchanged things is noise, and noise trains people
    // to skip the card that matters.
    expect(deriveCallInsights(lead, [field({ fieldPath: "loan.purpose", value: "LOWER_PAYMENT" })])).toEqual([]);
  });

  it("ignores UNKNOWN and unmapped fields", () => {
    expect(deriveCallInsights(lead, [field({ fieldPath: "loan.purpose", value: "UNKNOWN" })])).toEqual([]);
    expect(deriveCallInsights(lead, [field({ fieldPath: "contact.reachable", value: true })])).toEqual([]);
  });

  it("never shows an officer their own entry back as a suggestion", () => {
    expect(
      deriveCallInsights(lead, [field({ fieldPath: "loan.purpose", value: "CASH_OUT", sourceType: "OFFICER_ENTERED" })])
    ).toEqual([]);
  });
});

describe("evidence gates one-click accept", () => {
  it("allows accepting when the claim cites transcript turns", () => {
    const [i] = deriveCallInsights(
      lead,
      [field({ fieldPath: "loan.purpose", value: "CASH_OUT" })],
      [candidate("loan.purpose", [4, 5])]
    );
    expect(i.turnRefs).toEqual([4, 5]);
    expect(canAcceptInsight(i)).toBe(true);
  });

  it("refuses one-click accept for an uncited claim", () => {
    // "The model asserted it with no citation" must not become a button that
    // rewrites the lead record.
    const [i] = deriveCallInsights(lead, [field({ fieldPath: "loan.purpose", value: "CASH_OUT" })]);
    expect(canAcceptInsight(i)).toBe(false);
  });
});
