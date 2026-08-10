import { describe, expect, it } from "vitest";
import { isPlaceholderAddress, resolveSenderAddress, senderConfigWarning } from "@/core/senderIdentity";

// The bug these lock down: the adapter used `caller || configured || default`,
// and every caller always supplied a value. RESEND_FROM_EMAIL was therefore
// dead config — an admin could set a verified address, watch it save, and
// still have every email rejected for sending from a fake domain.

describe("resolveSenderAddress", () => {
  it("uses the configured verified address over the caller's", () => {
    expect(resolveSenderAddress("leads@equityflowgroup.demo", "hello@verified.com")).toContain("hello@verified.com");
  });

  it("keeps the caller's display name on the verified address", () => {
    // The business identity from Settings should still be what borrowers see;
    // only the deliverable domain has to come from Integrations.
    const from = resolveSenderAddress("Equity Flow Group <leads@equityflowgroup.demo>", "hello@verified.com");
    expect(from).toBe("Equity Flow Group <hello@verified.com>");
  });

  it("prefers a display name configured in Integrations", () => {
    const from = resolveSenderAddress("Settings Name <a@demo.test>", "Verified Name <hello@verified.com>");
    expect(from).toBe("Verified Name <hello@verified.com>");
  });

  it("returns a bare address when neither side has a display name", () => {
    expect(resolveSenderAddress("a@b.com", "hello@verified.com")).toBe("hello@verified.com");
  });

  it("falls back to the caller when nothing is configured", () => {
    expect(resolveSenderAddress("Team <leads@equityflowgroup.demo>", undefined)).toBe(
      "Team <leads@equityflowgroup.demo>"
    );
  });

  it("has a last-resort default so the simulated path always has something", () => {
    expect(resolveSenderAddress(undefined, undefined)).toContain("@");
  });

  it("ignores whitespace-only configuration", () => {
    expect(resolveSenderAddress("a@b.com", "   ")).toBe("a@b.com");
  });
});

describe("isPlaceholderAddress", () => {
  it("recognises the shipped placeholder domain", () => {
    expect(isPlaceholderAddress("leads@equityflowgroup.demo")).toBe(true);
  });

  it("recognises other obvious non-deliverable domains", () => {
    expect(isPlaceholderAddress("a@example.com")).toBe(true);
    expect(isPlaceholderAddress("a@localhost")).toBe(true);
  });

  it("accepts a real domain", () => {
    expect(isPlaceholderAddress("hello@equityflowgroup.com")).toBe(false);
  });

  it("is case-insensitive about the domain", () => {
    expect(isPlaceholderAddress("a@EquityFlowGroup.DEMO")).toBe(true);
  });
});

describe("senderConfigWarning", () => {
  it("warns loudly about a placeholder domain and names the fix", () => {
    const warning = senderConfigWarning("Team <leads@equityflowgroup.demo>");
    expect(warning).toMatch(/placeholder/i);
    expect(warning).toMatch(/Integrations/);
  });

  it("catches a malformed address", () => {
    expect(senderConfigWarning("not-an-email")).toMatch(/not a valid/i);
  });

  it("is silent when the sender is properly configured", () => {
    expect(senderConfigWarning("Team <hello@equityflowgroup.com>")).toBeNull();
  });
});
