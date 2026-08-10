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

export function buildLeadThread(input: {
  attempts: ContactAttempt[];
  conversations: ConversationSession[];
  notes: Note[];
}): ThreadMessage[] {
  const messages: ThreadMessage[] = [];

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
export function buildConversationBrief(thread: ThreadMessage[], maxMessages = 12): string {
  if (thread.length === 0) return "";
  const recent = thread.slice(-maxMessages);
  const lines = recent.map((m) => {
    const who = m.role === "BORROWER" ? "Borrower" : m.role === "OFFICER" ? "Loan officer" : "Us";
    const via = m.channel === "PORTAL" ? "status page" : m.channel.toLowerCase();
    const body = m.text.length > 300 ? `${m.text.slice(0, 300)}…` : m.text;
    return `- [${via}] ${who}: ${body}`;
  });
  return lines.join("\n");
}
