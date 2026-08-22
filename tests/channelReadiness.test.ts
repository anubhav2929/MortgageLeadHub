import { describe, expect, it } from "vitest";
import { anyChannelReady, evaluateChannelReadiness, type ChannelReadinessInput } from "@/core/channelReadiness";

// An unconfigured channel does NOT fail — the adapter logs the message and
// reports success. So without this gate the caller records SENT, consumes an
// attempt, and emits the event the cadence counts to advance. A lead marches
// through its whole schedule on a dead channel and lands in NURTURE having
// received nothing, looking fully worked.

function input(over: Partial<ChannelReadinessInput> = {}): ChannelReadinessInput {
  return { channel: "SMS", hasSms: false, hasEmail: false, hasVoiceAgent: false, isAutomated: true, ...over };
}

describe("automated steps require a real provider", () => {
  it("holds each channel when its provider is missing", () => {
    for (const channel of ["SMS", "EMAIL", "VOICE"] as const) {
      const d = evaluateChannelReadiness(input({ channel }));
      expect(d.ready).toBe(false);
      expect(d.hold).toBe(true);
      expect(d.reason).toBeTruthy();
    }
  });

  it("holds rather than consuming the step", () => {
    // Holding is the whole point: the step fires for real once the credential
    // is added, even days later. Counting it as done loses the lead.
    expect(evaluateChannelReadiness(input({ channel: "EMAIL" })).hold).toBe(true);
  });

  it("proceeds once the matching provider is configured", () => {
    expect(evaluateChannelReadiness(input({ channel: "SMS", hasSms: true })).ready).toBe(true);
    expect(evaluateChannelReadiness(input({ channel: "EMAIL", hasEmail: true })).ready).toBe(true);
    expect(evaluateChannelReadiness(input({ channel: "VOICE", hasVoiceAgent: true })).ready).toBe(true);
  });

  it("does not let one configured channel unlock another", () => {
    // The specific regression: SMS configured must not make email steps fire.
    expect(evaluateChannelReadiness(input({ channel: "EMAIL", hasSms: true })).ready).toBe(false);
    expect(evaluateChannelReadiness(input({ channel: "VOICE", hasSms: true, hasEmail: true })).ready).toBe(false);
  });
});

describe("manual sends still simulate", () => {
  it("never blocks a person clicking Send", () => {
    // Simulation is what makes the product demoable without credentials, and
    // the person is watching the result and told it was simulated.
    for (const channel of ["SMS", "EMAIL", "VOICE"] as const) {
      expect(evaluateChannelReadiness(input({ channel, isAutomated: false })).ready).toBe(true);
    }
  });
});

describe("total outage is a different problem", () => {
  it("distinguishes nothing-works from one-dead-channel", () => {
    expect(anyChannelReady({ hasSms: false, hasEmail: false, hasVoiceAgent: false })).toBe(false);
    expect(anyChannelReady({ hasSms: true, hasEmail: false, hasVoiceAgent: false })).toBe(true);
  });
});
