import { describe, expect, it } from "vitest";
import {
  producesConversation,
  selectVoiceStrategy,
  shouldAutomateVoice,
  type VoiceCapabilities,
} from "@/core/callStrategy";
import { classifyReferral, normalizePhone } from "@/core/intakeNormalization";

// The product has two things that were both called "a call": a real
// conversation (Vapi) and a one-way recorded announcement (Twilio TwiML).
// They are not interchangeable, and the announcement used to be the default
// on both the officer's Call button and every automated cadence step. These
// tests pin the preference order so that can't silently revert.

function caps(overrides: Partial<VoiceCapabilities> = {}): VoiceCapabilities {
  return { hasVoiceAgent: false, hasPartialVoiceAgent: false, hasTwilioVoice: false, ...overrides };
}

describe("selectVoiceStrategy — preference order", () => {
  it("uses the conversational agent whenever it is available", () => {
    const strategy = selectVoiceStrategy(caps({ hasVoiceAgent: true, hasTwilioVoice: true }));
    expect(strategy.mechanism).toBe("VAPI_AGENT");
    expect(strategy.degraded).toBe(false);
  });

  it("prefers the agent over Twilio even when both are configured", () => {
    // The whole bug: Twilio being present must not win. A recorded
    // announcement cannot qualify anyone.
    expect(selectVoiceStrategy(caps({ hasVoiceAgent: true, hasTwilioVoice: true })).mechanism).toBe("VAPI_AGENT");
  });

  it("falls back to the announcement only when no agent is configured", () => {
    const strategy = selectVoiceStrategy(caps({ hasTwilioVoice: true }));
    expect(strategy.mechanism).toBe("ANNOUNCEMENT");
    expect(strategy.degraded).toBe(true);
  });

  it("warns that an announcement cannot qualify the borrower", () => {
    const strategy = selectVoiceStrategy(caps({ hasTwilioVoice: true }));
    expect(strategy.reason).toMatch(/cannot respond|not qualify/i);
    expect(strategy.remedy).toMatch(/Vapi/);
  });

  it("names the missing Vapi fields when it is only partly configured", () => {
    // An operator who pasted the API key and saw a robocall needs to be told
    // which saved-assistant fields are still missing, not just "configure Vapi".
    const strategy = selectVoiceStrategy(caps({ hasTwilioVoice: true, hasPartialVoiceAgent: true }));
    expect(strategy.remedy).toMatch(/phone number ID/i);
    expect(strategy.remedy).toMatch(/assistant ID/i);
    expect(strategy.remedy).toMatch(/webhook secret/i);
  });

  it("simulates when nothing at all is configured", () => {
    const strategy = selectVoiceStrategy(caps());
    expect(strategy.mechanism).toBe("SIMULATED");
    expect(strategy.degraded).toBe(true);
    expect(strategy.reason).toMatch(/nothing was dialled/i);
  });

  it("always explains itself, in every configuration", () => {
    const combos = [
      caps(),
      caps({ hasTwilioVoice: true }),
      caps({ hasVoiceAgent: true }),
      caps({ hasPartialVoiceAgent: true }),
      caps({ hasPartialVoiceAgent: true, hasTwilioVoice: true }),
    ];
    for (const c of combos) {
      expect(selectVoiceStrategy(c).reason.length).toBeGreaterThan(0);
    }
  });

  it("offers a remedy for every degraded mechanism", () => {
    expect(selectVoiceStrategy(caps({ hasTwilioVoice: true })).remedy).toBeTruthy();
    expect(selectVoiceStrategy(caps()).remedy).toBeTruthy();
    // …and none for the good path, because there is nothing to fix.
    expect(selectVoiceStrategy(caps({ hasVoiceAgent: true })).remedy).toBeUndefined();
  });
});

describe("producesConversation", () => {
  it("is true only for the agent", () => {
    expect(producesConversation("VAPI_AGENT")).toBe(true);
    expect(producesConversation("ANNOUNCEMENT")).toBe(false);
    expect(producesConversation("SIMULATED")).toBe(false);
  });

  it("gates ConversationSession creation", () => {
    // An announcement never produces a transcript. Opening a session for one
    // leaves it IN_PROGRESS forever, waiting on a webhook that never comes.
    expect(producesConversation("ANNOUNCEMENT")).toBe(false);
  });
});

describe("shouldAutomateVoice", () => {
  it("lets the cadence place agent calls", () => {
    expect(shouldAutomateVoice("VAPI_AGENT")).toBe(true);
  });

  it("refuses to let the cadence place unattended robocalls", () => {
    // Repeated recorded calls to a consumer is the exact pattern TCPA
    // complaints are made of, and it cannot advance the lead anyway — the
    // cadence should route to SMS instead.
    expect(shouldAutomateVoice("ANNOUNCEMENT")).toBe(false);
  });

  it("allows the simulated path so the demo pipeline still runs", () => {
    expect(shouldAutomateVoice("SIMULATED")).toBe(true);
  });
});

// These two were briefly lost during the call-path refactor and rebuilt from
// their call sites. The tests exist so "rebuilt correctly" is a verified
// claim rather than an assumption.
describe("normalizePhone", () => {
  it("expands a 10-digit number to E.164", () => {
    expect(normalizePhone("5551234567")).toBe("+15551234567");
  });

  it("accepts an 11-digit number already carrying the country code", () => {
    expect(normalizePhone("15551234567")).toBe("+15551234567");
  });

  it("strips formatting humans actually type", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("555.123.4567")).toBe("+15551234567");
    expect(normalizePhone("+1 555 123 4567")).toBe("+15551234567");
  });

  it("rejects anything that isn't a US number rather than guessing", () => {
    // A best-effort string here would mean dialling a stranger.
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("25551234567")).toBeNull(); // 11 digits, wrong country code
    expect(normalizePhone("555123456789")).toBeNull();
    expect(normalizePhone("not a phone")).toBeNull();
  });
});

describe("classifyReferral", () => {
  it("routes 3+ missed payments to a foreclosure specialist", () => {
    expect(classifyReferral("THREE_PLUS")).toBe("FORECLOSURE");
  });

  it("routes 1-2 missed payments to loan modification", () => {
    expect(classifyReferral("ONE_TO_TWO")).toBe("LOAN_MODIFICATION");
  });

  it("leaves a current borrower on the normal path", () => {
    expect(classifyReferral("NONE")).toBe("NONE");
  });
});
