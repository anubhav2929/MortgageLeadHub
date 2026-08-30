import { describe, expect, it } from "vitest";
import {
  advanceCallStatus,
  classifyEndedReason,
  classifyVapiCreateError,
  mapVapiCallStatus,
} from "@/core/vapiLifecycle";

// Two things depend on this being right, and both are expensive when it is
// wrong: whether the board tells an officer the truth about a live call, and
// whether a failure gets retried or escalated to a human.

describe("call status mapping", () => {
  it("maps the provider's vocabulary onto our stages", () => {
    expect(mapVapiCallStatus("ringing")).toBe("RINGING");
    expect(mapVapiCallStatus("in-progress")).toBe("CONNECTED");
    expect(mapVapiCallStatus("ended")).toBe("ENDED");
    expect(mapVapiCallStatus("queued")).toBe("QUEUED");
  });

  it("treats forwarding as still connected", () => {
    // A transfer in flight is live from the officer's point of view.
    expect(mapVapiCallStatus("forwarding")).toBe("CONNECTED");
  });

  it("treats an unrecognised status as QUEUED rather than guessing", () => {
    expect(mapVapiCallStatus("something-new")).toBe("QUEUED");
    expect(mapVapiCallStatus(undefined)).toBe("QUEUED");
  });
});

describe("status never regresses", () => {
  it("ignores a late-arriving earlier stage", () => {
    // Webhook ordering is not guaranteed. A "ringing" that arrives after
    // "in-progress" must not un-connect a live call on the board.
    expect(advanceCallStatus("CONNECTED", "RINGING")).toBe("CONNECTED");
    expect(advanceCallStatus("ENDED", "CONNECTED")).toBe("ENDED");
  });

  it("advances forward normally", () => {
    expect(advanceCallStatus(undefined, "RINGING")).toBe("RINGING");
    expect(advanceCallStatus("QUEUED", "CONNECTED")).toBe("CONNECTED");
    expect(advanceCallStatus("CONNECTED", "ENDED")).toBe("ENDED");
  });
});

describe("what an ended call meant for the lead", () => {
  it("reads the borrower's own behaviour without blaming the system", () => {
    expect(classifyEndedReason("customer-did-not-answer").outcome).toBe("NO_ANSWER");
    expect(classifyEndedReason("customer-busy").outcome).toBe("BUSY");
    expect(classifyEndedReason("voicemail").outcome).toBe("VOICEMAIL");
    for (const r of ["customer-did-not-answer", "customer-busy", "voicemail"]) {
      expect(classifyEndedReason(r).failureClass).toBe("NONE");
    }
  });

  it("counts a genuine conversation as answered", () => {
    expect(classifyEndedReason("customer-ended-call").outcome).toBe("ANSWERED");
    expect(classifyEndedReason("assistant-ended-call").outcome).toBe("ANSWERED");
    expect(classifyEndedReason("assistant-forwarded-call").outcome).toBe("ANSWERED");
  });

  it("does not treat a silent call as a conversation", () => {
    // It connected but nobody spoke. Marking it ANSWERED would advance the
    // lead to IN_CONVERSATION and put a wordless call in front of an officer
    // as an opportunity.
    expect(classifyEndedReason("silence-timed-out").outcome).toBe("NO_ANSWER");
  });
});

describe("account problems are never mistaken for borrower behaviour", () => {
  it("classifies billing and credential failures as CONFIGURATION", () => {
    // Nobody was dialled. Recording these as "no answer" would silently spend
    // the lead's attempt budget on a fault that is entirely ours.
    for (const r of [
      "call.start.error-subscription-frozen",
      "call.start.error-subscription-insufficient-credits",
      "call.start.error-get-phone-number",
      "pipeline-error-eleven-labs-voice-failed",
    ]) {
      const v = classifyEndedReason(r);
      expect(v.failureClass).toBe("CONFIGURATION");
      expect(v.outcome).toBe("FAILED");
    }
  });

  it("keeps genuinely temporary provider faults retryable", () => {
    for (const r of ["call.in-progress.error-vapifault-worker-died", "phone-call-provider-closed-websocket"]) {
      expect(classifyEndedReason(r).failureClass).toBe("TRANSIENT");
    }
  });

  it("defaults an unknown error to TRANSIENT rather than writing the lead off", () => {
    expect(classifyEndedReason("some-unheard-of-error").failureClass).toBe("TRANSIENT");
  });

  it("treats a missing reason as a completed call", () => {
    expect(classifyEndedReason(undefined).outcome).toBe("ANSWERED");
    expect(classifyEndedReason(undefined).failureClass).toBe("NONE");
  });
});

describe("call-creation errors", () => {
  const quota =
    '{"statusCode":400,"message":"Couldn\'t Start Call. Numbers Bought On Vapi Have A Daily Outbound Call Limit. Import Your Own Twilio Numbers To Scale Without Limits."}';

  it("treats the daily-quota wall as CONFIGURATION, not something to retry", () => {
    // This is the bug that produced four identical failures: it fell through
    // to the generic TRANSIENT default and was redialled every cadence tick.
    const v = classifyVapiCreateError(400, quota);
    expect(v.failureClass).toBe("CONFIGURATION");
    expect(v.detail).toMatch(/import your own carrier number/i);
  });

  it("names a key mix-up specifically", () => {
    const v = classifyVapiCreateError(401, '{"message":"Invalid Key"}');
    expect(v.failureClass).toBe("CONFIGURATION");
    expect(v.detail).toMatch(/private key/i);
  });

  it("names an invalid saved assistant specifically", () => {
    const v = classifyVapiCreateError(400, '{"message":"assistantId must reference an available published assistant"}');
    expect(v.failureClass).toBe("CONFIGURATION");
    expect(v.detail).toMatch(/assistant ID.*invalid|unpublished|unavailable/i);
  });

  it("preserves a bounded provider message for an unknown schema error", () => {
    const v = classifyVapiCreateError(400, '{"message":"assistantOverrides.variableValues must be an object"}');
    expect(v.failureClass).toBe("CONFIGURATION");
    expect(v.detail).toContain("assistantOverrides.variableValues must be an object");
  });

  it("keeps rate limits and server errors retryable", () => {
    expect(classifyVapiCreateError(429, "too many requests").failureClass).toBe("TRANSIENT");
    expect(classifyVapiCreateError(503, "unavailable").failureClass).toBe("TRANSIENT");
    expect(classifyVapiCreateError(400, "concurrency limit reached").failureClass).toBe("TRANSIENT");
  });

  it("treats an unrecognised 4xx as our problem", () => {
    // A malformed request retried every tick helps nobody, and a 4xx is far
    // more likely to be our payload than a blip.
    expect(classifyVapiCreateError(422, "unprocessable").failureClass).toBe("CONFIGURATION");
  });
});
