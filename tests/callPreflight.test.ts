import { describe, expect, it } from "vitest";
import { consumesAttempt, evaluateCallPreflight, type PreflightInput } from "@/core/callPreflight";

// Most "call failures" were never failures of the call — they were calls that
// should not have been attempted. Each one still reached the provider, was
// rejected, spent an attempt from the lead's budget, and left a red row for
// someone to decode.

function input(over: Partial<PreflightInput> = {}): PreflightInput {
  return {
    phoneE164: "+15125550142",
    hasVoiceAgent: true,
    hasAnnouncementVoice: false,
    hasLiveCall: false,
    providerMisconfigured: false,
    isAutomated: true,
    ...over,
  };
}

describe("a well-formed call proceeds", () => {
  it("allows a valid number with a configured provider", () => {
    expect(evaluateCallPreflight(input()).allowed).toBe(true);
  });
});

describe("bad data on the lead", () => {
  it("refuses a missing number and says which field", () => {
    const d = evaluateCallPreflight(input({ phoneE164: undefined }));
    expect(d.blocker).toBe("NO_PHONE_NUMBER");
    expect(d.remedy).toMatch(/add a number/i);
  });

  it("refuses a number the provider would reject anyway", () => {
    // Catching it here names the field; letting it through returns an opaque
    // provider 400 three seconds later.
    for (const bad of ["5125550142", "+0123", "not-a-number", "+1512555014299999"]) {
      expect(evaluateCallPreflight(input({ phoneE164: bad })).blocker).toBe("MALFORMED_PHONE_NUMBER");
    }
  });
});

describe("provider problems", () => {
  it("refuses when nothing is connected", () => {
    const d = evaluateCallPreflight(input({ hasVoiceAgent: false, hasAnnouncementVoice: false }));
    expect(d.blocker).toBe("NO_VOICE_PROVIDER");
  });

  it("stops dialling into a known-broken credential", () => {
    // The same failure repeats on every lead; each extra attempt is one more
    // row an administrator has to read past to find the real problem.
    const d = evaluateCallPreflight(input({ providerMisconfigured: true }));
    expect(d.blocker).toBe("PROVIDER_MISCONFIGURED");
    expect(d.remedy).toMatch(/verify Vapi/i);
  });

  it("checks configuration before provider availability", () => {
    const d = evaluateCallPreflight(input({ providerMisconfigured: true, hasVoiceAgent: false }));
    expect(d.blocker).toBe("PROVIDER_MISCONFIGURED");
  });

  it("allows a manual retry so an operator can prove the configuration repair", () => {
    const d = evaluateCallPreflight(input({ providerMisconfigured: true, isAutomated: false }));
    expect(d.allowed).toBe(true);
  });
});

describe("double-dialling", () => {
  it("stops the cadence calling someone already on the line", () => {
    expect(evaluateCallPreflight(input({ hasLiveCall: true })).blocker).toBe("ALREADY_ON_A_CALL");
  });

  it("lets an officer call anyway — that is an informed decision", () => {
    expect(evaluateCallPreflight(input({ hasLiveCall: true, isAutomated: false })).allowed).toBe(true);
  });
});

describe("our faults never spend the borrower's attempt budget", () => {
  it("charges no attempt for any blocker", () => {
    // A bad API key that consumed attempts would quietly exhaust every lead's
    // cadence and drop them all into NURTURE having never been called —
    // and fixing the key would not bring them back.
    for (const b of ["NO_PHONE_NUMBER", "MALFORMED_PHONE_NUMBER", "NO_VOICE_PROVIDER", "PROVIDER_MISCONFIGURED", "ALREADY_ON_A_CALL"] as const) {
      expect(consumesAttempt(b)).toBe(false);
    }
  });
});
