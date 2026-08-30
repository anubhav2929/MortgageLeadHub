// The Vapi call lifecycle, as a pure state mapping.
//
// A call moves through two independent tracks and conflating them is what made
// the call board unreliable:
//
//   callStatus   where the call is on the network — queued, ringing,
//                connected, ended. Driven only by provider webhooks.
//   outcome      what the attempt MEANT for the lead — answered, voicemail,
//                no answer, failed. Known only once the call has ended.
//
// The board previously showed "LIVE" from the moment we dialled, because the
// session was created as IN_PROGRESS optimistically. A queued call, a ringing
// call, and a call that never connected all looked identical to a live
// conversation.
//
// Reference: Vapi's documented endedReason taxonomy. The categories below
// follow it deliberately — a call that failed because our subscription ran out
// of credit is a *configuration* problem an administrator must fix, and
// retrying it is pure waste; a provider 503 is transient and should be retried.

import type { AttemptOutcome } from "@/domain/types";
import type { FailureClass } from "@/core/deliveryStatus";

export type CallStatus = "QUEUED" | "RINGING" | "CONNECTED" | "ENDED";

/** Monotonic ordering. Webhooks do not guarantee delivery order, and a
 *  late-arriving "ringing" must never drag a connected call backwards. */
const RANK: Record<CallStatus, number> = { QUEUED: 0, RINGING: 1, CONNECTED: 2, ENDED: 3 };

export function mapVapiCallStatus(status: string | undefined): CallStatus {
  switch ((status ?? "").toLowerCase()) {
    case "ringing":
      return "RINGING";
    // "forwarding" means the call is connected and being transferred — still
    // very much live from an operator's point of view.
    case "in-progress":
    case "forwarding":
      return "CONNECTED";
    case "ended":
      return "ENDED";
    // scheduled | queued | anything unrecognised. Treating an unknown status
    // as QUEUED is safe because advanceCallStatus never moves backwards.
    default:
      return "QUEUED";
  }
}

/** Returns the status to store, never regressing. */
export function advanceCallStatus(current: CallStatus | undefined, incoming: CallStatus): CallStatus {
  const from = current ?? "QUEUED";
  return RANK[incoming] > RANK[from] ? incoming : from;
}

export interface EndedReasonVerdict {
  outcome: AttemptOutcome;
  /** NONE when the call itself was fine, whatever the borrower did. */
  failureClass: FailureClass | "NONE";
  /** Plain-language explanation for the attempt log. */
  detail: string;
}

/**
 * Our account or configuration is broken. These never fix themselves, they
 * affect every lead, and retrying burns quota while a human has to act.
 */
const CONFIGURATION_PATTERNS: [RegExp, string][] = [
  [/subscription-frozen/, "Vapi subscription is frozen — payment has failed."],
  [/insufficient-credits|out-of-credits/, "Vapi account is out of credits."],
  [/error-get-assistant|assistant-not-found/, "Vapi could not load the assistant configuration."],
  [/error-get-phone-number|phone-number/, "The configured Vapi phone number is invalid or unavailable."],
  [/daily.*limit|outbound call limit/, "The Vapi-provisioned number has hit its daily outbound cap. Import your own carrier number."],
  [/voice-failed|transcriber-failed|llm-failed/, "A provider credential or quota failed mid-call (voice, transcriber, or model)."],
  [/pipeline-error-.*(unauthorized|forbidden|401|403)/, "A provider rejected our credentials mid-call."],
];

/** Genuinely temporary — the same call could succeed on a retry. */
const TRANSIENT_PATTERNS: [RegExp, string][] = [
  [/worker-died/, "The call worker crashed."],
  [/-50\d-|-503-|-500-/, "The provider returned a server error."],
  [/closed-websocket/, "The telephony provider dropped the connection."],
  [/sip.*(timeout|unavailable)/, "SIP timeout or temporary unavailability."],
];

/**
 * What an ended call meant.
 *
 * Order matters: account problems are checked before outcome mapping, because
 * several of them end a call with a reason that would otherwise be read as a
 * borrower behaviour. A call that never placed because credit ran out is not
 * "no answer" — nobody was ever dialled, and recording it as no-answer would
 * quietly consume the lead's attempt budget for a fault that is entirely ours.
 */
