import { describe, expect, it } from "vitest";
import { SMS_MAX_CHARS, clampSms } from "@/core/smsFormat";

// This is a backstop, not the mechanism that makes texts short — the model is
// asked for a text message now, rather than for an email that then gets
// sliced. What matters here is that when it does fire, the result still reads
// like something a person sent.

describe("clamping an over-long text", () => {
  it("leaves a normal message untouched", () => {
    const body = "Hi Jordan, happy to talk through your refinance options whenever suits.";
    expect(clampSms(body)).toBe(body);
  });

  it("never cuts a word in half", () => {
    // "we can look at your refina…" reads as a broken system, not a busy one.
    const body = `${"word ".repeat(100)}refinancing`;
    const out = clampSms(body);
    expect(out.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
    expect(out).toMatch(/word…$/);
  });

  it("drops a trailing comma or dash before the ellipsis", () => {
    const out = clampSms(`${"alpha ".repeat(60)}beta, gamma`);
    expect(out).not.toMatch(/[,;:-]…$/);
  });

  it("still returns something for one absurdly long token", () => {
    // No word boundary to trim to — a hard cut beats an empty message.
    const out = clampSms("x".repeat(500));
    expect(out.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
    expect(out.length).toBeGreaterThan(100);
  });

  it("trims surrounding whitespace", () => {
    expect(clampSms("  hello  ")).toBe("hello");
  });
});
