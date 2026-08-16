// Go-live readiness — "if I paste my keys in, will anything still be fake?"
//
// This exists because that question had no answer anywhere in the product. A
// simulated send is indistinguishable from a real one at a glance: the attempt
// is logged, the lead advances, the UI looks identical. The only tell was a
// console line nobody reads. So an operator could configure a carrier, watch
// the app behave perfectly, and never learn that voice was still pretending.
//
// The other half of the problem is subtler and cost us the most: some
// capabilities need something that is NOT a key. Automatic outreach needs a
// scheduler actually hitting the cron endpoint. Webhooks need a public URL.
// Telnyx voice needs a TeXML application. A checklist of API keys would report
// "all green" while nothing automatic ever fired.
//
// Pure and I/O-free so every rule below is unit-testable.

export interface GoLiveCapabilities {
  hasTelnyx: boolean;
  hasTwilio: boolean;
  hasTelnyxVoice: boolean;
  hasSms: boolean;
  hasVoice: boolean;
  hasVoiceAgent: boolean;
  hasPartialVoiceAgent: boolean;
  hasResend: boolean;
  hasInboundEmail: boolean;
  hasAnyLlm: boolean;
  hasPropertyData: boolean;
}

export interface GoLiveInput {
  caps: GoLiveCapabilities;
  /** Secrets that gate non-channel plumbing. */
  hasCronSecret: boolean;
  hasDeliveryWebhookSecret: boolean;
  hasInboundSmsSecret: boolean;
  hasAppUrl: boolean;
  hasCreditCheck: boolean;
  /** When the cadence engine last actually ran. Undefined = never. */
  lastCadenceRunAt?: string;
  now: Date;
}

export type ReadinessStatus = "LIVE" | "DEGRADED" | "OFF";

export interface ReadinessItem {
  id: string;
  label: string;
  status: ReadinessStatus;
  /** What happens today, stated plainly. */
  detail: string;
  /** Config keys that are missing. Empty when the gap is not a key. */
  missingKeys: string[];
  /** The action that closes the gap. */
  remedy?: string;
  /** True when this blocks the headline promise: a new lead gets contacted
   *  automatically, for real, without anyone clicking anything. */
  blocksAutomation: boolean;
}

/**
 * The cadence engine only advances when something calls it. If the scheduler
 * is misconfigured, the app looks healthy and silently stops contacting
 * anyone — the worst failure mode in the product, because leads keep arriving
 * and nothing visibly breaks.
 *
 * Two hours is deliberately generous. The cadence is meant to tick every few
 * minutes; anything approaching two hours means the schedule is wrong, not
 * merely coarse.
 */
export const CADENCE_STALE_AFTER_MINUTES = 120;

export function minutesSince(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 60_000;
}

