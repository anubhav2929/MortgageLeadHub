import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  classifyHttpFailure,
  countsAgainstAttemptCap,
  decideRetry,
  describeFailure,
  isCarrierOptOutFailure,
  isTerminalOutcome,
  mapProviderStatus,
  shouldApplyStatus,
  shouldSuppressChannel,
} from "@/core/deliveryStatus";
import type { AttemptOutcome } from "@/domain/types";

// These rules decide what the CRM believes about whether a borrower was
// actually reached. The expensive failure mode is optimism: treating a
// provider's 201 as delivery, or retrying a number the carrier has already
// said is invalid. Both are pinned here.

describe("classifyFailure — permanent vs transient vs configuration", () => {
  it("treats an invalid destination number as permanent", () => {
    expect(classifyFailure("twilio", "21211", "The 'To' number is not valid").class).toBe("PERMANENT");
  });

  it("treats a landline as permanent rather than retrying it forever", () => {
    expect(classifyFailure("twilio", "21614", "not a mobile number").class).toBe("PERMANENT");
  });

  it("treats a STOP opt-out as permanent", () => {
    // Retrying here is not just wasteful, it is a TCPA violation — the
    // carrier is reporting that the borrower revoked consent.
    const failure = classifyFailure("twilio", "21610", "recipient has opted out");
    expect(failure.class).toBe("PERMANENT");
    expect(shouldSuppressChannel(failure)).toBe(true);
  });

  it("treats an unregistered 10DLC campaign as a configuration problem", () => {
    const failure = classifyFailure("twilio", "30034", "campaign not registered");
    expect(failure.class).toBe("CONFIGURATION");
    expect(failure.affectsAllLeads).toBe(true);
  });

  it("recognises an auth failure across any provider, code or not", () => {
    for (const p of ["twilio", "telnyx", "resend", "vapi"] as const) {
      const failure = classifyFailure(p, undefined, "401 Unauthorized: invalid api key");
      expect(failure.class).toBe("CONFIGURATION");
      expect(failure.affectsAllLeads).toBe(true);
    }
  });

  it("treats rate limiting as transient, never permanent", () => {
    // Marking a rate limit permanent would kill a working channel outright.
    expect(classifyFailure("telnyx", undefined, "429 Too Many Requests").class).toBe("TRANSIENT");
  });

  it("treats a network error as transient — it never reached the provider", () => {
    expect(classifyFailure("twilio", undefined, "fetch failed: ECONNREFUSED").class).toBe("TRANSIENT");
  });

  it("reads a hard bounce out of Resend's text, which has no numeric code", () => {
    expect(classifyFailure("resend", undefined, "Hard bounce: mailbox does not exist").class).toBe("PERMANENT");
  });

  it("treats an unverified sending domain as configuration", () => {
    expect(classifyFailure("resend", undefined, "The domain is not verified").class).toBe("CONFIGURATION");
  });

  it("defaults an unrecognised code to transient, not permanent", () => {
    // Wrongly marking a real borrower's number permanently dead is a worse
    // error than one wasted retry, so the unknown case must fail safe.
    expect(classifyFailure("twilio", "99999", "Something new and undocumented").class).toBe("TRANSIENT");
  });

  it("classifies the remaining Twilio permanent codes", () => {
    for (const code of ["21214", "21612", "21614", "30003", "30005", "30006", "13224"]) {
      expect(classifyFailure("twilio", code, "carrier rejected").class, code).toBe("PERMANENT");
    }
  });

  it("classifies the remaining Twilio configuration codes", () => {
    for (const code of ["20404", "21606", "21608", "30007", "30038"]) {
      expect(classifyFailure("twilio", code, "account problem").class, code).toBe("CONFIGURATION");
    }
  });

  it("classifies Telnyx's own permanent and configuration codes", () => {
    for (const code of ["40001", "40003", "40008", "40012", "40310", "40314", "40322", "42201"]) {
      expect(classifyFailure("telnyx", code, "carrier rejected").class, code).toBe("PERMANENT");
    }
    for (const code of ["10001", "40010", "40013", "40301", "40302", "40305", "40329", "40333", "47000", "42200"]) {
      expect(classifyFailure("telnyx", code, "account problem").class, code).toBe("CONFIGURATION");
    }
  });

  it("treats Telnyx 40300 without STOP evidence as sender configuration", () => {
    const result = classifyFailure("telnyx", "40300", "The from number is not assigned to a messaging profile");
    expect(result.class).toBe("CONFIGURATION");
    expect(result.affectsAllLeads).toBe(true);
    expect(isCarrierOptOutFailure(result)).toBe(false);
  });

  it("does not confuse Telnyx STOP's HTTP 403 response with account authentication", () => {
    const result = classifyFailure("telnyx", "40300", "Telnyx API returned 403: Blocked due to STOP message");
    expect(result.class).toBe("PERMANENT");
    expect(result.affectsAllLeads).toBe(false);
    expect(isCarrierOptOutFailure(result)).toBe(true);
  });

  it("distinguishes carrier STOP evidence from an invalid destination", () => {
    expect(isCarrierOptOutFailure(classifyFailure("twilio", "21610", "opted out"))).toBe(true);
    expect(isCarrierOptOutFailure(classifyFailure("twilio", "21211", "invalid number"))).toBe(false);
  });

  it("does not apply one carrier's codes to another carrier", () => {
    // A Telnyx delivery code means nothing to Twilio and must not be
    // silently treated as a permanent opt-out there.
    expect(classifyFailure("twilio", "40008", "unrelated").class).toBe("TRANSIENT");
  });

  it("recognises a Resend hard bounce phrased as 'no such user'", () => {
    expect(classifyFailure("resend", undefined, "550 No such user here").class).toBe("PERMANENT");
  });

  it("keeps the provider's own code for support escalation", () => {
    expect(classifyFailure("twilio", "30003", "unreachable").providerCode).toBe("30003");
  });

  it("does not treat a per-lead failure as affecting everyone", () => {
    expect(classifyFailure("twilio", "21211", "bad number").affectsAllLeads).toBe(false);
  });

  it("does not retry synchronous Telnyx validation and account failures", () => {
    expect(classifyHttpFailure("telnyx", 422, undefined, "validation failed").class).toBe("CONFIGURATION");
    expect(classifyHttpFailure("telnyx", 402, undefined, "payment required").class).toBe("CONFIGURATION");
    expect(classifyHttpFailure("telnyx", 403, "99999", "request forbidden").class).toBe("CONFIGURATION");
  });

  it("keeps Telnyx rate limits and server failures retryable", () => {
    expect(classifyHttpFailure("telnyx", 429, undefined, "too many requests").class).toBe("TRANSIENT");
    expect(classifyHttpFailure("telnyx", 503, undefined, "service unavailable").class).toBe("TRANSIENT");
  });
});

