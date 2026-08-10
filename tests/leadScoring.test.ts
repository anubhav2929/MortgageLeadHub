import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOT_LEAD_THRESHOLD,
  DEFAULT_SCORING_WEIGHTS,
  computeLeadQualityScore,
  type LeadScoringInput,
} from "@/core/leadScoring";

// The score decides whether a lead is hot-transferred to a licensed officer
// or dropped into the AI nurture cadence. Getting it wrong is expensive in
// both directions, so the tests pin the boundaries of each of the four
// components rather than just the aggregate.

function input(overrides: Partial<LeadScoringInput> = {}): LeadScoringInput {
  return {
    stateCode: "FL",
    intent: "REFINANCE",
    goal: "LOWER_PAYMENT",
    timeline: "EXPLORING",
    ...overrides,
  };
}

describe("equity component", () => {
  it("awards full marks at or below 70% LTV", () => {
    const result = computeLeadQualityScore(input({ estimatedValue: 500_000, mortgageBalance: 350_000 }));
    expect(result.breakdown.equity).toBe(DEFAULT_SCORING_WEIGHTS.equity);
    expect(result.ltv).toBe(70);
  });

  it("awards partial marks between 70% and 80% LTV", () => {
    const result = computeLeadQualityScore(input({ estimatedValue: 500_000, mortgageBalance: 400_000 }));
    expect(result.breakdown.equity).toBe(25);
    expect(result.ltv).toBe(80);
  });

  it("awards nothing above 80% LTV — there is no equity to lend against", () => {
    const result = computeLeadQualityScore(input({ estimatedValue: 500_000, mortgageBalance: 450_000 }));
    expect(result.breakdown.equity).toBe(0);
  });

  it("scores zero and reports an unknown LTV when value is missing", () => {
    // Missing data must not be scored as if it were good data.
    const result = computeLeadQualityScore(input({ mortgageBalance: 100_000 }));
    expect(result.breakdown.equity).toBe(0);
    expect(result.ltv).toBeNull();
  });

  it("does not divide by zero on a zero valuation", () => {
    const result = computeLeadQualityScore(input({ estimatedValue: 0, mortgageBalance: 100_000 }));
    expect(result.ltv).toBeNull();
    expect(Number.isFinite(result.total)).toBe(true);
  });

  it("gives full marks to a free-and-clear home", () => {
    const result = computeLeadQualityScore(input({ estimatedValue: 400_000, mortgageBalance: 0 }));
    expect(result.breakdown.equity).toBe(DEFAULT_SCORING_WEIGHTS.equity);
    expect(result.ltv).toBe(0);
  });
});

describe("margin component", () => {
  it("ranks cash-out highest", () => {
    expect(computeLeadQualityScore(input({ intent: "CASH_OUT" })).breakdown.margin).toBe(25);
  });

  it("treats a debt-consolidation goal as a cash-out-grade opportunity", () => {
    expect(computeLeadQualityScore(input({ goal: "DEBT_CONSOLIDATION" })).breakdown.margin).toBe(25);
  });

  it("ranks home equity in the middle", () => {
    expect(computeLeadQualityScore(input({ intent: "HOME_EQUITY" })).breakdown.margin).toBe(20);
  });

  it("ranks a rate-and-term refinance lowest", () => {
    expect(computeLeadQualityScore(input({ intent: "REFINANCE", goal: "SHORTEN_TERM" })).breakdown.margin).toBe(10);
  });
});

describe("compliance component", () => {
  it("gives full marks in a priority licensed state", () => {
    expect(computeLeadQualityScore(input({ stateCode: "FL" })).breakdown.compliance).toBe(20);
  });

  it("gives partial marks in a recognised but non-priority state", () => {
    // AZ is a supported state but not one of the six licensing-priority ones.
    expect(computeLeadQualityScore(input({ stateCode: "AZ" })).breakdown.compliance).toBe(10);
  });

  it("gives nothing for an unrecognised state code", () => {
    // Zero here is the signal that routes the lead to an external partner
    // rather than to an officer who isn't licensed to take it.
    expect(computeLeadQualityScore(input({ stateCode: "ZZ" })).breakdown.compliance).toBe(0);
  });
});

