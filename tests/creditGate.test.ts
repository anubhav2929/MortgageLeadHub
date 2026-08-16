import { describe, expect, it } from "vitest";
import {
  evaluateCreditGate,
  hasIdentityForPull,
  meetsIntentThreshold,
  FCRA_CREDIT_AUTHORIZATION_TEXT,
  type CreditGateInput,
} from "@/core/creditGate";
import { scoreToBand } from "@/adapters/creditCheck";

// A soft pull is billed per inquiry AND is a consumer report under FCRA.
// The negative cases here are the ones that matter: firing without
// authorisation is a statutory violation, and firing on a tyre-kicker is
// money spent on nothing.

function input(overrides: Partial<CreditGateInput> = {}): CreditGateInput {
  return {
    trigger: "INTAKE_QUALIFIED",
    hasFcraConsent: true,
    firstName: "Jennifer",
    lastName: "Martinez",
    addressLine1: "123 Main St",
    city: "Irvine",
    stateCode: "CA",
    intent: "CASH_OUT",
    goal: "DEBT_CONSOLIDATION",
    timeline: "ASAP",
    missedPayments: "NONE",
    previousPullCount: 0,
    ...overrides,
  };
}

describe("consent is absolute", () => {
  it("refuses without FCRA authorisation", () => {
    const result = evaluateCreditGate(input({ hasFcraConsent: false }));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.blocker).toBe("NO_FCRA_CONSENT");
  });

  it("refuses an officer-triggered pull without authorisation too", () => {
    // Staff convenience is not a permissible purpose. An officer cannot
    // authorise an inquiry on the borrower's behalf.
    const result = evaluateCreditGate(input({ trigger: "OFFICER_REQUEST", hasFcraConsent: false }));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.blocker).toBe("NO_FCRA_CONSENT");
  });

  it("refuses an explicit chat request without authorisation", () => {
    const result = evaluateCreditGate(input({ trigger: "CHAT_PREQUAL_REQUEST", hasFcraConsent: false }));
    expect(result.allowed).toBe(false);
  });

  it("checks consent before anything else, so the reason names the real blocker", () => {
    // Missing consent AND missing identity — the operator must be told about
    // the consent problem, not sent off to collect an address.
    const result = evaluateCreditGate(input({ hasFcraConsent: false, addressLine1: undefined }));
    if (!result.allowed) expect(result.blocker).toBe("NO_FCRA_CONSENT");
  });
});

describe("cost control", () => {
  it("never pulls twice for the same lead", () => {
    const result = evaluateCreditGate(input({ previousPullCount: 1 }));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.blocker).toBe("ALREADY_PULLED");
  });

  it("refuses a passive intake pull when the questionnaire is incomplete", () => {
    // Someone who typed a name and left has not earned a billed inquiry.
    const result = evaluateCreditGate(input({ timeline: undefined, missedPayments: undefined }));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.blocker).toBe("LOW_INTENT");
  });

  it("allows an explicit button press even on a thin questionnaire", () => {
    // Pressing "show me what I pre-qualify for" IS the intent signal — there
    // is nothing further to prove.
    const result = evaluateCreditGate(
      input({ trigger: "CHAT_PREQUAL_REQUEST", timeline: undefined, missedPayments: undefined })
    );
    expect(result.allowed).toBe(true);
  });

  it("allows an officer request on a thin questionnaire", () => {
    const result = evaluateCreditGate(
      input({ trigger: "OFFICER_REQUEST", goal: undefined, timeline: undefined, missedPayments: undefined })
    );
    expect(result.allowed).toBe(true);
  });
});

describe("identity sufficiency", () => {
  it("refuses without a street address — the pull would simply miss", () => {
    const result = evaluateCreditGate(input({ addressLine1: undefined }));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.blocker).toBe("INSUFFICIENT_IDENTITY");
  });

  it.each(["firstName", "lastName", "stateCode"] as const)("refuses without %s", (field) => {
    const result = evaluateCreditGate(input({ [field]: undefined }));
    expect(result.allowed).toBe(false);
  });

  it("treats whitespace as missing", () => {
    expect(hasIdentityForPull(input({ addressLine1: "   " }))).toBe(false);
  });

  it("accepts a complete identity", () => {
    expect(hasIdentityForPull(input())).toBe(true);
  });
});

describe("meetsIntentThreshold", () => {
  it("requires what, when, and situation together", () => {
    expect(meetsIntentThreshold(input())).toBe(true);
    expect(meetsIntentThreshold(input({ goal: undefined }))).toBe(false);
    expect(meetsIntentThreshold(input({ timeline: undefined }))).toBe(false);
    expect(meetsIntentThreshold(input({ missedPayments: undefined }))).toBe(false);
  });

  it("does not count UNKNOWN intent as an answer", () => {
    expect(meetsIntentThreshold(input({ intent: "UNKNOWN" }))).toBe(false);
  });

  it("counts NONE missed payments as a real answer", () => {
    // "No, I haven't missed any" is information, not an absence of it.
    expect(meetsIntentThreshold(input({ missedPayments: "NONE" }))).toBe(true);
  });
});

describe("the happy path", () => {
  it("allows a fully qualified, consented intake pull", () => {
    const result = evaluateCreditGate(input());
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.trigger).toBe("INTAKE_QUALIFIED");
  });

  it("always explains itself either way", () => {
    expect(evaluateCreditGate(input()).reason.length).toBeGreaterThan(0);
    expect(evaluateCreditGate(input({ hasFcraConsent: false })).reason.length).toBeGreaterThan(0);
  });
});

describe("FCRA authorisation text", () => {
  it("states the inquiry is soft and will not affect the score", () => {
    expect(FCRA_CREDIT_AUTHORIZATION_TEXT).toMatch(/soft/i);
    expect(FCRA_CREDIT_AUTHORIZATION_TEXT).toMatch(/not affect/i);
  });

  it("says agreement is not required — it must be genuinely optional", () => {
    expect(FCRA_CREDIT_AUTHORIZATION_TEXT).toMatch(/not required/i);
  });

  it("names the purpose, which is what permissible purpose means", () => {
    expect(FCRA_CREDIT_AUTHORIZATION_TEXT).toMatch(/pre-qualif/i);
  });
});

describe("scoreToBand", () => {
  it("maps each band at its boundary", () => {
    expect(scoreToBand(740)).toBe("EXCELLENT_740_PLUS");
    expect(scoreToBand(739)).toBe("GOOD_680_739");
    expect(scoreToBand(680)).toBe("GOOD_680_739");
    expect(scoreToBand(679)).toBe("FAIR_620_679");
    expect(scoreToBand(620)).toBe("FAIR_620_679");
    expect(scoreToBand(619)).toBe("BELOW_620");
  });

  it("handles the extremes without falling through", () => {
    expect(scoreToBand(850)).toBe("EXCELLENT_740_PLUS");
    expect(scoreToBand(300)).toBe("BELOW_620");
  });
});
