// Provider truth → canonical outcome. Pure, no I/O.
//
// The distinction this module exists to enforce: **a provider accepting a
// message is not delivery.** Twilio returning a 201 means Twilio queued it.
// The carrier can still reject it minutes later — invalid number, landline,
// blocked as spam, 10DLC campaign not registered. Treating acceptance as
// delivery is how a CRM ends up reporting a 100% contact rate while no
// borrower ever receives anything.
//
// So an outbound touch has a lifecycle, and only the provider can advance it:
//
//   QUEUED ──► SENT ──► DELIVERED          (carrier confirmed)
//     │         │
//     │         └─────► UNDELIVERED        (carrier rejected, after acceptance)
//     └───────────────► FAILED             (never left our hands)
//
// Everything here is a pure mapping so the rules can be tested exhaustively
// against every status string each vendor actually emits.

import type { AttemptOutcome, Channel } from "@/domain/types";

// --- Failure classification -------------------------------------------------

/**
 * Why a send failed, which determines what the CRM does next.
 *
 * PERMANENT — the destination is bad. Retrying sends the same message to the
 *   same wrong place. Stop the channel for this lead and tell a human.
 * TRANSIENT — our side or the provider's side glitched. The borrower is fine;
 *   retry with backoff.
 * CONFIGURATION — our credentials/account/registration are wrong. Every lead
 *   is affected, not just this one. Retrying per-lead just multiplies the
 *   error; this needs an administrator.
 */
export type FailureClass = "PERMANENT" | "TRANSIENT" | "CONFIGURATION";

/** Every provider whose failures this module can classify. Adding one here
 *  rather than widening the string keeps the per-vendor code tables honest —
 *  a Telnyx error code must never be read as a Twilio one. */
export type DeliveryProviderId = "twilio" | "telnyx" | "resend" | "vapi" | "isoftpull";

export interface DeliveryFailure {
  class: FailureClass;
  /** Provider's own code, kept verbatim for support escalation. */
  providerCode?: string;
  /** Operator-facing explanation. Never shown to a borrower. */
  message: string;
  /** True when this should stop the whole channel, not just this attempt. */
  affectsAllLeads: boolean;
}

// Provider error codes that mean "this destination will never work".
// Retrying any of these is pure waste and, for 21610 (opted out), is a
// TCPA violation — the carrier is telling us the borrower revoked consent.
const TWILIO_PERMANENT = new Set([
  "21211", // invalid 'To' number
  "21214", // 'To' number is not a valid mobile number
  "21610", // recipient has opted out (STOP)
  "21612", // cannot route to this number
  "21614", // 'To' number is not SMS-capable (landline)
  "30003", // unreachable destination handset
  "30005", // unknown destination handset
  "30006", // landline or unreachable carrier
  "13224", // invalid voice number
]);

// Codes that mean our account/registration is wrong — an administrator has
// to act, and every other lead is about to hit the same wall.
const TWILIO_CONFIGURATION = new Set([
  "20003", // authentication failed
  "20404", // resource not found (usually a wrong account SID)
  "21606", // 'From' number is not a valid, owned number
  "21608", // unverified number (trial account)
  "30007", // carrier violation / filtered as spam
  "30034", // 10DLC campaign not registered
  "30038", // 10DLC campaign pending
]);

const TELNYX_PERMANENT = new Set([
  "40001", // invalid destination
  "40002", // destination unreachable
  "40008", // blocked by STOP
  "40010", // landline / not SMS capable
]);

const TELNYX_CONFIGURATION = new Set([
  "10001", // unauthorized
  "40300", // number not owned
  "40305", // 10DLC not registered
]);

/**
 * Classify a provider failure. Unknown codes are deliberately TRANSIENT:
 * an unrecognised failure is more likely a blip than a permanently bad
 * number, and wrongly marking a real borrower's number permanently dead is
 * a worse error than one wasted retry.
 */
export function classifyFailure(
  provider: DeliveryProviderId,
  providerCode: string | undefined,
  message: string
): DeliveryFailure {
  const code = providerCode?.trim();
  const lower = message.toLowerCase();

  // A network-layer failure never reached the provider at all.
  if (!code && /econnrefused|etimedout|enotfound|network|fetch failed|socket hang up/.test(lower)) {
    return { class: "TRANSIENT", message, affectsAllLeads: false };
  }

  // Auth failures are recognisable across every vendor and always mean the
  // credential in the admin panel is wrong or revoked.
  if (/unauthorized|authentication|invalid api key|forbidden|401|403/.test(lower)) {
    return { class: "CONFIGURATION", providerCode: code, message, affectsAllLeads: true };
  }

  // Rate limiting is explicitly transient — backing off is the correct and
  // only response, and marking it permanent would kill a working channel.
  if (/rate limit|too many requests|429/.test(lower)) {
    return { class: "TRANSIENT", providerCode: code, message, affectsAllLeads: false };
  }

  if (code) {
    if (provider === "twilio") {
      if (TWILIO_CONFIGURATION.has(code)) return { class: "CONFIGURATION", providerCode: code, message, affectsAllLeads: true };
      if (TWILIO_PERMANENT.has(code)) return { class: "PERMANENT", providerCode: code, message, affectsAllLeads: false };
    }
    if (provider === "telnyx") {
      if (TELNYX_CONFIGURATION.has(code)) return { class: "CONFIGURATION", providerCode: code, message, affectsAllLeads: true };
      if (TELNYX_PERMANENT.has(code)) return { class: "PERMANENT", providerCode: code, message, affectsAllLeads: false };
    }
  }

  // Resend reports bounces as text rather than numeric codes.
  if (provider === "resend") {
    if (/hard bounce|invalid recipient|mailbox does not exist|no such user/.test(lower)) {
      return { class: "PERMANENT", providerCode: code, message, affectsAllLeads: false };
    }
    if (/domain is not verified|not verified/.test(lower)) {
      return { class: "CONFIGURATION", providerCode: code, message, affectsAllLeads: true };
    }
  }

  return { class: "TRANSIENT", providerCode: code, message, affectsAllLeads: false };
}