describe("behavior component", () => {
  it("requires both urgency and speed for full marks", () => {
    const result = computeLeadQualityScore(
      input({ timeline: "ASAP", goal: "CASH_OUT", intakeDurationSeconds: 60 })
    );
    expect(result.breakdown.behavior).toBe(15);
  });

  it("gives only the baseline when the borrower is fast but not urgent", () => {
    expect(computeLeadQualityScore(input({ intakeDurationSeconds: 30 })).breakdown.behavior).toBe(8);
  });

  it("gives only the baseline when urgent but slow to complete", () => {
    const result = computeLeadQualityScore(
      input({ timeline: "ASAP", goal: "CASH_OUT", intakeDurationSeconds: 600 })
    );
    expect(result.breakdown.behavior).toBe(8);
  });

  it("reads urgency out of what the borrower actually said", () => {
    const result = computeLeadQualityScore(
      input({ intakeDurationSeconds: 45, borrowerUtterances: ["I'm behind on my payments and need help ASAP"] })
    );
    expect(result.breakdown.behavior).toBe(15);
  });

  it("matches urgency keywords regardless of casing", () => {
    const result = computeLeadQualityScore(
      input({ intakeDurationSeconds: 45, borrowerUtterances: ["FORECLOSURE notice arrived"] })
    );
    expect(result.breakdown.behavior).toBe(15);
  });

  it("treats missed payments plus an ASAP timeline as urgent", () => {
    const result = computeLeadQualityScore(
      input({ timeline: "ASAP", missedPayments: "THREE_PLUS", intakeDurationSeconds: 45 })
    );
    expect(result.breakdown.behavior).toBe(15);
  });

  it("does not treat NONE missed payments as an urgency signal on its own", () => {
    const result = computeLeadQualityScore(
      input({ timeline: "ASAP", missedPayments: "NONE", goal: "LOWER_PAYMENT", intakeDurationSeconds: 45 })
    );
    expect(result.breakdown.behavior).toBe(8);
  });
});

describe("aggregate scoring", () => {
  it("caps at 100 for a perfect lead", () => {
    const result = computeLeadQualityScore(
      input({
        stateCode: "FL",
        intent: "CASH_OUT",
        goal: "DEBT_CONSOLIDATION",
        timeline: "ASAP",
        estimatedValue: 600_000,
        mortgageBalance: 200_000,
        intakeDurationSeconds: 60,
      })
    );
    expect(result.total).toBe(100);
    expect(result.tier).toBe("HOT");
  });

  it("never returns a negative total for the worst possible lead", () => {
    const result = computeLeadQualityScore(input({ stateCode: "ZZ", estimatedValue: 100_000, mortgageBalance: 99_000 }));
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.tier).toBe("STANDARD");
  });

  it("keeps the breakdown consistent with the total", () => {
    const { total, breakdown } = computeLeadQualityScore(
      input({ estimatedValue: 500_000, mortgageBalance: 300_000 })
    );
    expect(breakdown.equity + breakdown.margin + breakdown.compliance + breakdown.behavior).toBe(total);
  });

  it("treats the hot threshold as exclusive, so exactly-at-threshold is not hot", () => {
    // A boundary worth pinning: an off-by-one here silently changes who gets
    // a live officer transfer.
    const atThreshold = computeLeadQualityScore(
      input({ stateCode: "FL", intent: "CASH_OUT", estimatedValue: 500_000, mortgageBalance: 350_000 }),
      DEFAULT_SCORING_WEIGHTS,
      93
    );
    expect(atThreshold.total).toBe(93);
    expect(atThreshold.tier).toBe("STANDARD");
    expect(
      computeLeadQualityScore(
        input({ stateCode: "FL", intent: "CASH_OUT", estimatedValue: 500_000, mortgageBalance: 350_000 }),
        DEFAULT_SCORING_WEIGHTS,
        92
      ).tier
    ).toBe("HOT");
  });

  it("honours admin-configured weights instead of the defaults", () => {
    const result = computeLeadQualityScore(
      input({ estimatedValue: 500_000, mortgageBalance: 100_000 }),
      { equity: 80, margin: 10, compliance: 5, behavior: 5 }
    );
    expect(result.breakdown.equity).toBe(80);
  });

  it("exposes a documented default threshold", () => {
    expect(DEFAULT_HOT_LEAD_THRESHOLD).toBe(80);
  });
});
