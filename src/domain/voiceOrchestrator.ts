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

import { getVoiceAgentProfile, placeVoiceAgentCall, VOICE_PROMPT_VERSION } from "@/adapters/voiceAgent";
import { placeCall } from "@/adapters/voice";
import { generateOutreachContent } from "@/adapters/llm";
import { producesConversation, selectVoiceStrategy, type VoiceStrategy } from "@/core/callStrategy";
import { evaluateCallPreflight } from "@/core/callPreflight";
import { buildBriefForLead } from "@/domain/leadContext";
import { buildLeadContextSnapshot, initializeQualification } from "@/domain/voiceWorkflow";
import type { DeliveryFailure } from "@/core/deliveryStatus";
import { getCapabilities } from "@/lib/runtimeConfig";
import { newId, nowIso, saveDb, type Database } from "@/domain/store";
import type { Lead, Person } from "@/domain/types";
import { protectBearerUrl } from "@/core/secretBox";
import { redactRestrictedText } from "@/core/sensitiveText";

export interface PlaceCallOutcome {
  ok: boolean;
  strategy: VoiceStrategy;
  attemptId: string;
  /** Only set when the mechanism actually opens a conversation (Vapi). */
  conversationId?: string;
  /** The announcement script, when that's what ran — the officer should see
   *  exactly what the borrower is hearing. */
  script?: string;
  /** Set when pre-flight refused the call — nothing was dialled. */
  blockedReason?: string;
  /** What would make the call possible. */
  remedy?: string;
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

  // Refuse calls that cannot succeed, before the provider ever sees them.
  // Every one of these previously reached Vapi, was rejected, consumed an
  // attempt from the lead's budget, and left a red row an operator had to
  // decode. The cheapest failure is the one that never leaves the building.
  const preflight = evaluateCallPreflight({
    phoneE164: person?.phoneE164,
    hasVoiceAgent: strategy.mechanism === "VAPI_AGENT",
    hasAnnouncementVoice: strategy.mechanism === "ANNOUNCEMENT",
    hasLiveCall: Array.from(db.conversations.values()).some(
      (c) => c.leadId === lead.id && c.status === "IN_PROGRESS" && c.callStatus !== "ENDED"
    ),
    // An unresolved configuration fault produces the identical failure on
    // every lead; dialling into it just multiplies what an admin must read.
    providerMisconfigured: db.attempts.some(
      (a) => a.leadId === lead.id && a.channel === "VOICE" && a.failureClass === "CONFIGURATION" && a.outcome === "FAILED"
    ),
    isAutomated: !actor,
  });

  if (!preflight.allowed) {
    db.attempts.push({
      id: attemptId,
      leadId: lead.id,
      channel: "VOICE",
      direction: "OUTBOUND",
      idempotencyKey,
      outcome: "BLOCKED",
      blockedReason: preflight.reason,
      attemptNumber: lead.attemptsTotal + 1,
      scheduledFor: nowIso(),
      loggedById: actor?.id,
      loggedByName: actor?.name,
    });
    return {
      ok: false,
      strategy,
      attemptId,
      simulated: false,
      blockedReason: preflight.reason,
      remedy: preflight.remedy,
    };
  }

  // One thread, all channels. This is what makes a call a continuation of the
  // text conversation rather than a fresh cold call.
  // Includes the intake form. Assembling this by hand here is what left the
  // phone agent unaware of what the borrower had filled in.
  const priorContext = redactRestrictedText(buildBriefForLead(db, lead)).text;

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