export function classifyEndedReason(endedReason: string | undefined): EndedReasonVerdict {
  const r = (endedReason ?? "").trim().toLowerCase();

  if (!r) {
    // No reason given but the call completed — treat as a real conversation
    // rather than inventing a failure.
    return { outcome: "ANSWERED", failureClass: "NONE", detail: "Call ended." };
  }

  for (const [pattern, detail] of CONFIGURATION_PATTERNS) {
    if (pattern.test(r)) return { outcome: "FAILED", failureClass: "CONFIGURATION", detail };
  }
  for (const [pattern, detail] of TRANSIENT_PATTERNS) {
    if (pattern.test(r)) return { outcome: "FAILED", failureClass: "TRANSIENT", detail };
  }

  // ---- The borrower was never reached -------------------------------------
  if (/did-not-answer|no-answer/.test(r)) {
    return { outcome: "NO_ANSWER", failureClass: "NONE", detail: "Nobody answered." };
  }
  if (/busy/.test(r)) {
    return { outcome: "BUSY", failureClass: "NONE", detail: "The line was busy." };
  }
  if (/voicemail/.test(r)) {
    return { outcome: "VOICEMAIL", failureClass: "NONE", detail: "Reached voicemail." };
  }
  if (/join-timed-out/.test(r)) {
    return { outcome: "NO_ANSWER", failureClass: "NONE", detail: "The call never connected." };
  }

  // Connected, but nobody spoke. Closer to a voicemail than a conversation —
  // treating it as ANSWERED would advance the lead to IN_CONVERSATION and put
  // a call that contained no words in front of an officer as an opportunity.
  if (/silence-timed-out/.test(r)) {
    return { outcome: "NO_ANSWER", failureClass: "NONE", detail: "Connected, but no one spoke." };
  }

  // ---- A real conversation ------------------------------------------------
  if (/customer-ended-call/.test(r)) {
    return { outcome: "ANSWERED", failureClass: "NONE", detail: "The borrower hung up." };
  }
  if (/assistant-ended-call/.test(r)) {
    return { outcome: "ANSWERED", failureClass: "NONE", detail: "The agent ended the call." };
  }
  if (/forwarded|transfer/.test(r)) {
    return { outcome: "ANSWERED", failureClass: "NONE", detail: "Transferred to a person." };
  }
  if (/exceeded-max-duration/.test(r)) {
    return { outcome: "ANSWERED", failureClass: "NONE", detail: "Hit the maximum call duration." };
  }

  // Remaining pipeline/start errors we did not name individually. Transient is
  // the safer default for an unknown error: it retries with backoff rather
  // than permanently writing off a reachable borrower.
  if (/error|failed|rejected/.test(r)) {
    return { outcome: "FAILED", failureClass: "TRANSIENT", detail: `Call failed: ${endedReason}` };
  }

  return { outcome: "ANSWERED", failureClass: "NONE", detail: `Call ended (${endedReason}).` };
}

/**
 * Classifies an error returned when *creating* the call, before any webhook.
 *
 * Distinct from classifyEndedReason: nothing was dialled, so there is no
 * outcome to interpret — only whether an administrator needs to act. Without
 * this, every Vapi creation error fell through to the generic TRANSIENT
 * default and a hard quota wall was retried on every cadence tick.
 */
export function classifyVapiCreateError(httpStatus: number, body: string): { failureClass: FailureClass; detail: string } {
  const providerMessage = extractVapiErrorMessage(body);
  const b = `${body} ${providerMessage}`.toLowerCase();

  if (httpStatus === 401 || httpStatus === 403 || /invalid key|unauthorized/.test(b)) {
    return { failureClass: "CONFIGURATION", detail: "Vapi rejected the API key. Check that it is the private key." };
  }
  if (/daily outbound call limit|numbers bought on vapi/.test(b)) {
    return {
      failureClass: "CONFIGURATION",
      detail:
        "The Vapi-provisioned number has a daily outbound cap and has hit it. Import your own carrier number and use its phone number ID.",
    };
  }
  if (/insufficient|credits|subscription|billing|payment/.test(b)) {
    return { failureClass: "CONFIGURATION", detail: "Vapi account billing problem — out of credits or a frozen subscription." };
  }
  if (/phonenumberid|phone number/.test(b)) {
    return { failureClass: "CONFIGURATION", detail: "The saved Vapi phone number ID is not valid for this account." };
  }
  if (/assistantid|assistant id|assistant.*(not found|invalid|unavailable|publish)/.test(b)) {
    return { failureClass: "CONFIGURATION", detail: "The saved Vapi assistant ID is invalid, unpublished, or unavailable to this account." };
  }
  if (/concurrency|rate limit|too many/.test(b) || httpStatus === 429) {
    return { failureClass: "TRANSIENT", detail: "Vapi concurrency or rate limit reached — retrying shortly." };
  }
  if (httpStatus >= 500) {
    return { failureClass: "TRANSIENT", detail: `Vapi server error (${httpStatus}).` };
  }
  // A 4xx we do not recognise is far more likely to be our request than a
  // blip, and retrying a malformed request every tick helps nobody.
  if (httpStatus >= 400) {
    return {
      failureClass: "CONFIGURATION",
      detail: providerMessage
        ? `Vapi rejected the request: ${providerMessage}`
        : `Vapi rejected the request (${httpStatus}) without an error message.`,
    };
  }
  return { failureClass: "TRANSIENT", detail: `Vapi call creation failed (${httpStatus}).` };
}

function extractVapiErrorMessage(body: string): string {
  let candidate = "";
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (typeof record.message === "string") candidate = record.message;
      else if (Array.isArray(record.message)) candidate = record.message.filter((part): part is string => typeof part === "string").join("; ");
      else if (typeof record.error === "string") candidate = record.error;
      else if (record.error && typeof record.error === "object" && typeof (record.error as Record<string, unknown>).message === "string") {
        candidate = String((record.error as Record<string, unknown>).message);
      }
    }
  } catch {
    candidate = body;
  }
  return candidate.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
}
