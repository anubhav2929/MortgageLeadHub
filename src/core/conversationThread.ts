// One conversation per lead, across every channel.
//
// Before this, a lead's history lived in three unrelated places: outbound
// sends in db.contactAttempts, voice transcripts in db.conversations, and
// borrower replies in db.notes. Nothing stitched them together, so both the
// officer and the AI saw a third of the story at a time — the AI would open
// a call with a generic script even if the borrower had texted "I'm away
// until the 15th" an hour earlier.
//
// This builds that thread as a DERIVED view rather than a fourth store. A
// separate table would have to be written from five different code paths and
// would silently drift the first time one of them was missed; deriving from
// the records that already exist cannot go out of sync with them.
//
// Pure: takes plain arrays, returns a sorted list. No db access, no I/O.

import type { AttemptOutcome, Channel, ContactAttempt, ConversationSession, Note } from "@/domain/types";

/** Channels a thread message can arrive on. PORTAL is the status-page chat,
 *  which isn't a carrier channel but is still the borrower talking to us. */
export type ThreadChannel = Channel | "PORTAL";

export type ThreadRole = "BORROWER" | "AGENT" | "OFFICER" | "SYSTEM";

export interface ThreadMessage {
  id: string;
  at: string;
  channel: ThreadChannel;
  direction: "INBOUND" | "OUTBOUND";
  role: ThreadRole;
  text: string;
  subject?: string;
  aiGenerated?: boolean;
  outcome?: AttemptOutcome;
  /** Short display note — "voicemail", "no answer", "blocked". */
  meta?: string;
}

/** Borrower-authored notes are tagged with this authorId by
 *  submitBorrowerMessageAction and ingestInboundEmail. Anything else in
 *  db.notes is an officer's internal note and is NOT part of the
 *  borrower-facing conversation. */
const BORROWER_AUTHOR_ID = "borrower";

function inboundChannelFromAuthor(authorName: string): ThreadChannel {
  const n = authorName.toLowerCase();
  if (n.includes("email")) return "EMAIL";
  if (n.includes("sms") || n.includes("text")) return "SMS";
  return "PORTAL";
}

/** The borrower's own words from the intake form, as the thread's opening
 *  message. Optional so callers that only need channel history (the router,
 *  the AI brief) are unaffected. */
export interface IntakeSummary {
  submittedAt: string;
  intent: string;
  goal: string;
  timeline: string;
  stateCode: string;
  occupancy?: string;
  estimatedValue?: number;
  currentBalance?: number;
  missedPayments?: string;
}

/**
 * Enum → prose. Naive underscore-stripping is not enough: `1_3_MONTHS`
 * becomes "1 3 months", which reads like a typo in borrower-facing text.
 * Ranges get an en dash, and the few enums with an established phrasing are
 * spelled out rather than transliterated.
 */
const PHRASES: Record<string, string> = {
  ASAP: "as soon as possible",
  EXPLORING: "still exploring",
  SECOND_HOME: "second home",
  CASH_OUT: "cash-out refinance",
  DEBT_CONSOLIDATION: "consolidate debt",
  LOWER_PAYMENT: "lower my payment",
  SHORTEN_TERM: "shorten my term",
  ONE_TO_TWO: "one or two",
  THREE_PLUS: "three or more",
};

const humanise = (v: string) =>
  PHRASES[v] ?? v.replace(/^(\d+)_(\d+)_/, "$1–$2 ").replace(/_/g, " ").toLowerCase();

const money = (n: number) => `$${n.toLocaleString()}`;

/**
 * Renders the intake form as something a person said, not a record dump.
 *
 * The officer opening the Conversation tab is about to talk to this borrower.
 * "REFINANCE / PRIMARY / ZERO_TO_THREE_MONTHS" is a database row; "I'm looking
 * to refinance my primary home in TX, ideally within three months" is the
 * opening of a conversation they can actually continue.
 */