describe("mapProviderStatus", () => {
  it("maps Twilio's SMS lifecycle", () => {
    expect(mapProviderStatus("twilio", "queued")).toBe("QUEUED");
    expect(mapProviderStatus("twilio", "sent")).toBe("SENT");
    expect(mapProviderStatus("twilio", "delivered")).toBe("DELIVERED");
    expect(mapProviderStatus("twilio", "undelivered")).toBe("UNDELIVERED");
    expect(mapProviderStatus("twilio", "failed")).toBe("FAILED");
  });

  it("maps Twilio's voice lifecycle to call outcomes", () => {
    expect(mapProviderStatus("twilio", "ringing")).toBe("QUEUED");
    expect(mapProviderStatus("twilio", "completed")).toBe("ANSWERED");
    expect(mapProviderStatus("twilio", "no-answer")).toBe("NO_ANSWER");
    expect(mapProviderStatus("twilio", "busy")).toBe("BUSY");
  });

  it("maps Telnyx's distinct failure vocabulary", () => {
    // Telnyx separates "we couldn't send it" from "the carrier rejected it",
    // and the two must not collapse to the same outcome.
    expect(mapProviderStatus("telnyx", "sending_failed")).toBe("FAILED");
    expect(mapProviderStatus("telnyx", "delivery_failed")).toBe("UNDELIVERED");
  });

  it("maps Resend's event names", () => {
    expect(mapProviderStatus("resend", "email.delivered")).toBe("DELIVERED");
    expect(mapProviderStatus("resend", "email.bounced")).toBe("UNDELIVERED");
    expect(mapProviderStatus("resend", "email.complained")).toBe("UNDELIVERED");
  });

  it("maps Resend's refusal events, which were previously unmapped", () => {
    // Both are real event types in Resend's docs. Leaving them unmapped meant
    // the attempt stayed SENT and the failure was never surfaced.
    expect(mapProviderStatus("resend", "email.failed")).toBe("FAILED");
    expect(mapProviderStatus("resend", "email.suppressed")).toBe("UNDELIVERED");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(mapProviderStatus("twilio", "  DELIVERED ")).toBe("DELIVERED");
  });

  it("maps the Vapi call lifecycle", () => {
    expect(mapProviderStatus("vapi", "ringing")).toBe("QUEUED");
    expect(mapProviderStatus("vapi", "in-progress")).toBe("SENT");
    expect(mapProviderStatus("vapi", "ended")).toBe("ANSWERED");
    expect(mapProviderStatus("vapi", "no-answer")).toBe("NO_ANSWER");
    expect(mapProviderStatus("vapi", "busy")).toBe("BUSY");
    expect(mapProviderStatus("vapi", "failed")).toBe("FAILED");
  });

  it("covers the remaining queued/sending states each provider emits", () => {
    expect(mapProviderStatus("twilio", "accepted")).toBe("QUEUED");
    expect(mapProviderStatus("twilio", "scheduled")).toBe("QUEUED");
    expect(mapProviderStatus("twilio", "sending")).toBe("SENT");
    expect(mapProviderStatus("twilio", "initiated")).toBe("QUEUED");
    expect(mapProviderStatus("twilio", "in-progress")).toBe("SENT");
    expect(mapProviderStatus("twilio", "canceled")).toBe("FAILED");
    expect(mapProviderStatus("telnyx", "queued")).toBe("QUEUED");
    expect(mapProviderStatus("telnyx", "sending")).toBe("QUEUED");
    expect(mapProviderStatus("telnyx", "sent")).toBe("SENT");
    expect(mapProviderStatus("telnyx", "undelivered")).toBe("UNDELIVERED");
    expect(mapProviderStatus("telnyx", "failed")).toBe("FAILED");
    expect(mapProviderStatus("resend", "email.sent")).toBe("SENT");
    expect(mapProviderStatus("resend", "email.delivery_delayed")).toBe("QUEUED");
  });

  it("returns null for an unrecognised status on every provider", () => {
    for (const p of ["twilio", "telnyx", "resend", "vapi"] as const) {
      expect(mapProviderStatus(p, "not-a-real-status")).toBeNull();
    }
  });

  it("returns null for a status it doesn't recognise", () => {
    // Distinguishable from "no change", so a caller can log the gap rather
    // than silently inventing an outcome.
    expect(mapProviderStatus("twilio", "some-new-status")).toBeNull();
  });
});

