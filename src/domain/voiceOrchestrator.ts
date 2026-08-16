// The single place an outbound call is placed, whoever asked for it.
//
// Before this existed there were two independent call paths: the officer's
// "Call" button went to Twilio TwiML (a one-way recorded announcement) and a
// separate "AI call" button went to Vapi (a real conversation). The automated
// cadence used the announcement path too. So the default experience — and
// every automated voice touch — was a robocall that could not qualify anyone,
// while the actual product sat behind a secondary button.
//
// This module inverts that. Vapi is the voice channel; the Twilio
// announcement is a labelled fallback that only runs when no conversational
// agent is configured, and never runs unattended.
//
// It is also where "one conversation across channels" becomes true: the
// borrower's SMS/email history is loaded and handed to the agent, so a call
// continues the thread instead of restarting it.

import { placeVoiceAgentCall } from "@/adapters/voiceAgent";
import { placeCall } from "@/adapters/voice";
import { generateOutreachContent } from "@/adapters/llm";
import { producesConversation, selectVoiceStrategy, type VoiceStrategy } from "@/core/callStrategy";
import { buildConversationBrief, buildLeadThread } from "@/core/conversationThread";
import type { DeliveryFailure } from "@/core/deliveryStatus";
import { getCapabilities } from "@/lib/runtimeConfig";
import { newId, nowIso, type Database } from "@/domain/store";
import type { Lead, Person } from "@/domain/types";

export interface PlaceCallOutcome {
  ok: boolean;
  strategy: VoiceStrategy;
  attemptId: string;
  /** Only set when the mechanism actually opens a conversation (Vapi). */
  conversationId?: string;
  /** The announcement script, when that's what ran — the officer should see
   *  exactly what the borrower is hearing. */
  script?: string;
  simulated: boolean;
  failure?: DeliveryFailure;
}

/** Everything the caller needs to know before deciding to offer a call. */
export async function currentVoiceStrategy(): Promise<VoiceStrategy> {
  const caps = await getCapabilities();
  return selectVoiceStrategy({
    hasVoiceAgent: caps.hasVoiceAgent,
    hasPartialVoiceAgent: caps.hasPartialVoiceAgent,
    hasTwilioVoice: caps.hasVoice,
  });
}

/**
 * Place an outbound call using the best available mechanism.
 *
 * Assumes PolicyGate has already allowed this touch — this function decides
 * *how* to call, never *whether* to. It records the ContactAttempt (and the
 * ConversationSession, when one applies) but deliberately does not mutate the
 * lead's counters or state: the caller owns that, because manual and
 * automated touches account for them differently.
 */
export async function placeOutboundCall(
  db: Database,
  lead: Lead,
  person: Person | undefined,
  actor?: { id: string; name: string }
): Promise<PlaceCallOutcome> {
  const strategy = await currentVoiceStrategy();
  const attemptId = newId("attempt");
  const idempotencyKey = newId("idem");

  // One thread, all channels. This is what makes a call a continuation of the
  // text conversation rather than a fresh cold call.
  const thread = buildLeadThread({
    attempts: db.attempts.filter((a) => a.leadId === lead.id),
    conversations: Array.from(db.conversations.values()).filter((c) => c.leadId === lead.id),
    notes: db.notes.filter((n) => n.leadId === lead.id),
  });
  const priorContext = buildConversationBrief(thread);

  if (strategy.mechanism === "ANNOUNCEMENT") {
    // Degraded path: a recorded message. Still generate the copy through the
    // same content pipeline so what the borrower hears matches our voice.
    const content = await generateOutreachContent({
      channel: "VOICE",
      firstName: person?.firstName ?? "there",
      intent: lead.intent,
      goal: lead.goal,
      officerFirstName: actor?.name.split(" ")[0] ?? "the team",
      isFirstContact: !lead.firstContactAt,
      priorContext: priorContext || undefined,
    });

    const result = await placeCall({ to: person?.phoneE164 ?? "", message: content.body, idempotencyKey });
    db.attempts.push({
      id: attemptId,
      leadId: lead.id,
      channel: "VOICE",
      direction: "OUTBOUND",
      idempotencyKey,
      providerMessageId: result.ok ? result.providerMessageId : undefined,
      outcome: result.ok ? "QUEUED" : "FAILED",
      failureClass: result.ok ? undefined : result.failure.class,
      failureMessage: result.ok ? undefined : result.failure.message,
      attemptNumber: lead.attemptsTotal + 1,
      scheduledFor: nowIso(),
      startedAt: nowIso(),
      body: content.body,
      aiGenerated: !content.simulated,
      loggedById: actor?.id,
      loggedByName: actor?.name,
    });

    return {
      ok: result.ok,
      strategy,
      attemptId,
      script: content.body,
      simulated: result.ok ? result.simulated : false,
      failure: result.ok ? undefined : result.failure,
    };
  }

  // Preferred path: a real conversation.
  const conversationId = newId("conv");
  const result = await placeVoiceAgentCall({
    leadId: lead.id,
    conversationId,
    firstName: person?.firstName ?? "there",
    intent: lead.intent,
    goal: lead.goal,
    phoneE164: person?.phoneE164 ?? "",
    priorContext: priorContext || undefined,
  });

  db.attempts.push({
    id: attemptId,
    leadId: lead.id,
    channel: "VOICE",
    direction: "OUTBOUND",
    idempotencyKey,
    providerMessageId: result.ok ? result.providerCallId : undefined,
    outcome: result.ok ? "QUEUED" : "FAILED",
    failureClass: result.ok ? undefined : result.failure.class,
    failureMessage: result.ok ? undefined : result.failure.message,
    attemptNumber: lead.attemptsTotal + 1,
    scheduledFor: nowIso(),
    startedAt: nowIso(),
    loggedById: actor?.id,
    loggedByName: actor?.name,
  });

  // Only open a session when a transcript is genuinely coming. Opening one
  // for a failed call leaves it IN_PROGRESS forever, waiting on a webhook
  // that will never arrive.
  if (result.ok && producesConversation(strategy.mechanism)) {
    db.conversations.set(conversationId, {
      id: conversationId,
      leadId: lead.id,
      contactAttemptId: attemptId,
      promptVersionId: "prompt_qualify_v4",
      channel: "VOICE",
      status: "IN_PROGRESS",
      startedAt: nowIso(),
      escalated: false,
      transcript: [],
      redactionApplied: false,
      listenUrl: result.listenUrl,
      controlUrl: result.controlUrl,
      // The provider has accepted the request; nothing has rung yet. Anything
      // beyond this is asserted only by a webhook.
      callStatus: "QUEUED",
    });
  }

  return {
    ok: result.ok,
    strategy,
    attemptId,
    conversationId: result.ok ? conversationId : undefined,
    simulated: result.ok ? result.simulated : false,
    failure: result.ok ? undefined : result.failure,
  };
}