export function describeIntake(intake: IntakeSummary): string {
  const parts: string[] = [];
  parts.push(`I'm looking at a ${humanise(intake.intent)} on my ${humanise(intake.occupancy ?? "PRIMARY")} home in ${intake.stateCode}.`);
  parts.push(`My goal is to ${humanise(intake.goal)}, and my timeline is ${humanise(intake.timeline)}.`);

  if (intake.estimatedValue && intake.currentBalance) {
    const equity = intake.estimatedValue - intake.currentBalance;
    parts.push(
      `I estimate the home is worth ${money(intake.estimatedValue)} with ${money(intake.currentBalance)} left on the mortgage` +
        (equity > 0 ? ` (about ${money(equity)} of equity).` : ".")
    );
  } else if (intake.estimatedValue) {
    parts.push(`I estimate the home is worth ${money(intake.estimatedValue)}.`);
  }

  // Stated explicitly in both directions: "no missed payments" is information
  // the officer needs, not an absence of it.
  if (intake.missedPayments === "NONE") parts.push("I haven't missed any mortgage payments.");
  else if (intake.missedPayments) parts.push(`I've had ${humanise(intake.missedPayments)} missed payments.`);

  return parts.join(" ");
}

/**
 * NOTE FOR DOMAIN CALLERS: prefer `buildThreadForLead` / `buildBriefForLead`
 * in domain/leadContext.ts. `intake` here is optional, and every caller that
 * forgot it produced an AI surface that opened cold — unaware of what the
 * borrower had filled in — while looking correct on screen. The helpers
 * assemble it for you. Use this directly only when you deliberately want the
 * channel history WITHOUT the intake, as the cadence router does.
 */
