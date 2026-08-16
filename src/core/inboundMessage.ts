// Classifying an inbound SMS. Pure, no I/O.
//
// Why this exists: the SMS consent disclosure the borrower legally agreed to
// says "Reply STOP to opt out at any time", the privacy policy repeats it, and
// the FAQ promises it works "across every channel". None of that was true —
// there was no inbound webhook, so a STOP reply was invisible to us. The
// carrier would stop that one channel while our system carried on calling and
// emailing, because it never learned anything had happened.
//
// The keyword lists follow the CTIA messaging principles that carriers
// enforce. Handling STOP and HELP is not optional: a campaign that ignores
// them gets its 10DLC registration revoked, on top of the TCPA exposure.

export type InboundIntent = "OPT_OUT" | "OPT_IN" | "HELP" | "MESSAGE";

/** Carrier-mandated opt-out keywords. Matched case-insensitively on the whole
 *  trimmed message — "STOP" opts out, "stop by tomorrow" does not. */
const OPT_OUT_KEYWORDS = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "optout",
  "opt-out",
  "opt out",
  "remove",
]);

/** Carrier-mandated resubscribe keywords. */
const OPT_IN_KEYWORDS = new Set(["start", "unstop", "yes", "optin", "opt-in", "opt in", "subscribe"]);

/** Carrier-mandated help keywords. */
const HELP_KEYWORDS = new Set(["help", "info"]);

/**
 * Classify an inbound message body.
 *
 * Deliberately strict: only a message that is *exactly* a keyword counts.
 * Carriers specify exact-match for this reason — a borrower writing "please
 * stop calling me so early" is a conversation to route to an officer, and
 * silently suppressing them on a substring match would lose a live lead.
 * (That particular sentence is still a strong signal, which is why the
 * caller also gets `looksLikeOptOutPhrase` to flag it for a human rather
 * than acting on it automatically.)
 */
export function classifyInboundMessage(body: string): InboundIntent {
  const normalized = body
    .trim()
    .toLowerCase()
    // Strip surrounding punctuation: "STOP." and "stop!" are still STOP.
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

  if (OPT_OUT_KEYWORDS.has(normalized)) return "OPT_OUT";
  if (OPT_IN_KEYWORDS.has(normalized)) return "OPT_IN";
  if (HELP_KEYWORDS.has(normalized)) return "HELP";
  return "MESSAGE";
}

/**
 * A free-text message that reads like an opt-out without being an exact
 * keyword. NOT acted on automatically — it raises a task so a human decides,
 * because the cost of wrongly suppressing a live borrower is high and the
 * phrasing here is genuinely ambiguous.
 */
export function looksLikeOptOutPhrase(body: string): boolean {
  const t = body.toLowerCase();
  return (
    /\b(stop|quit|cease)\b.{0,20}\b(call|calling|text|texting|messag|contact|email)/.test(t) ||
    /\b(don'?t|do not|no more|never)\b.{0,20}\b(call|text|contact|email|message)/.test(t) ||
    /\b(take|remove)\b.{0,20}\b(me|my number)\b.{0,20}\b(off|from)\b/.test(t) ||
    /\bnot interested\b/.test(t) ||
    /\bwrong number\b/.test(t)
  );
}

/** The reply a carrier expects for HELP. Kept here so the wording lives beside
 *  the keyword list it answers. */
export const HELP_REPLY_TEXT =
  "Equity Flow Group: we help homeowners compare refinance and home-equity options. " +
  "Reply STOP to opt out. Msg&data rates may apply.";

/** Confirmation sent after an opt-out. Carriers require exactly one final
 *  message acknowledging the opt-out, and no further messages after it. */
export const OPT_OUT_CONFIRMATION_TEXT =
  "Equity Flow Group: you're unsubscribed and won't receive further messages. Reply START to resubscribe.";

/**
 * Which suppressions a borrower's own START reply may lift.
 *
 * Only their own opt-out. A number on the list because of a DNC match, a
 * complaint, or litigation must never be resurrected by a text message —
 * those were placed by someone other than the borrower, for reasons a
 * borrower cannot unilaterally reverse, and an attacker who could forge an
 * inbound message must not be able to re-enable outreach to them.
 */
export function mayResubscribe(suppressionReason: string): boolean {
  return suppressionReason === "OPT_OUT_STOP";
}
