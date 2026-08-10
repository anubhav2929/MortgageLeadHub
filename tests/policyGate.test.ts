import { describe, expect, it } from "vitest";
import { evaluatePolicyGate, hasActiveOverride, type GateInput } from "@/core/policyGate";

// PolicyGate decides whether an outbound contact is legally permitted. A
// false ALLOW here is a TCPA violation, which carries statutory damages per
// message — so these tests assert the DENY paths at least as hard as the
// happy path, and pin the *precedence* between rules. Precedence matters:
// a suppressed number that is also inside quiet hours must report
// SUPPRESSED_GLOBAL (a permanent bar), never QUIET_HOURS_LOCAL (a temporary
// defer), or the caller would retry something it must never retry.

/** Tuesday 2026-08-11, 15:00 UTC = 10:00 America/Chicago — inside every
 *  quiet-hours window, on a weekday, so it isolates the rule under test. */
const SAFE_NOW = new Date("2026-08-11T15:00:00Z");

function gateInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    now: SAFE_NOW,
    channel: "SMS",
    phoneE164: "+15125550142",
    personTimezone: "America/Chicago",
    propertyStateCode: "TX",
    consents: [{ scope: "CONTACT_SMS", granted: true }],
    suppressions: [],
    attemptsToday: 0,
    attemptsTotal: 0,
    lastAttemptAt: null,
    leadState: "NEW",
    killSwitchOn: false,
    cadenceStep: { maxAttempts: 5, channel: "SMS" },
    ...overrides,
  };
}

describe("evaluatePolicyGate — baseline", () => {
  it("allows a consented weekday daytime contact", () => {
    const result = evaluatePolicyGate(gateInput());
    expect(result.decision).toBe("ALLOW");
    expect(result.reasons).toEqual(["ALLOW"]);
  });
});