describe("shouldApplyStatus — out-of-order and duplicate webhooks", () => {
  it("advances along the lifecycle", () => {
    expect(shouldApplyStatus("QUEUED", "SENT")).toBe(true);
    expect(shouldApplyStatus("SENT", "DELIVERED")).toBe(true);
    expect(shouldApplyStatus("QUEUED", "DELIVERED")).toBe(true);
  });

  it("refuses to walk an attempt backwards", () => {
    // Providers do not guarantee ordering; a delayed "sent" arriving after
    // "delivered" must not un-deliver the message.
    expect(shouldApplyStatus("DELIVERED", "SENT")).toBe(false);
    expect(shouldApplyStatus("SENT", "QUEUED")).toBe(false);
  });

  it("ignores a duplicate of the status already recorded", () => {
    expect(shouldApplyStatus("DELIVERED", "DELIVERED")).toBe(false);
  });

  it("refuses to overwrite one terminal outcome with another", () => {
    // The first settled answer is the real one; anything after is a retry.
    expect(shouldApplyStatus("DELIVERED", "UNDELIVERED")).toBe(false);
    expect(shouldApplyStatus("ANSWERED", "NO_ANSWER")).toBe(false);
    expect(shouldApplyStatus("FAILED", "DELIVERED")).toBe(false);
  });

  it("lets a terminal failure land on an in-flight attempt", () => {
    expect(shouldApplyStatus("SENT", "UNDELIVERED")).toBe(true);
  });

  it("agrees with isTerminalOutcome about what is settled", () => {
    const terminal: AttemptOutcome[] = ["DELIVERED", "ANSWERED", "NO_ANSWER", "BUSY", "VOICEMAIL", "FAILED", "UNDELIVERED", "BLOCKED"];
    for (const t of terminal) expect(isTerminalOutcome(t)).toBe(true);
    expect(isTerminalOutcome("QUEUED")).toBe(false);
    expect(isTerminalOutcome("SENT")).toBe(false);
  });
});

