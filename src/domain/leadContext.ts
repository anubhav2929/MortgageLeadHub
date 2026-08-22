// The one way to build a lead's conversation context.
//
// buildLeadThread() takes `intake` as an OPTIONAL argument, and four of its
// five call sites forgot it — including the voice orchestrator, which is what
// feeds the AI phone agent, and the borrower chat. The result was a system
// that looked correct on the officer's screen (the lead page passed it) while
// every AI surface opened cold, unaware of what the borrower had actually
// filled in.
//
// Optional context that must be remembered is context that will be forgotten.
// These helpers take the lead and assemble everything themselves, so a new
// caller cannot silently get a degraded thread.

import { buildConversationBrief, buildLeadThread, type ThreadMessage } from "@/core/conversationThread";
import type { Database } from "@/domain/store";
import type { Lead } from "@/domain/types";

/** Everything said to or by this borrower, across every channel, in order —
 *  starting with what they told the intake form. */
export function buildThreadForLead(db: Database, lead: Lead): ThreadMessage[] {
  return buildLeadThread({
    attempts: db.attempts.filter((a) => a.leadId === lead.id),
    conversations: Array.from(db.conversations.values()).filter((c) => c.leadId === lead.id),
    notes: db.notes.filter((n) => n.leadId === lead.id),
    intake: {
      submittedAt: lead.createdAt,
      intent: lead.intent,
      goal: lead.goal,
      timeline: lead.timeline,
      stateCode: lead.stateCode,
      occupancy: lead.occupancy,
      estimatedValue: lead.estimatedValue,
      currentBalance: lead.currentBalance,
      missedPayments: lead.missedPayments,
    },
  });
}

/**
 * The same context, condensed for a model prompt.
 *
 * Every AI surface — the phone agent, the chat, outreach copy — should use
 * this rather than assembling its own, so they cannot disagree about what the
 * borrower has already said.
 */
export function buildBriefForLead(db: Database, lead: Lead, maxMessages = 12): string {
  return buildConversationBrief(buildThreadForLead(db, lead), maxMessages);
}