export function evaluateGoLive(input: GoLiveInput): ReadinessItem[] {
  const { caps } = input;
  const items: ReadinessItem[] = [];

  // ---- Outbound SMS -------------------------------------------------------
  items.push({
    id: "sms",
    label: "Outbound SMS",
    status: caps.hasSms ? "LIVE" : "OFF",
    detail: caps.hasSms
      ? `Real texts send via ${caps.hasTelnyx ? "Telnyx" : "Twilio"}.`
      : "Texts are written to the log and never leave the server.",
    missingKeys: caps.hasSms ? [] : ["TELNYX_API_KEY", "TELNYX_PHONE_NUMBER"],
    remedy: caps.hasSms ? undefined : "Add the Telnyx API key and phone number in Admin → Integrations.",
    blocksAutomation: !caps.hasSms,
  });

  // ---- AI voice agent -----------------------------------------------------
  // Listed above the announcement because it is the product; the announcement
  // is the consolation prize.
  items.push({
    id: "voice-agent",
    label: "AI voice agent (outbound calls)",
    status: caps.hasVoiceAgent ? "LIVE" : "OFF",
    detail: caps.hasVoiceAgent
      ? "Real conversations. The borrower talks, the call is transcribed back into the lead, and answers feed extraction."
      : caps.hasPartialVoiceAgent
        ? "Vapi key saved but the call cannot be placed — the phone number ID and/or webhook secret are missing."
        : "No AI calls are placed. Automated cadence VOICE steps will not dial.",
    missingKeys: caps.hasVoiceAgent
      ? []
      : caps.hasPartialVoiceAgent
        ? ["VAPI_PHONE_NUMBER_ID", "VAPI_WEBHOOK_SECRET"]
        : ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_WEBHOOK_SECRET"],
    remedy: caps.hasVoiceAgent ? undefined : "Complete the Vapi setup in Admin → Integrations.",
    blocksAutomation: !caps.hasVoiceAgent,
  });

  // ---- Announcement calling ----------------------------------------------
  // Deliberately never counted as blocking automation: the cadence refuses to
  // place unattended one-way robocalls (core/callStrategy.ts), so having this
  // and only this does not make automatic calling work.
  items.push({
    id: "voice-announcement",
    label: "Announcement calling (fallback)",
    status: caps.hasVoice ? "LIVE" : "OFF",
    detail: caps.hasVoice
      ? `One-way recorded calls available via ${caps.hasTwilio ? "Twilio" : "Telnyx"} for manual use. The automated cadence deliberately will not place these.`
      : "Manual Call actions place nothing.",
    missingKeys: caps.hasVoice
      ? []
      : caps.hasTelnyx
        ? ["TELNYX_ACCOUNT_SID", "TELNYX_TEXML_APP_ID", "DELIVERY_WEBHOOK_SECRET"]
        : ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
    remedy: caps.hasVoice
      ? undefined
      : caps.hasTelnyx
        ? "Telnyx SMS is live but its voice side needs a TeXML application — Telnyx fetches call audio from a URL rather than accepting it inline."
        : "Add Twilio credentials, or complete the Telnyx voice fields.",
    blocksAutomation: false,
  });

  // ---- Email --------------------------------------------------------------
  items.push({
    id: "email",
    label: "Outbound email",
    status: caps.hasResend ? "LIVE" : "OFF",
    detail: caps.hasResend ? "Real email sends via Resend." : "Emails are logged, never delivered.",
    missingKeys: caps.hasResend ? [] : ["RESEND_API_KEY"],
    remedy: caps.hasResend ? undefined : "Add a Resend API key and verify your sending domain.",
    blocksAutomation: false,
  });

  // ---- Automatic cadence --------------------------------------------------
  // The headline item. Keys alone never satisfy this one.
  const staleMinutes = minutesSince(input.lastCadenceRunAt, input.now);
  const neverRan = staleMinutes === null;
  const stale = staleMinutes !== null && staleMinutes > CADENCE_STALE_AFTER_MINUTES;

  // CRON_SECRET is not merely recommended: /api/cron/cadence fails CLOSED in
  // production without it, returning 401 to every caller. So a deployment
  // missing it has no working scheduler no matter how often something pings
  // the URL — which is why this is a blocker and not a warning.
  const cadenceBroken = neverRan || stale || !input.hasCronSecret;

  items.push({
    id: "cadence",
    label: "Automatic follow-up (the scheduler)",
    status: cadenceBroken ? "OFF" : "LIVE",
    detail: !input.hasCronSecret
      ? "CRON_SECRET is not set. In production the cadence endpoint refuses every request without it, so no automatic outreach can run at all."
      : neverRan
        ? "The cadence engine has never run. Nothing will be contacted automatically — leads will sit until someone acts by hand."
        : stale
          ? `Last ran ${Math.round(staleMinutes! / 60)} hours ago. Cadence steps are timed in minutes, so this schedule is far too infrequent for the first-contact SLA.`
          : `Last ran ${Math.round(staleMinutes!)} minute(s) ago.`,
    missingKeys: input.hasCronSecret ? [] : ["CRON_SECRET"],
    remedy: cadenceBroken
      ? "Set CRON_SECRET, then point a scheduler at /api/cron/cadence every few minutes sending it as a bearer token. Vercel's Hobby tier only permits DAILY crons, which is not sufficient for a 5-minute SLA — use Vercel Pro, or the free GitHub Actions workflow at .github/workflows/cadence-scheduler.yml."
      : undefined,
    blocksAutomation: cadenceBroken,
  });

  // ---- Public URL ---------------------------------------------------------
  // Every callback in the system is built from this. Wrong here means calls
  // place successfully and then never report an outcome.
  items.push({
    id: "app-url",
    label: "Public URL for callbacks",
    status: input.hasAppUrl ? "LIVE" : "DEGRADED",
    detail: input.hasAppUrl
      ? "Webhook and call-script URLs are built from your configured public URL."
      : "Falling back to the deployment URL or localhost. Vapi and carrier callbacks cannot reach localhost, so calls would place but never report an outcome.",
    missingKeys: input.hasAppUrl ? [] : ["APP_URL"],
    remedy: input.hasAppUrl ? undefined : "Set APP_URL to your public https:// origin.",
    blocksAutomation: false,
  });

  // ---- Delivery receipts --------------------------------------------------
  items.push({
    id: "delivery-receipts",
    label: "Delivery receipts",
    status: input.hasDeliveryWebhookSecret ? "LIVE" : "DEGRADED",
    detail: input.hasDeliveryWebhookSecret
      ? "Carriers report back whether a message actually reached the handset."
      : "Sends are recorded as accepted-by-carrier and never resolve to delivered or failed. A number that silently rejects every text looks identical to one that works.",
    missingKeys: input.hasDeliveryWebhookSecret ? [] : ["DELIVERY_WEBHOOK_SECRET"],
    remedy: input.hasDeliveryWebhookSecret ? undefined : "Set DELIVERY_WEBHOOK_SECRET and add the webhook in your carrier's portal.",
    blocksAutomation: false,
  });

  // ---- Inbound STOP -------------------------------------------------------
  // A legal obligation, not a nice-to-have: the consent text the borrower
  // agreed to promises STOP works.
  items.push({
    id: "inbound-sms",
    label: "Inbound SMS / STOP handling",
    status: input.hasInboundSmsSecret ? "LIVE" : "DEGRADED",
    detail: input.hasInboundSmsSecret
      ? "STOP replies suppress the lead across every channel, and ordinary replies join the conversation thread."
      : "STOP replies are not received. The carrier blocks its own channel, but the cadence keeps calling and emailing — and our consent text promises otherwise.",
    // Same secret as delivery receipts — the inbound route authenticates with
    // DELIVERY_WEBHOOK_SECRET too, so one value unlocks both. Worth stating,
    // because "which secret does this need" is exactly the question that
    // stalls a go-live.
    missingKeys: input.hasInboundSmsSecret ? [] : ["DELIVERY_WEBHOOK_SECRET"],
    remedy: input.hasInboundSmsSecret
      ? undefined
      : "Set DELIVERY_WEBHOOK_SECRET (the same one delivery receipts use) and point Telnyx's inbound-message webhook at /api/webhooks/inbound/telnyx.",
    blocksAutomation: false,
  });

  // ---- AI content ---------------------------------------------------------
  items.push({
    id: "llm",
    label: "AI message content & lead scoring",
    status: caps.hasAnyLlm ? "LIVE" : "DEGRADED",
    detail: caps.hasAnyLlm
      ? "Outreach copy, transcript extraction, and discovery assessment all use a live model."
      : "Falls back to templates and keyword rules. Messages still send; they are just generic.",
    missingKeys: caps.hasAnyLlm ? [] : ["NVIDIA_API_KEY"],
    remedy: caps.hasAnyLlm ? undefined : "Add a free NVIDIA NIM key (or an Anthropic key) in Admin → Integrations.",
    blocksAutomation: false,
  });

  // ---- Enrichment ---------------------------------------------------------
  items.push({
    id: "property",
    label: "Property valuation",
    status: caps.hasPropertyData ? "LIVE" : "DEGRADED",
    detail: caps.hasPropertyData
      ? "Real AVM lookups for leads with a street address."
      : "Estimated values are modelled, and labelled as such in the UI.",
    missingKeys: caps.hasPropertyData ? [] : ["PROPERTY_DATA_API_KEY"],
    blocksAutomation: false,
  });

  items.push({
    id: "credit",
    label: "Soft credit pull",
    status: input.hasCreditCheck ? "LIVE" : "DEGRADED",
    detail: input.hasCreditCheck
      ? "Real soft pulls via iSoftpull, gated on FCRA consent."
      : "Credit bands are modelled and labelled Simulated. The FCRA gate still applies.",
    missingKeys: input.hasCreditCheck ? [] : ["ISOFTPULL_API_KEY", "ISOFTPULL_API_SECRET"],
    blocksAutomation: false,
  });

  return items;
}

export interface GoLiveVerdict {
  /** True when a newly submitted lead would be contacted automatically, for
   *  real, with no human action. This is the single question the operator
   *  actually cares about. */
  automationReady: boolean;
  blockers: ReadinessItem[];
  liveCount: number;
  totalCount: number;
}

export function summariseGoLive(items: ReadinessItem[]): GoLiveVerdict {
  const blockers = items.filter((i) => i.blocksAutomation);
  return {
    automationReady: blockers.length === 0,
    blockers,
    liveCount: items.filter((i) => i.status === "LIVE").length,
    totalCount: items.length,
  };
}