  // ---------------------------------------------------------------------
  // Preferred path: a real conversation.
  //
  // WRITE-AHEAD. The attempt and session are recorded BEFORE the provider is
  // contacted, then updated with the result.
  //
  // Previously both were written after `await placeVoiceAgentCall(...)`
  // returned. For the one-to-three seconds that call takes there was no record
  // anywhere: the lead's history showed nothing, and the call board — polling
  // every three seconds — saw no live calls and rendered "No calls in
  // progress". That is the blanking, and it got worse the slower the provider
  // was.
  //
  // It is also a durability problem, not only a display one. If the function
  // timed out or the instance died mid-request, we kept no evidence the call
  // had been placed — while the provider may well have placed it and the
  // borrower's phone was ringing. A record written first can be reconciled
  // later; a record never written cannot.
  // ---------------------------------------------------------------------
  const conversationId = newId("conv");
  const placedAt = nowIso();
  const voiceProfile = await getVoiceAgentProfile();
  const contextSnapshot = buildLeadContextSnapshot({
    db,
    lead,
    person,
    conversationId,
    promptVersionId: VOICE_PROMPT_VERSION,
    profileVersionId: voiceProfile.promptVersionId,
  });
  const qualification = initializeQualification(db, contextSnapshot);

  db.attempts.push({
    id: attemptId,
    leadId: lead.id,
    channel: "VOICE",
    direction: "OUTBOUND",
    idempotencyKey,
    outcome: "QUEUED",
    attemptNumber: lead.attemptsTotal + 1,
    scheduledFor: placedAt,
    startedAt: placedAt,
    loggedById: actor?.id,
    loggedByName: actor?.name,
  });

  if (producesConversation(strategy.mechanism)) {
    db.conversations.set(conversationId, {
      id: conversationId,
      leadId: lead.id,
      contactAttemptId: attemptId,
      promptVersionId: VOICE_PROMPT_VERSION,
      channel: "VOICE",
      status: "IN_PROGRESS",
      startedAt: placedAt,
      escalated: false,
      transcript: [],
      redactionApplied: false,
      callStatus: "QUEUED",
      profileSnapshot: voiceProfile,
      // Store only an immutable reference and a short approved summary here.
      // The typed snapshot itself is server-owned and deliberately excludes
      // restricted identity/credit data.
      contextSnapshot: { snapshotId: contextSnapshot.id, priorContext: priorContext || undefined },
    });
  }
  // Flushed now so a concurrent read — the board polling — sees the call
  // immediately rather than after the provider replies.
  await saveDb();

  const result = await placeVoiceAgentCall({
    leadId: lead.id,
    conversationId,
    firstName: person?.firstName ?? "there",
    lastName: person?.lastName,
    city: lead.city,
    intent: lead.intent,
    goal: lead.goal,
    phoneE164: person?.phoneE164 ?? "",
    priorContext: priorContext || undefined,
    contextSnapshot,
    initialQuestionId: qualification.nextQuestionId,
  });

  const attempt = db.attempts.find((a) => a.id === attemptId);
  const conversation = db.conversations.get(conversationId);

  if (result.ok) {
    if (attempt) attempt.providerMessageId = result.providerCallId;
    if (conversation) {
      conversation.listenUrl = protectBearerUrl(result.listenUrl);
      conversation.controlUrl = protectBearerUrl(result.controlUrl);
      conversation.profileSnapshot = result.profileSnapshot;
    }
  } else {
    // The provider refused. Settle both records rather than leaving the
    // session open — an unsettled session would sit on the board until the
    // reaper caught it, and would block the next call to this lead via
    // pre-flight's "already on a call" check.
    if (attempt) {
      attempt.outcome = "FAILED";
      attempt.failureClass = result.failure.class;
      attempt.failureMessage = result.failure.message;
      attempt.endedAt = nowIso();
    }
    if (conversation) {
      conversation.status = "COMPLETED";
      conversation.callStatus = "ENDED";
      conversation.endedAt = nowIso();
      conversation.endedReason = "provider-refused-at-placement";
      conversation.settledBySystem = true;
    }
  }
  await saveDb();

  return {
    ok: result.ok,
    strategy,
    attemptId,
    conversationId: result.ok ? conversationId : undefined,
    simulated: result.ok ? result.simulated : false,
    failure: result.ok ? undefined : result.failure,
  };
}
