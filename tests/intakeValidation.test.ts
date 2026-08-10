import { describe, expect, it } from "vitest";
import { intakeInputSchema } from "@/core/intakeValidation";
import { computeCompleteness, type CompletenessInputs } from "@/core/completeness";

// submitIntakeAction is the only unauthenticated write path in the app —
// the real trust boundary. These tests exist to keep that boundary from
// quietly loosening: unbounded strings, absurd numbers, or an unsupported
// state code must all be rejected before anything reaches the database.

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    intent: "REFINANCE",
    firstName: "Jennifer",
    lastName: "Martinez",
    phone: "+1 555 123 4567",
    email: "jennifer@example.com",
    stateCode: "FL",
    occupancy: "PRIMARY",
    goal: "LOWER_PAYMENT",
    timeline: "ASAP",
    bestContactTime: "MORNING",
    creditRange: "GOOD_680_739",
    missedPayments: "NONE",
    consents: { voice: true, sms: true, email: true, recording: true },
    ...overrides,
  };
}

describe("intakeInputSchema — accepts legitimate submissions", () => {
  it("accepts a complete, well-formed submission", () => {
    expect(intakeInputSchema.safeParse(validInput()).success).toBe(true);
  });

  it("accepts a minimal submission with all optionals omitted", () => {
    expect(intakeInputSchema.safeParse(validInput()).success).toBe(true);
  });

  it("trims surrounding whitespace rather than storing it", () => {
    const parsed = intakeInputSchema.parse(validInput({ firstName: "  Jennifer  " }));
    expect(parsed.firstName).toBe("Jennifer");
  });

  it("accepts a borrower who declined every consent", () => {
    // Consent is recorded, not required — declining is a valid submission
    // that PolicyGate then enforces downstream.
    const parsed = intakeInputSchema.safeParse(
      validInput({ consents: { voice: false, sms: false, email: false, recording: false } })
    );
    expect(parsed.success).toBe(true);
  });
});

describe("intakeInputSchema — rejects hostile or malformed input", () => {
  it("rejects a name longer than the column allows", () => {
    expect(intakeInputSchema.safeParse(validInput({ firstName: "a".repeat(101) })).success).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    expect(intakeInputSchema.safeParse(validInput({ firstName: "   " })).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(intakeInputSchema.safeParse(validInput({ email: "not-an-email" })).success).toBe(false);
  });

  it("rejects a state we are not licensed in", () => {
    // The enum is the licensing footprint; an arbitrary code must not pass.
    expect(intakeInputSchema.safeParse(validInput({ stateCode: "ZZ" })).success).toBe(false);
  });

  it("rejects an unknown enum value instead of coercing it", () => {
    expect(intakeInputSchema.safeParse(validInput({ timeline: "SOMEDAY" })).success).toBe(false);
    expect(intakeInputSchema.safeParse(validInput({ occupancy: "BOAT" })).success).toBe(false);
  });

  it("rejects a negative property value", () => {
    expect(intakeInputSchema.safeParse(validInput({ estimatedValue: -1 })).success).toBe(false);
  });

  it("rejects an absurd property value", () => {
    expect(intakeInputSchema.safeParse(validInput({ estimatedValue: 1e12 })).success).toBe(false);
  });

  it("rejects NaN and Infinity in numeric fields", () => {
    expect(intakeInputSchema.safeParse(validInput({ estimatedValue: Number.NaN })).success).toBe(false);
    expect(intakeInputSchema.safeParse(validInput({ currentBalance: Number.POSITIVE_INFINITY })).success).toBe(false);
  });

  it("rejects an intake duration longer than a day", () => {
    expect(intakeInputSchema.safeParse(validInput({ intakeDurationSeconds: 86_401 })).success).toBe(false);
  });

  it("rejects a submission missing the consent block entirely", () => {
    const withoutConsents = { ...validInput() };
    delete (withoutConsents as Record<string, unknown>).consents;
    expect(intakeInputSchema.safeParse(withoutConsents).success).toBe(false);
  });

  it("rejects a partial consent block", () => {
    expect(intakeInputSchema.safeParse(validInput({ consents: { voice: true } })).success).toBe(false);
  });

  it("rejects an oversized free-text address", () => {
    expect(intakeInputSchema.safeParse(validInput({ addressLine1: "x".repeat(201) })).success).toBe(false);
  });

  it("reports a usable message for each invalid field", () => {
    const result = intakeInputSchema.safeParse(validInput({ email: "nope", firstName: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path[0]);
      expect(fields).toContain("email");
      expect(fields).toContain("firstName");
    }
  });
});

describe("computeCompleteness", () => {
  const allUnknown: CompletenessInputs = {
    contactable: "UNKNOWN",
    intent: "UNKNOWN",
    propertyIdentified: "UNKNOWN",
    occupancy: "UNKNOWN",
    loanPurpose: "UNKNOWN",
    timeline: "UNKNOWN",
    creditBand: "UNKNOWN",
    incomeBand: "UNKNOWN",
  };

  it("scores zero and lists every field when nothing is known", () => {
    const { score, missing } = computeCompleteness(allUnknown);
    expect(score).toBe(0);
    expect(missing).toHaveLength(8);
  });

  it("scores 100 with nothing missing when every field is confirmed", () => {
    const all = Object.fromEntries(
      Object.keys(allUnknown).map((k) => [k, "CONFIRMED"])
    ) as unknown as CompletenessInputs;
    const { score, missing } = computeCompleteness(all);
    expect(score).toBe(100);
    expect(missing).toEqual([]);
  });

  it("weights contactability above the optional bands", () => {
    // Being able to reach the borrower is worth more than knowing their
    // income band, and the weighting must reflect that.
    expect(computeCompleteness({ ...allUnknown, contactable: "CONFIRMED" }).score).toBe(20);
    expect(computeCompleteness({ ...allUnknown, incomeBand: "CONFIRMED" }).score).toBe(10);
  });

  it("counts a candidate value as collected", () => {
    expect(computeCompleteness({ ...allUnknown, intent: "CANDIDATE" }).score).toBe(15);
  });

  it("scores a conflicted field as zero, same as unknown", () => {
    // Two contradicting sources is not partial knowledge — it is no
    // knowledge, and must show up as a gap for someone to resolve.
    const { score, missing } = computeCompleteness({ ...allUnknown, intent: "CONFLICTED" });
    expect(score).toBe(0);
    expect(missing).toContain("intent");
  });
});