// --- Provider status → canonical outcome ------------------------------------

/**
 * Map a provider's delivery-status webhook to our outcome vocabulary.
 * Returns null for statuses that carry no outcome information (e.g. Twilio's
 * "initiated"), so a caller can distinguish "no change" from "unknown status".
 */
export function mapProviderStatus(
  provider: DeliveryProviderId,
  status: string
): AttemptOutcome | null {
  const s = status.trim().toLowerCase();

  switch (provider) {
    case "twilio":
      // SMS statuses
      if (s === "queued" || s === "accepted" || s === "scheduled") return "QUEUED";
      if (s === "sending" || s === "sent") return "SENT";
      if (s === "delivered") return "DELIVERED";
      if (s === "undelivered") return "UNDELIVERED";
      if (s === "failed") return "FAILED";
      // Voice statuses
      if (s === "initiated" || s === "ringing") return "QUEUED";
      if (s === "in-progress") return "SENT";
      if (s === "completed") return "ANSWERED";
      if (s === "busy") return "BUSY";
      if (s === "no-answer") return "NO_ANSWER";
      if (s === "canceled") return "FAILED";
      return null;

    case "telnyx":
      if (s === "queued" || s === "sending") return "QUEUED";
      if (s === "sent") return "SENT";
      if (s === "delivered") return "DELIVERED";
      if (s === "delivery_failed" || s === "undelivered") return "UNDELIVERED";
      if (s === "sending_failed" || s === "failed") return "FAILED";
      return null;

    case "resend":
      if (s === "email.sent") return "SENT";
      if (s === "email.delivered") return "DELIVERED";
      if (s === "email.bounced") return "UNDELIVERED";
      if (s === "email.complained") return "UNDELIVERED";
      // Resend refused to send at all (email.failed), or the address is on
      // its suppression list (email.suppressed). Both were previously
      // unmapped, so the attempt sat at SENT and nobody learned the borrower
      // was never emailed.
      if (s === "email.failed") return "FAILED";
      if (s === "email.suppressed") return "UNDELIVERED";
      if (s === "email.delivery_delayed") return "QUEUED";
      return null;

    case "vapi":
      if (s === "queued" || s === "ringing") return "QUEUED";
      if (s === "in-progress") return "SENT";
      if (s === "ended") return "ANSWERED";
      if (s === "no-answer") return "NO_ANSWER";
      if (s === "busy") return "BUSY";
      if (s === "failed") return "FAILED";
      return null;

    default:
      return null;
  }
}

/**
 * Map Vapi's `endedReason` on an end-of-call-report to a call outcome.
 *
 * Without this every AI call is recorded as QUEUED forever, so the lead's
 * history shows a call that never resolved and the cadence can't tell a
 * conversation from a voicemail. Vapi's reasons are free-form strings that
 * grow over time, so this matches on stable substrings rather than an exact
 * enum, and falls back to ANSWERED only when the call genuinely connected.
 */
export function mapVapiEndedReason(endedReason: string | undefined): AttemptOutcome {
  const r = (endedReason ?? "").toLowerCase();
  if (!r) return "ANSWERED";
  if (r.includes("no-answer") || r.includes("did-not-answer") || r.includes("no_answer")) return "NO_ANSWER";
  if (r.includes("voicemail")) return "VOICEMAIL";
  if (r.includes("busy")) return "BUSY";
  // Errors on our side or the provider's — the borrower was never spoken to.
  if (r.includes("error") || r.includes("failed") || r.includes("rejected")) return "FAILED";
  // "silence-timed-out" means it connected but nobody spoke — closer to a
  // voicemail/no-answer than to a real conversation.
  if (r.includes("silence")) return "NO_ANSWER";
  // customer-ended-call, assistant-ended-call, etc. — a real conversation.
  return "ANSWERED";
}

/** Did the borrower actually engage, i.e. should the lead advance to
 *  IN_CONVERSATION and the transcript be worth extracting from? */
export function isAnsweredOutcome(outcome: AttemptOutcome): boolean {
  return outcome === "ANSWERED" || outcome === "DELIVERED";
}

