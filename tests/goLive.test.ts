import { describe, expect, it } from "vitest";
import {
  CADENCE_STALE_AFTER_MINUTES,
  evaluateGoLive,
  summariseGoLive,
  type GoLiveInput,
} from "@/core/goLive";

// The question this answers: "I pasted my keys in — is anything still fake?"
//
// The failure mode being defended against is a checklist that reports all
// green because every API key is present, while nothing is actually contacted
// because the scheduler was never wired up. Keys are necessary and not
// sufficient, and these tests pin that distinction.

const NOW = new Date("2026-08-16T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function input(over: Partial<GoLiveInput> = {}): GoLiveInput {
  return {
    caps: {
      hasTelnyx: false,
      hasTwilio: false,
      hasTelnyxVoice: false,
      hasSms: false,
      hasVoice: false,
      hasVoiceAgent: false,
      hasPartialVoiceAgent: false,
      hasResend: false,
      hasInboundEmail: false,
      hasAnyLlm: false,
      hasPropertyData: false,
      ...(over.caps ?? {}),
    },
    hasCronSecret: false,
    hasDeliveryWebhookSecret: false,
    hasInboundSmsSecret: false,
    hasAppUrl: false,
    hasCreditCheck: false,
    lastCadenceRunAt: undefined,
    now: NOW,
    ...over,
  };
}

/** The fully-configured deployment the user is aiming for. */
function readyInput(over: Partial<GoLiveInput> = {}): GoLiveInput {
  return input({
    caps: {
      hasTelnyx: true,
      hasTwilio: false,
      hasTelnyxVoice: true,
      hasSms: true,
      hasVoice: true,
      hasVoiceAgent: true,
      hasPartialVoiceAgent: false,
      hasResend: true,
      hasInboundEmail: true,
      hasAnyLlm: true,
      hasPropertyData: true,
    },
    hasCronSecret: true,
    hasDeliveryWebhookSecret: true,
    hasInboundSmsSecret: true,
    hasAppUrl: true,
    hasCreditCheck: true,
    lastCadenceRunAt: minsAgo(3),
    ...over,
  });
}

const byId = (items: ReturnType<typeof evaluateGoLive>, id: string) => items.find((i) => i.id === id)!;

describe("a fully configured deployment", () => {
  it("reports automation ready with no blockers", () => {
    const verdict = summariseGoLive(evaluateGoLive(readyInput()));
    expect(verdict.automationReady).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });
});

describe("keys alone are not sufficient", () => {
  it("blocks automation when the scheduler has never run, even with every key set", () => {
    // This is the whole point of the module. Every credential present, and a
    // new lead would still never be contacted.
    const items = evaluateGoLive(readyInput({ lastCadenceRunAt: undefined }));
    const verdict = summariseGoLive(items);
    expect(verdict.automationReady).toBe(false);
    expect(verdict.blockers.map((b) => b.id)).toContain("cadence");
    expect(byId(items, "cadence").detail).toMatch(/never run/i);
  });

  it("blocks when the schedule is too infrequent to meet the SLA", () => {
    // A daily cron is the Vercel Hobby ceiling and reads as "configured".
    const items = evaluateGoLive(readyInput({ lastCadenceRunAt: minsAgo(23 * 60) }));
    expect(summariseGoLive(items).automationReady).toBe(false);
    expect(byId(items, "cadence").remedy).toMatch(/Hobby|external pinger/i);
  });

  it("accepts a schedule inside the staleness window", () => {
    const fresh = evaluateGoLive(readyInput({ lastCadenceRunAt: minsAgo(CADENCE_STALE_AFTER_MINUTES - 1) }));
    expect(byId(fresh, "cadence").status).toBe("LIVE");
    const stale = evaluateGoLive(readyInput({ lastCadenceRunAt: minsAgo(CADENCE_STALE_AFTER_MINUTES + 1) }));
    expect(byId(stale, "cadence").status).toBe("OFF");
  });
});

describe("naming the exact missing thing", () => {
  it("asks only for the two fields Vapi is short of, not all three", () => {
    // Telling someone to add an API key they already added is how a go-live
    // stalls for an afternoon.
    const items = evaluateGoLive(input({ caps: { ...input().caps, hasPartialVoiceAgent: true } }));
    expect(byId(items, "voice-agent").missingKeys).toEqual([
      "VAPI_PHONE_NUMBER_ID",
      "VAPI_WEBHOOK_SECRET",
    ]);
  });

  it("points a Telnyx-only deployment at the TeXML fields for voice", () => {
    const items = evaluateGoLive(
      input({ caps: { ...input().caps, hasTelnyx: true, hasSms: true } })
    );
    expect(byId(items, "voice-announcement").missingKeys).toContain("TELNYX_TEXML_APP_ID");
    expect(byId(items, "voice-announcement").remedy).toMatch(/TeXML/i);
  });

  it("names one secret for both receipts and STOP, since they share it", () => {
    const items = evaluateGoLive(input());
    expect(byId(items, "inbound-sms").missingKeys).toEqual(["DELIVERY_WEBHOOK_SECRET"]);
    expect(byId(items, "delivery-receipts").missingKeys).toEqual(["DELIVERY_WEBHOOK_SECRET"]);
  });
});

describe("what does and does not block automatic outreach", () => {
  it("counts missing SMS and missing AI agent as blockers", () => {
    const verdict = summariseGoLive(evaluateGoLive(input()));
    expect(verdict.blockers.map((b) => b.id)).toEqual(
      expect.arrayContaining(["sms", "voice-agent", "cadence"])
    );
  });

  it("does not let announcement calling substitute for the AI agent", () => {
    // The cadence refuses to place unattended one-way robocalls, so a Twilio
    // number does not make automatic calling work — claiming otherwise would
    // send someone to launch believing calls would go out.
    const items = evaluateGoLive(
      input({ caps: { ...input().caps, hasTwilio: true, hasVoice: true, hasSms: true } })
    );
    expect(byId(items, "voice-announcement").status).toBe("LIVE");
    expect(byId(items, "voice-announcement").blocksAutomation).toBe(false);
    expect(byId(items, "voice-agent").blocksAutomation).toBe(true);
  });

  it("treats enrichment and AI copy as degraded, never blocking", () => {
    // Missing these makes messages generic, not absent. Blocking a launch on
    // them would be wrong.
    for (const id of ["llm", "property", "credit", "email"]) {
      expect(byId(evaluateGoLive(input()), id).blocksAutomation).toBe(false);
    }
  });
});

describe("callback URL", () => {
  it("warns that localhost cannot receive carrier callbacks", () => {
    const item = byId(evaluateGoLive(input()), "app-url");
    expect(item.status).toBe("DEGRADED");
    expect(item.detail).toMatch(/localhost/i);
  });
});

describe("CRON_SECRET is a blocker, not a warning", () => {
  it("blocks automation when unset, even if a tick appears recent", () => {
    // /api/cron/cadence fails CLOSED in production without it — every caller
    // gets a 401. A recent-looking heartbeat from a dev run must not mask
    // that, or a launch proceeds with no scheduler at all.
    const items = evaluateGoLive(readyInput({ hasCronSecret: false }));
    const cadence = byId(items, "cadence");
    expect(cadence.status).toBe("OFF");
    expect(cadence.blocksAutomation).toBe(true);
    expect(cadence.detail).toMatch(/refuses every request/i);
    expect(summariseGoLive(items).automationReady).toBe(false);
  });
});
