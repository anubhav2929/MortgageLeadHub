import { describe, expect, it } from "vitest";
import { preferenceIsUnavailable, resolveAiProvider } from "@/core/aiRouting";

// Provider choice used to be inlined in eight functions that did not agree:
// most preferred Anthropic, signal assessment preferred NVIDIA, and transcript
// extraction supported Anthropic only — silently dropping to a keyword scan on
// an NVIDIA-only deployment while the panel reported the LLM as live.

describe("AUTO — whatever is configured", () => {
  it("prefers the free tier for high-volume work", () => {
    // Outreach copy and discovery scoring run constantly. Spending metered
    // credit on them by default is a cost surprise nobody asked for.
    expect(resolveAiProvider({ hasAnthropic: true, hasNvidia: true })).toBe("NVIDIA");
  });

  it("prefers schema-constrained output when the result is written to the record", () => {
    expect(
      resolveAiProvider({ hasAnthropic: true, hasNvidia: true, needsStructuredOutput: true })
    ).toBe("ANTHROPIC");
  });

  it("uses whichever single provider exists", () => {
    expect(resolveAiProvider({ hasAnthropic: true, hasNvidia: false })).toBe("ANTHROPIC");
    expect(resolveAiProvider({ hasAnthropic: false, hasNvidia: true })).toBe("NVIDIA");
    expect(resolveAiProvider({ hasAnthropic: false, hasNvidia: true, needsStructuredOutput: true })).toBe("NVIDIA");
  });

  it("reports NONE when nothing is configured", () => {
    expect(resolveAiProvider({ hasAnthropic: false, hasNvidia: false })).toBe("NONE");
  });
});

describe("an explicit preference is obeyed everywhere", () => {
  it("forces the chosen provider even for structured work", () => {
    expect(
      resolveAiProvider({ hasAnthropic: true, hasNvidia: true, preference: "NVIDIA", needsStructuredOutput: true })
    ).toBe("NVIDIA");
    expect(resolveAiProvider({ hasAnthropic: true, hasNvidia: true, preference: "ANTHROPIC" })).toBe("ANTHROPIC");
  });
});

describe("a preference for an unconfigured provider degrades, never dies", () => {
  it("falls back rather than disabling AI across seven surfaces", () => {
    // Selecting NVIDIA and then removing the key should give working AI, not
    // a silently dead feature everywhere.
    expect(resolveAiProvider({ hasAnthropic: true, hasNvidia: false, preference: "NVIDIA" })).toBe("ANTHROPIC");
    expect(resolveAiProvider({ hasAnthropic: false, hasNvidia: true, preference: "ANTHROPIC" })).toBe("NVIDIA");
  });

  it("still reports the mismatch so the panel can warn", () => {
    expect(preferenceIsUnavailable({ hasAnthropic: true, hasNvidia: false, preference: "NVIDIA" })).toBe(true);
    expect(preferenceIsUnavailable({ hasAnthropic: true, hasNvidia: true, preference: "NVIDIA" })).toBe(false);
    expect(preferenceIsUnavailable({ hasAnthropic: false, hasNvidia: false })).toBe(false);
  });
});