export function buildLeadThread(input: {
  attempts: ContactAttempt[];
  conversations: ConversationSession[];
  notes: Note[];
  /** When present, opens the thread with what the borrower told the form. */
  intake?: IntakeSummary;
}): ThreadMessage[] {
  const messages: ThreadMessage[] = [];

  // The intake form is the first thing the borrower ever told us, so the
  // conversation starts there. Without it the thread opens mid-story — an
  // officer sees our outbound call before seeing what the borrower asked for,
  // and the post-submit chat reads as a conversation with no beginning.
  if (input.intake) {
    messages.push({
      id: "intake-submission",
      at: input.intake.submittedAt,
      channel: "PORTAL",
      direction: "INBOUND",
      role: "BORROWER",
      text: describeIntake(input.intake),
      meta: "submitted the intake form",
    });
  }

  // A voice attempt and its ConversationSession describe the same call. Show
  // the transcript when there is one, and fall back to the attempt row (as a
  // "call placed" marker) when there isn't — never both, or every AI call
  // would appear twice.
  const conversationsByAttempt = new Map<string, ConversationSession>();
  for (const c of input.conversations) {
    if (c.contactAttemptId) conversationsByAttempt.set(c.contactAttemptId, c);
  }

  for (const a of input.attempts) {
    const convo = conversationsByAttempt.get(a.id);
    const at = a.startedAt ?? a.scheduledFor;

    if (convo && convo.transcript.length > 0) {
      for (const turn of convo.transcript) {
        messages.push({
          id: `${convo.id}-t${turn.turn}`,
          at: turn.at,
          channel: a.channel,
          direction: turn.role === "BORROWER" ? "INBOUND" : "OUTBOUND",
          role: turn.role === "BORROWER" ? "BORROWER" : "AGENT",
          text: turn.text,
          aiGenerated: turn.role !== "BORROWER",
        });
      }
      continue;
    }

    // No transcript: represent the attempt itself.
    const text = a.body?.trim() || (a.channel === "VOICE" ? "Call placed." : "");
    if (!text && !a.blockedReason) continue;
    messages.push({
      id: a.id,
      at,
      channel: a.channel,
      direction: a.direction,
      role: a.direction === "INBOUND" ? "BORROWER" : a.loggedById ? "OFFICER" : a.aiGenerated ? "AGENT" : "SYSTEM",
      text: text || "Outreach blocked before sending.",
      subject: a.subject,
      aiGenerated: a.aiGenerated,
      outcome: a.outcome,
      meta: a.blockedReason ? "blocked" : undefined,
    });
  }

  // Transcripts whose attempt row is missing (e.g. a webhook landed before
  // the attempt was linked) would otherwise vanish from the thread entirely.
  const seenConversationIds = new Set(
    input.attempts.map((a) => conversationsByAttempt.get(a.id)?.id).filter(Boolean) as string[]
  );
  for (const c of input.conversations) {
    if (seenConversationIds.has(c.id)) continue;
    for (const turn of c.transcript) {
      messages.push({
        id: `${c.id}-t${turn.turn}`,
        at: turn.at,
        channel: c.channel,
        direction: turn.role === "BORROWER" ? "INBOUND" : "OUTBOUND",
        role: turn.role === "BORROWER" ? "BORROWER" : "AGENT",
        text: turn.text,
        aiGenerated: turn.role !== "BORROWER",
      });
    }
  }

  for (const n of input.notes) {
    if (n.authorId !== BORROWER_AUTHOR_ID) continue; // officer's private note, not the conversation
    messages.push({
      id: n.id,
      at: n.createdAt,
      channel: inboundChannelFromAuthor(n.authorName),
      direction: "INBOUND",
      role: "BORROWER",
      text: n.body,
    });
  }

  return messages.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** Channels the borrower has actually replied on — the strongest available
 *  signal about how this particular person wants to be reached. */
export function repliedChannels(thread: ThreadMessage[]): Set<ThreadChannel> {
  const s = new Set<ThreadChannel>();
  for (const m of thread) {
    if (m.direction === "INBOUND" && m.role === "BORROWER") s.add(m.channel);
  }
  return s;
}

export function lastOutboundChannel(thread: ThreadMessage[]): ThreadChannel | null {
  for (let i = thread.length - 1; i >= 0; i--) {
    if (thread[i].direction === "OUTBOUND") return thread[i].channel;
  }
  return null;
}

export function hasReplySince(thread: ThreadMessage[], sinceIso: string): boolean {
  const t = new Date(sinceIso).getTime();
  return thread.some((m) => m.direction === "INBOUND" && new Date(m.at).getTime() > t);
}

/** Compact plain-text history for the AI. Trimmed to the most recent turns —
 *  the model needs enough to not repeat itself or contradict what was already
 *  said, not the entire history, and prompt size is a real cost line. */
/** The synthetic opening message built by buildLeadThread from the intake
 *  form. Pinned into every brief — see below. */
export const INTAKE_MESSAGE_ID = "intake-submission";

export function buildConversationBrief(thread: ThreadMessage[], maxMessages = 12): string {
  if (thread.length === 0) return "";

  // Take the most recent messages — but never at the cost of the intake.
  //
  // The intake summary is the oldest message in the thread and also the most
  // important: it is the only place the loan purpose, equity position, and
  // timeline appear. A plain tail-slice drops it on any thread longer than
  // maxMessages, so an agent calling a chatty borrower would open the call
  // knowing what they said this morning but not what they actually want.
  const intake = thread.find((m) => m.id === INTAKE_MESSAGE_ID);
  const rest = intake ? thread.filter((m) => m.id !== INTAKE_MESSAGE_ID) : thread;
  const tail = rest.slice(-(intake ? maxMessages - 1 : maxMessages));
  const recent = intake ? [intake, ...tail] : tail;

  const lines = recent.map((m) => {
    const who = m.role === "BORROWER" ? "Borrower" : m.role === "OFFICER" ? "Loan officer" : "Us";
    const via = m.channel === "PORTAL" ? "status page" : m.channel.toLowerCase();
    const body = m.text.length > 300 ? `${m.text.slice(0, 300)}…` : m.text;
    return `- [${via}] ${who}: ${body}`;
  });
  return lines.join("\n");
}