// --- Lifecycle ordering -----------------------------------------------------

/**
 * How far along the delivery lifecycle an outcome sits. Used to reject
 * out-of-order webhooks: providers do not guarantee ordering, and a delayed
 * "sent" arriving after "delivered" must not walk the attempt backwards.
 */
const PROGRESSION: Record<AttemptOutcome, number> = {
  QUEUED: 1,
  SENT: 2,
  // Terminal outcomes all sit at the top; whichever lands first wins, and
  // later updates can't downgrade a settled attempt.
  BLOCKED: 3,
  DELIVERED: 3,
  ANSWERED: 3,
  NO_ANSWER: 3,
  BUSY: 3,
  VOICEMAIL: 3,
  FAILED: 3,
  UNDELIVERED: 3,
};

const TERMINAL: ReadonlySet<AttemptOutcome> = new Set<AttemptOutcome>([
  "DELIVERED", "ANSWERED", "NO_ANSWER", "BUSY", "VOICEMAIL", "FAILED", "UNDELIVERED", "BLOCKED",
]);

export function isTerminalOutcome(outcome: AttemptOutcome): boolean {
  return TERMINAL.has(outcome);
}

/**
 * Decide whether an incoming provider status should overwrite what we have.
 *
 * Two rules, both learned from how these webhooks actually behave:
 *  - never move backwards (a late "sent" after "delivered" is noise);
 *  - never overwrite one terminal outcome with another (the first settled
 *    answer is the real one; duplicates are retries of the same webhook).
 */
export function shouldApplyStatus(current: AttemptOutcome, incoming: AttemptOutcome): boolean {
  if (current === incoming) return false;
  if (isTerminalOutcome(current)) return false;
  return (PROGRESSION[incoming] ?? 0) > (PROGRESSION[current] ?? 0);
}

// --- Retry policy -----------------------------------------------------------

export interface RetryDecision {
  retry: boolean;
  /** Minutes to wait before the next attempt, when retrying. */
  delayMinutes: number;
  reason: string;
}

/** Exponential backoff, capped. Deliberately small — a mortgage lead goes
 *  cold fast, so a message worth sending is worth sending soon or not at all. */
const RETRY_DELAYS_MINUTES = [5, 15, 60];

/**
 * Whether a failed send should be retried, and when.
 *
 * The important property: a failure that never reached the borrower must not
 * consume the lead's attempt budget or advance the cadence. Otherwise a
 * provider outage silently burns a lead's entire cadence without a single
 * message being delivered, and the lead lands in NURTURE having never been
 * contacted at all.
 */
export function decideRetry(failure: DeliveryFailure, priorFailedTries: number): RetryDecision {
  if (failure.class === "PERMANENT") {
    return { retry: false, delayMinutes: 0, reason: "Destination is permanently undeliverable — retrying would send the same message to the same bad address." };
  }
  if (failure.class === "CONFIGURATION") {
    return { retry: false, delayMinutes: 0, reason: "Provider configuration or credentials are wrong — this affects every lead and needs an administrator, not a retry." };
  }
  if (priorFailedTries >= RETRY_DELAYS_MINUTES.length) {
    return { retry: false, delayMinutes: 0, reason: `Giving up after ${priorFailedTries} transient failures.` };
  }
  return {
    retry: true,
    delayMinutes: RETRY_DELAYS_MINUTES[priorFailedTries],
    reason: `Transient failure — retry ${priorFailedTries + 1} of ${RETRY_DELAYS_MINUTES.length}.`,
  };
}

/**
 * Does this failure mean we should stop using this channel for this lead?
 * A permanently bad phone number is a data-quality fact about the borrower,
 * not a transient event, and the CRM should route around it rather than
 * rediscovering it on every cadence step.
 */
export function shouldSuppressChannel(failure: DeliveryFailure): boolean {
  return failure.class === "PERMANENT";
}

/**
 * Whether a failed attempt counts against the lead's daily/total attempt caps.
 *
 * Only a message that actually reached the borrower's carrier counts. This is
 * both correct behaviour and a compliance point: attempt caps exist to limit
 * how often a borrower is *contacted*, and a message that never arrived did
 * not contact anyone.
 */
export function countsAgainstAttemptCap(outcome: AttemptOutcome): boolean {
  return outcome !== "FAILED" && outcome !== "BLOCKED";
}

/** Human-readable, operator-facing summary for the attempt timeline. */
export function describeFailure(channel: Channel, failure: DeliveryFailure): string {
  const label = channel === "VOICE" ? "Call" : channel === "SMS" ? "Text" : "Email";
  switch (failure.class) {
    case "PERMANENT":
      return `${label} could not be delivered to this contact — the address or number is invalid or has opted out. Marked undeliverable; try another channel.`;
    case "CONFIGURATION":
      return `${label} failed because of a provider configuration problem. This affects all leads — an administrator needs to check Admin → Integrations.`;
    case "TRANSIENT":
      return `${label} failed temporarily and will be retried automatically.`;
  }
}