describe("evaluatePolicyGate — hard denials", () => {
  it("denies everything while the global kill switch is on", () => {
    const result = evaluatePolicyGate(gateInput({ killSwitchOn: true }));
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("KILL_SWITCH");
  });

  it("denies when the number carries an active global suppression", () => {
    const result = evaluatePolicyGate(gateInput({ suppressions: [{ scope: "GLOBAL" }] }));
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("SUPPRESSED_GLOBAL");
  });

  it("denies only the suppressed channel, leaving others open", () => {
    const suppressions: GateInput["suppressions"] = [{ scope: "CHANNEL", channel: "SMS" }];

    const sms = evaluatePolicyGate(gateInput({ channel: "SMS", suppressions }));
    expect(sms.decision).toBe("DENY");
    expect(sms.reasons).toContain("SUPPRESSED_CHANNEL");

    const email = evaluatePolicyGate(
      gateInput({ channel: "EMAIL", suppressions, consents: [{ scope: "CONTACT_EMAIL", granted: true }] })
    );
    expect(email.decision).toBe("ALLOW");
  });

  it("ignores a suppression that has already expired", () => {
    const result = evaluatePolicyGate(
      gateInput({ suppressions: [{ scope: "GLOBAL", expiresAt: "2020-01-01T00:00:00Z" }] })
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("denies when no consent record exists for the channel", () => {
    const result = evaluatePolicyGate(gateInput({ consents: [] }));
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("NO_CONSENT");
  });

  it("distinguishes revoked consent from absent consent", () => {
    const result = evaluatePolicyGate(gateInput({ consents: [{ scope: "CONTACT_SMS", granted: false }] }));
    expect(result.decision).toBe("DENY");
    // The distinction is not cosmetic — revocation is evidence the borrower
    // acted, and is what a regulator asks to see.
    expect(result.reasons).toContain("CONSENT_REVOKED");
  });

  it("does not let consent for one channel authorise another", () => {
    const result = evaluatePolicyGate(
      gateInput({ channel: "VOICE", consents: [{ scope: "CONTACT_SMS", granted: true }] })
    );
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("NO_CONSENT");
  });

  it.each(["CLOSED_WON", "CLOSED_LOST", "SUPPRESSED"] as const)("denies in terminal state %s", (leadState) => {
    const result = evaluatePolicyGate(gateInput({ leadState }));
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("LEAD_TERMINAL");
  });

  it("denies once total attempts reach the cadence cap", () => {
    const result = evaluatePolicyGate(gateInput({ attemptsTotal: 5, cadenceStep: { maxAttempts: 5, channel: "SMS" } }));
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("ATTEMPT_CAP_TOTAL");
  });
});

describe("evaluatePolicyGate — officer ownership", () => {
  it("blocks automation once an officer owns the lead", () => {
    const result = evaluatePolicyGate(gateInput({ leadState: "ASSIGNED" }));
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("OFFICER_OWNED");
  });

  it("still lets that officer act manually", () => {
    const result = evaluatePolicyGate(gateInput({ leadState: "ASSIGNED", isManualOfficerAction: true }));
    expect(result.decision).toBe("ALLOW");
  });
});

describe("evaluatePolicyGate — time-based defers", () => {
  it("defers outside local quiet hours and says when it may retry", () => {
    // 03:00 UTC = 22:00 previous day in Chicago — after the 21:00 cutoff.
    const result = evaluatePolicyGate(gateInput({ now: new Date("2026-08-12T03:00:00Z") }));
    expect(result.decision).toBe("DEFER");
    expect(result.reasons).toContain("QUIET_HOURS_LOCAL");
    expect(result.nextPermittedAt).toBeInstanceOf(Date);
    expect(result.nextPermittedAt!.getTime()).toBeGreaterThan(new Date("2026-08-12T03:00:00Z").getTime());
  });

  it("applies a state's stricter window over the default", () => {
    // 13:30 UTC = 08:30 in Florida (EDT). Legal under the 8:00 default,
    // but Florida requires 9:00.
    const florida = evaluatePolicyGate(
      gateInput({ now: new Date("2026-08-11T12:30:00Z"), personTimezone: "America/New_York", propertyStateCode: "FL" })
    );
    expect(florida.decision).toBe("DEFER");
    expect(florida.reasons).toContain("QUIET_HOURS_LOCAL");

    const texas = evaluatePolicyGate(
      gateInput({ now: new Date("2026-08-11T13:30:00Z"), personTimezone: "America/New_York", propertyStateCode: "TX" })
    );
    expect(texas.decision).toBe("ALLOW");
  });

  it("never applies quiet hours or the weekend rule to email", () => {
    const result = evaluatePolicyGate(
      gateInput({
        channel: "EMAIL",
        consents: [{ scope: "CONTACT_EMAIL", granted: true }],
        now: new Date("2026-08-16T04:00:00Z"), // Sunday, middle of the night
      })
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("defers on Sunday for phone channels", () => {
    // Sunday 2026-08-16, 15:00 UTC = 10:00 Chicago — daytime, but a Sunday.
    const result = evaluatePolicyGate(gateInput({ now: new Date("2026-08-16T15:00:00Z") }));
    expect(result.decision).toBe("DEFER");
    expect(result.reasons).toContain("WEEKEND_RULE");
  });

  it("defers rather than denies when the timezone is unknown", () => {
    const result = evaluatePolicyGate(gateInput({ personTimezone: "UNKNOWN" }));
    // DEFER, not DENY: we lack information, we haven't been told no.
    expect(result.decision).toBe("DEFER");
    expect(result.reasons).toContain("UNKNOWN_TIMEZONE");
    expect(result.nextPermittedAt).toBeInstanceOf(Date);
  });

  it("defers once the daily attempt cap is reached", () => {
    const result = evaluatePolicyGate(gateInput({ attemptsToday: 3 }));
    expect(result.decision).toBe("DEFER");
    expect(result.reasons).toContain("ATTEMPT_CAP_DAILY");
  });

  it("defers when the last attempt was inside the minimum spacing window", () => {
    const result = evaluatePolicyGate(
      gateInput({ lastAttemptAt: new Date(SAFE_NOW.getTime() - 60 * 60 * 1000) }) // 1h ago, min is 4h
    );
    expect(result.decision).toBe("DEFER");
    expect(result.reasons).toContain("MIN_SPACING");
    expect(result.nextPermittedAt!.getTime()).toBe(SAFE_NOW.getTime() + 3 * 60 * 60 * 1000);
  });

  it("allows once the spacing window has elapsed", () => {
    const result = evaluatePolicyGate(
      gateInput({ lastAttemptAt: new Date(SAFE_NOW.getTime() - 5 * 60 * 60 * 1000) })
    );
    expect(result.decision).toBe("ALLOW");
  });
});

describe("evaluatePolicyGate — admin-configurable limits", () => {
  it("honours a tightened daily cap from system config", () => {
    const result = evaluatePolicyGate(gateInput({ attemptsToday: 1, config: { dailyAttemptCap: 1 } }));
    expect(result.decision).toBe("DEFER");
    expect(result.reasons).toContain("ATTEMPT_CAP_DAILY");
  });

  it("honours a widened spacing window from system config", () => {
    const result = evaluatePolicyGate(
      gateInput({ lastAttemptAt: new Date(SAFE_NOW.getTime() - 5 * 60 * 60 * 1000), config: { minSpacingHours: 8 } })
    );
    expect(result.decision).toBe("DEFER");
    expect(result.reasons).toContain("MIN_SPACING");
  });
});

describe("evaluatePolicyGate — rule precedence", () => {
  // A permanent bar must always win over a temporary one. If a suppressed
  // number reported QUIET_HOURS_LOCAL, the caller would schedule a retry for
  // a number it must never contact again.
  it("reports suppression, not quiet hours, when both apply", () => {
    const result = evaluatePolicyGate(
      gateInput({ now: new Date("2026-08-12T03:00:00Z"), suppressions: [{ scope: "GLOBAL" }] })
    );
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toEqual(["SUPPRESSED_GLOBAL"]);
  });

  it("reports the kill switch above every other condition", () => {
    const result = evaluatePolicyGate(
      gateInput({ killSwitchOn: true, suppressions: [{ scope: "GLOBAL" }], consents: [], leadState: "CLOSED_LOST" })
    );
    expect(result.reasons).toEqual(["KILL_SWITCH"]);
  });

  it("reports missing consent above a terminal lead state", () => {
    const result = evaluatePolicyGate(gateInput({ consents: [], leadState: "CLOSED_LOST" }));
    expect(result.reasons).toEqual(["NO_CONSENT"]);
  });
});

// ---------------------------------------------------------------------------
// Admin outreach overrides. These exist so a person can make a deliberate
// out-of-hours call. The tests that matter most are the negative ones: an
// override must relax *pacing* and nothing else, and automation must never
// inherit it. If any of these ever go green in the wrong direction, the app
// is helping someone break the law.
// ---------------------------------------------------------------------------

const ALL_OVERRIDES = {
  ignoreQuietHours: true,
  ignoreAttemptCaps: true,
  ignoreMinSpacing: true,
} as const;

// 3am in the borrower's local timezone — comfortably inside quiet hours.
const NIGHT = new Date("2026-08-11T08:00:00Z"); // 03:00 America/Chicago

describe("outreach overrides — what they may relax", () => {
  it("normally defers a 3am text", () => {
    const result = evaluatePolicyGate(gateInput({ now: NIGHT, isManualOfficerAction: true }));
    expect(result.decision).toBe("DEFER");
    expect(result.reasons).toContain("QUIET_HOURS_LOCAL");
  });

  it("allows a 3am text when an admin has enabled the quiet-hours override", () => {
    const result = evaluatePolicyGate(
      gateInput({ now: NIGHT, isManualOfficerAction: true, overrides: { ignoreQuietHours: true } })
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("allows exceeding the daily cap when that override is on", () => {
    const base = gateInput({ attemptsToday: 99, isManualOfficerAction: true });
    expect(evaluatePolicyGate(base).reasons).toContain("ATTEMPT_CAP_DAILY");
    expect(evaluatePolicyGate({ ...base, overrides: { ignoreAttemptCaps: true } }).decision).toBe("ALLOW");
  });

  it("allows back-to-back attempts when that override is on", () => {
    const base = gateInput({ lastAttemptAt: new Date(SAFE_NOW.getTime() - 60_000), isManualOfficerAction: true });
    expect(evaluatePolicyGate(base).reasons).toContain("MIN_SPACING");
    expect(evaluatePolicyGate({ ...base, overrides: { ignoreMinSpacing: true } }).decision).toBe("ALLOW");
  });

  it("relaxes only the rule it names", () => {
    // Enabling the quiet-hours override must not also lift the daily cap.
    const result = evaluatePolicyGate(
      gateInput({ now: NIGHT, attemptsToday: 99, isManualOfficerAction: true, overrides: { ignoreQuietHours: true } })
    );
    expect(result.reasons).toContain("ATTEMPT_CAP_DAILY");
  });
});

describe("outreach overrides — what they must NEVER relax", () => {
  const manualWithEverything = { isManualOfficerAction: true, overrides: ALL_OVERRIDES };

  it("cannot override the global kill switch", () => {
    const result = evaluatePolicyGate(gateInput({ ...manualWithEverything, killSwitchOn: true }));
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("KILL_SWITCH");
  });

  it("cannot override a global suppression", () => {
    const result = evaluatePolicyGate(
      gateInput({ ...manualWithEverything, suppressions: [{ scope: "GLOBAL" }] })
    );
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("SUPPRESSED_GLOBAL");
  });

  it("cannot override a channel suppression", () => {
    const result = evaluatePolicyGate(
      gateInput({ ...manualWithEverything, suppressions: [{ scope: "CHANNEL", channel: "SMS" }] })
    );
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("SUPPRESSED_CHANNEL");
  });

  it("cannot override missing consent", () => {
    const result = evaluatePolicyGate(gateInput({ ...manualWithEverything, consents: [] }));
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("NO_CONSENT");
  });

  it("cannot override revoked consent — an opt-out stays an opt-out", () => {
    const result = evaluatePolicyGate(
      gateInput({ ...manualWithEverything, consents: [{ scope: "CONTACT_SMS", granted: false }] })
    );
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("CONSENT_REVOKED");
  });

  it("cannot override a terminal lead state", () => {
    for (const leadState of ["SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"] as const) {
      const result = evaluatePolicyGate(gateInput({ ...manualWithEverything, leadState }));
      expect(result.decision, leadState).toBe("DENY");
      expect(result.reasons).toContain("LEAD_TERMINAL");
    }
  });

  it("cannot override the per-cadence total attempt cap", () => {
    const result = evaluatePolicyGate(
      gateInput({ ...manualWithEverything, attemptsTotal: 99, cadenceStep: { maxAttempts: 5, channel: "SMS" } })
    );
    expect(result.decision).toBe("DENY");
    expect(result.reasons).toContain("ATTEMPT_CAP_TOTAL");
  });
});

describe("outreach overrides — automation never inherits them", () => {
  it("still defers a 3am automated step even with every override enabled", () => {
    // The single most important assertion here. A human choosing to call late
    // is accountable; an unattended dialer at 3am is a TCPA claim.
    const result = evaluatePolicyGate(
      gateInput({ now: NIGHT, isManualOfficerAction: false, overrides: ALL_OVERRIDES })
    );
    expect(result.decision).toBe("DEFER");
    expect(result.reasons).toContain("QUIET_HOURS_LOCAL");
  });

  it("still enforces the daily cap for automated steps", () => {
    const result = evaluatePolicyGate(
      gateInput({ attemptsToday: 99, isManualOfficerAction: false, overrides: ALL_OVERRIDES })
    );
    expect(result.reasons).toContain("ATTEMPT_CAP_DAILY");
  });

  it("still enforces minimum spacing for automated steps", () => {
    const result = evaluatePolicyGate(
      gateInput({
        lastAttemptAt: new Date(SAFE_NOW.getTime() - 60_000),
        isManualOfficerAction: false,
        overrides: ALL_OVERRIDES,
      })
    );
    expect(result.reasons).toContain("MIN_SPACING");
  });
});

describe("hasActiveOverride", () => {
  it("is false when nothing is set", () => {
    expect(hasActiveOverride(undefined)).toBe(false);
    expect(hasActiveOverride({})).toBe(false);
  });

  it("is true when any single override is on, so the send gets audited", () => {
    expect(hasActiveOverride({ ignoreQuietHours: true })).toBe(true);
    expect(hasActiveOverride({ ignoreAttemptCaps: true })).toBe(true);
    expect(hasActiveOverride({ ignoreMinSpacing: true })).toBe(true);
  });
});
