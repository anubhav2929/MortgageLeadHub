import { describe, expect, it } from "vitest";
import { describeEnvironment, shouldShowBanner, type EnvironmentInput } from "@/core/environmentBanner";

// The banner is the one place the app tells a visitor whether what they are
// seeing is real. A stale claim here is worse than no claim, so the copy is
// derived rather than hardcoded — and these tests pin the derivation.

function caps(overrides: Partial<EnvironmentInput> = {}): EnvironmentInput {
  return {
    hasSms: false,
    hasVoice: false,
    hasVoiceAgent: false,
    hasResend: false,
    hasLeadDiscovery: true,
    ...overrides,
  };
}

describe("nothing outbound configured", () => {
  it("says no real messages are sent", () => {
    const env = describeEnvironment(caps());
    expect(env.level).toBe("DEMO");
    expect(env.message).toMatch(/no real calls, texts, or emails are sent/i);
  });

  it("still admits discovery reads real data", () => {
    // The precise bug this replaces: the old copy said "synthetic data only"
    // while discovery was pulling live posts written by real people.
    const env = describeEnvironment(caps({ hasLeadDiscovery: true }));
    expect(env.message).toMatch(/real public posts/i);
    expect(env.message).not.toMatch(/synthetic data only/i);
  });
});

describe("some channels live", () => {
  it("names both the live and the simulated channels", () => {
    // Someone demoing needs to know which button reaches a stranger's phone.
    const env = describeEnvironment(caps({ hasSms: true, hasResend: true }));
    expect(env.level).toBe("PARTIAL");
    expect(env.message).toMatch(/texts/);
    expect(env.message).toMatch(/emails/);
    expect(env.message).toMatch(/Simulated:/);
    expect(env.liveChannels).toEqual(["texts", "emails"]);
    expect(env.simulatedChannels).toEqual(["calls", "AI voice calls"]);
  });

  it("never claims nothing is sent once any channel is live", () => {
    for (const key of ["hasSms", "hasVoice", "hasVoiceAgent", "hasResend"] as const) {
      const env = describeEnvironment(caps({ [key]: true }));
      expect(env.message).not.toMatch(/no real calls, texts, or emails are sent/i);
      expect(env.level).not.toBe("DEMO");
    }
  });
});

describe("everything live", () => {
  it("says so plainly", () => {
    const env = describeEnvironment(
      caps({ hasSms: true, hasVoice: true, hasVoiceAgent: true, hasResend: true })
    );
    expect(env.level).toBe("LIVE");
    expect(env.message).toMatch(/real calls, texts, and emails to real people/i);
    expect(env.simulatedChannels).toEqual([]);
  });
});

describe("admin visibility toggle", () => {
  it("hides the banner when the admin turns it off, in every state", () => {
    // Including LIVE. The banner is an internal build-status affordance in the
    // root layout, so it renders on public marketing pages too — a real
    // production site is exactly the one that should not shout "LIVE" at
    // borrowers. Safety comes from the copy being accurate, not from forcing
    // it on-screen.
    for (const level of ["DEMO", "PARTIAL", "LIVE"] as const) {
      expect(shouldShowBanner(level, false)).toBe(false);
      expect(shouldShowBanner(level, true)).toBe(true);
    }
  });
});