describe("decideRetry", () => {
  const transient = classifyFailure("twilio", undefined, "fetch failed");
  const permanent = classifyFailure("twilio", "21211", "invalid number");
  const config = classifyFailure("twilio", "30034", "campaign not registered");

  it("retries a transient failure with growing backoff", () => {
    expect(decideRetry(transient, 0)).toMatchObject({ retry: true, delayMinutes: 5 });
    expect(decideRetry(transient, 1)).toMatchObject({ retry: true, delayMinutes: 15 });
    expect(decideRetry(transient, 2)).toMatchObject({ retry: true, delayMinutes: 60 });
  });

  it("gives up after the transient budget is exhausted", () => {
    expect(decideRetry(transient, 3).retry).toBe(false);
    expect(decideRetry(transient, 10).retry).toBe(false);
  });

  it("never retries a permanently bad destination", () => {
    expect(decideRetry(permanent, 0).retry).toBe(false);
  });

  it("never retries a configuration problem, however few tries have happened", () => {
    // Retrying per-lead just multiplies one administrator-level error.
    expect(decideRetry(config, 0).retry).toBe(false);
    expect(decideRetry(config, 0).reason).toMatch(/administrator/i);
  });

  it("always explains itself", () => {
    for (const f of [transient, permanent, config]) {
      expect(decideRetry(f, 0).reason.length).toBeGreaterThan(0);
    }
  });
});

describe("countsAgainstAttemptCap", () => {
  it("does not count a send the provider refused", () => {
    // Attempt caps limit how often a borrower is *contacted*. A message the
    // carrier never accepted contacted nobody, so counting it would burn a
    // lead's cadence during an outage without reaching them once.
    expect(countsAgainstAttemptCap("FAILED")).toBe(false);
    expect(countsAgainstAttemptCap("BLOCKED")).toBe(false);
  });

  it("counts anything that reached the carrier", () => {
    for (const o of ["SENT", "DELIVERED", "ANSWERED", "NO_ANSWER", "BUSY", "UNDELIVERED"] as AttemptOutcome[]) {
      expect(countsAgainstAttemptCap(o)).toBe(true);
    }
  });
});

describe("describeFailure", () => {
  it("tells an officer to try another channel on a permanent failure", () => {
    const text = describeFailure("SMS", classifyFailure("twilio", "21211", "invalid"));
    expect(text).toMatch(/another channel/i);
  });

  it("points a configuration failure at the admin panel", () => {
    const text = describeFailure("EMAIL", classifyFailure("resend", undefined, "domain is not verified"));
    expect(text).toMatch(/administrator|Integrations/i);
  });

  it("shows the provider's safe validation detail instead of hiding it", () => {
    const text = describeFailure("VOICE", {
      class: "CONFIGURATION",
      message: "Vapi rejected the request: assistantId is unpublished (HTTP 400)",
      affectsAllLeads: true,
    });
    expect(text).toContain("assistantId is unpublished");
  });

  it("redacts bearer tokens and phone numbers from provider detail", () => {
    const text = describeFailure("VOICE", {
      class: "CONFIGURATION",
      message: "Authorization Bearer secret-token failed for +13165550123",
      affectsAllLeads: true,
    });
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("+13165550123");
  });

  it("says a transient failure will retry itself", () => {
    const text = describeFailure("VOICE", classifyFailure("twilio", undefined, "socket hang up"));
    expect(text).toMatch(/retried automatically/i);
  });

  it("names the channel in borrower-appropriate language", () => {
    expect(describeFailure("VOICE", classifyFailure("twilio", "21211", "x"))).toMatch(/^Call/);
    expect(describeFailure("SMS", classifyFailure("twilio", "21211", "x"))).toMatch(/^Text/);
    expect(describeFailure("EMAIL", classifyFailure("twilio", "21211", "x"))).toMatch(/^Email/);
  });
});
