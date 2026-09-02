// Receives Vapi's server events for a live voice-agent call (see
// adapters/voiceAgent.ts, which sets this route as the assistant's serverUrl
// and passes a shared secret Vapi echoes back on every request). Correlates
// each event back to the ConversationSession created when the call was
// placed (startVoiceAgentCallAction, via call.metadata.conversationId), and
// on end-of-call-report runs the transcript through the exact same
// extraction/promotion pipeline the manual "Run AI extraction" button uses.

import { after, NextResponse } from "next/server";
import { pushEvent } from "@/domain/actions";
import { newId, nowIso, refreshDb, saveDb } from "@/domain/store";
import { verifyVapiWebhookAuth } from "@/core/vapiWebhookAuth";
import { isAnsweredOutcome } from "@/core/deliveryStatus";
import { advanceCallStatus, classifyEndedReason, mapVapiCallStatus } from "@/core/vapiLifecycle";
import { transition, InvalidTransitionError } from "@/core/stateMachine";
import { getConfigValue } from "@/lib/runtimeConfig";
import { claimInlineWebhook, enqueueOutbox, enqueueWebhook, stableWebhookId } from "@/domain/durableQueue";
import { settleWebhook } from "@/domain/durableQueue";
import { processOutboxBatch } from "@/domain/outboxProcessing";
import { controlLiveCall } from "@/adapters/vapiCallControl";
import {
  bookCallbackForConversation,
  buildLeadContextSnapshot,
  createTransferAttempt,
  getCallbackSlotsForConversation,
  getNextQuestion,
  initializeQualification,
  recordQualificationAnswer,
  resolveTransferDestination,
} from "@/domain/voiceWorkflow";
import type { QualificationQuestionId } from "@/domain/types";
import { protectBearerUrl, revealBearerUrl } from "@/core/secretBox";
import { redactRestrictedText } from "@/core/sensitiveText";
import { reconcileVapiTranscript, type VapiArtifactMessage } from "@/core/vapiTranscript";

interface VapiToolCall {
  id?: string;
  name?: string;
  arguments?: unknown;
  parameters?: unknown;
  function?: { name?: string; arguments?: unknown; parameters?: unknown };
  toolCall?: {
    id?: string;
    name?: string;
    parameters?: unknown;
    arguments?: unknown;
    function?: { name?: string; arguments?: unknown; parameters?: unknown };
  };
}

interface VapiServerMessage {
  type: string;
  status?: string;
  role?: "assistant" | "user";
  transcriptType?: "partial" | "final";
  transcript?: string;
  /** Why the call ended — the only signal distinguishing a real conversation
   *  from a voicemail, a no-answer, or a pipeline error. */
  endedReason?: string;
  /** Per Vapi's server-events docs the recording is an OBJECT under
   *  `artifact.recording`, not a flat `recordingUrl`. The exact key varies by
   *  recording mode (stereo vs mono), so every known shape is accepted and
   *  the first present URL wins — a missing recording must never break
   *  transcript ingestion, which is the part that actually matters. */
  artifact?: {
    transcript?: string;
    messages?: VapiArtifactMessage[];
    logUrl?: string;
    recordingUrl?: string;
    recording?: {
      stereoUrl?: string;
      url?: string;
      combinedUrl?: string;
      mono?: { combinedUrl?: string; assistantUrl?: string; customerUrl?: string };
    };
  };
  toolCallList?: VapiToolCall[];
  toolWithToolCallList?: VapiToolCall[];
  destination?: { type?: string; number?: string };
  transferStatus?: string;
  call?: {
    id?: string;
    startedAt?: string;
    endedAt?: string;
    metadata?: { leadId?: string; conversationId?: string };
    customer?: { number?: string };
    monitor?: { controlUrl?: string };
  };
}

const QUESTION_IDS = new Set<QualificationQuestionId>([
  "timeline", "property_address", "foreclosure_status", "occupancy", "estimated_value", "mortgage_balance", "cash_goal", "credit_range", "transfer_consent",
]);

function toolArguments(call: VapiToolCall): Record<string, unknown> {
  const value = call.toolCall?.function?.arguments
    ?? call.toolCall?.function?.parameters
    ?? call.toolCall?.arguments
    ?? call.toolCall?.parameters
    ?? call.function?.arguments
    ?? call.function?.parameters
    ?? call.arguments
    ?? call.parameters
    ?? {};
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toolName(call: VapiToolCall): string {
  return call.toolCall?.function?.name ?? call.toolCall?.name ?? call.function?.name ?? call.name ?? "";
}

async function processToolCalls(message: VapiServerMessage, conversationId: string) {
  const db = await refreshDb({ force: true });
  const conversation = db.conversations.get(conversationId);
  if (!conversation) throw new Error(`Unknown conversation ${conversationId}`);
  conversation.lastSignalAt = nowIso();
  const calls = message.toolCallList ?? message.toolWithToolCallList ?? [];
  const results: Array<{ name: string; toolCallId: string; result?: string; error?: string }> = [];

  for (const call of calls) {
    const name = toolName(call);
    const toolCallId = call.toolCall?.id ?? call.id ?? stableWebhookId("VAPI", JSON.stringify(call));
    const args = toolArguments(call);
    try {
      let output: unknown;
      if (name === "get_next_question") {
        output = getNextQuestion(db, conversationId);
      } else if (name === "record_qualification_answer") {
        const questionId = String(args.questionId ?? "") as QualificationQuestionId;
        if (!QUESTION_IDS.has(questionId)) throw new Error("Unknown qualification question.");
        const latestBorrowerTurn = [...conversation.transcript].reverse().find((turn) => turn.role === "BORROWER")?.turn;
        output = recordQualificationAnswer(db, {
          conversationId,
          questionId,
          value: args.value,
          confidence: typeof args.confidence === "number" ? args.confidence : undefined,
          transcriptTurnRefs: latestBorrowerTurn ? [latestBorrowerTurn] : [],
          idempotencyKey: toolCallId,
        });
      } else if (name === "request_warm_transfer") {
        if (db.config.featureFlags?.automaticWarmTransfer !== true) throw new Error("Automatic warm transfer is not enabled; offer a callback or human follow-up.");
        const fallbackNumber = await getConfigValue("WARM_TRANSFER_FALLBACK_NUMBER");
        const transfer = createTransferAttempt(
          db,
          conversationId,
          typeof args.consentTurnRef === "number" ? args.consentTurnRef : undefined,
          toolCallId,
          fallbackNumber
        );
        const lead = db.leads.get(conversation.leadId);
        const destination = lead ? resolveTransferDestination(db, lead, fallbackNumber) : undefined;
        const controlUrl = revealBearerUrl(conversation.controlUrl) ?? message.call?.monitor?.controlUrl;
        if (!lead || !destination || !controlUrl) throw new Error("A live, licensed transfer destination is not available; offer a callback.");
        if (transfer.status === "REQUESTED") {
          const decision = db.qualificationDecisions.get(conversationId);
          const summary = `Equity Flow Group qualification summary: required questions completed; outcome ${decision?.outcome ?? "needs review"}; property state ${lead.stateCode}; inquiry ${lead.intent.replaceAll("_", " ").toLowerCase()}.`;
          const controlled = await controlLiveCall(controlUrl, {
            type: "TRANSFER",
            toNumberE164: destination.phone,
            sayFirst: "Please hold while I connect you with a licensed loan officer. If we cannot connect, I will help schedule a callback.",
            operatorMessage: summary,
          });
          transfer.status = controlled.ok ? "DIALING" : "FAILED";
          transfer.failureReason = controlled.ok ? undefined : controlled.failure.message;
          transfer.updatedAt = nowIso();
        }
        output = {
          transferAttemptId: transfer.id,
          status: transfer.status,
          message: transfer.status === "DIALING" ? "Warm transfer started. Do not announce success until the bridge event arrives." : "Transfer unavailable; offer callback scheduling now.",
        };
      } else if (name === "get_callback_slots") {
        if (db.config.featureFlags?.callbackScheduling !== true) throw new Error("Callback scheduling is not enabled.");
        const latestTransfer = Array.from(db.transferAttempts.values()).filter((item) => item.conversationId === conversationId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
        if (latestTransfer && latestTransfer.status !== "BRIDGED") {
          latestTransfer.status = "CALLBACK_OFFERED";
          latestTransfer.updatedAt = nowIso();
        }
        output = getCallbackSlotsForConversation(db, conversationId, typeof args.borrowerTimezone === "string" ? args.borrowerTimezone : undefined).slice(0, 3);
      } else if (name === "book_callback") {
        if (db.config.featureFlags?.callbackScheduling !== true) throw new Error("Callback scheduling is not enabled.");
        if (typeof args.startsAt !== "string" || typeof args.borrowerTimezone !== "string") throw new Error("An exact start time and borrower timezone are required.");
        output = await bookCallbackForConversation({
          conversationId,
          startsAt: args.startsAt,
          borrowerTimezone: args.borrowerTimezone,
          idempotencyKey: toolCallId,
        });
      } else {
        throw new Error("Unsupported server tool.");
      }
      results.push({ name, toolCallId, result: JSON.stringify({ ok: true, data: output }) });
    } catch (error) {
      results.push({
        name,
        toolCallId,
        error: error instanceof Error ? error.message : "Tool execution failed.",
      });
    }
  }
  await saveDb();
  return { results };
}

/**
 * True when the request genuinely came from Vapi.
 *
 * Accepts either authentication style. Both comparisons are constant-time —
 * a webhook that can suppress a borrower or inject transcript text is worth
 * protecting from a timing oracle.
 */
export async function POST(request: Request) {
  const vapiSecret = await getConfigValue("VAPI_WEBHOOK_SECRET");

  // Read the body as text first: HMAC verification needs the exact bytes, and
  // re-serialising a parsed object would not reproduce them.
  const rawBody = await request.text();

  // ---------------------------------------------------------------------
  // Vapi recommends an account-managed Bearer Custom Credential. Existing
  // assistants may still send X-Vapi-Secret, and an explicitly configured
  // HMAC credential is supported with a replay window. All comparisons are
  // constant-time; see core/vapiWebhookAuth.ts.
  // ---------------------------------------------------------------------
  if (!vapiSecret || !verifyVapiWebhookAuth(request.headers, rawBody, vapiSecret)) {
    console.error(
      vapiSecret
        ? "[vapi-webhook] rejected: Vapi secret, Bearer credential, and signature checks failed"
        : "[vapi-webhook] rejected: VAPI_WEBHOOK_SECRET is not configured"
    );
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { message?: VapiServerMessage };
  try {
    body = JSON.parse(rawBody);
  } catch {
    const queued = await enqueueWebhook({
      provider: "VAPI",
      providerEventId: stableWebhookId("VAPI", rawBody, request.headers.get("x-vapi-event-id")),
      eventType: "invalid-json",
      source: "primary",
      payload: { rawBody },
    });
    await settleWebhook(queued.id, "QUARANTINED", "Invalid JSON body");
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const message = body.message;
  let conversationId = message?.call?.metadata?.conversationId;
  const queued = await enqueueWebhook({
    provider: "VAPI",
    providerEventId: stableWebhookId("VAPI", rawBody, request.headers.get("x-vapi-event-id")),
    eventType: message?.type ?? "unknown",
    source: "primary",
    payload: body,
  });
  const claimed = await claimInlineWebhook(queued.id);
  // Custom tools must receive the same response on provider redelivery. Each
  // mutating tool has its own toolCallId idempotency guard, so replaying it is
  // safe; returning only {duplicate:true} would leave Vapi waiting forever.
  if (!claimed && message?.type !== "tool-calls") return NextResponse.json({ ok: true, duplicate: true });
  if (!message) {
    await settleWebhook(queued.id, "QUARANTINED", "Missing message");
    return NextResponse.json({ ok: true, quarantined: true });
  }

  try {
  // Refresh before mutating. A webhook can land on any instance, and applying
  // a status update to a snapshot that predates the call itself would both
  // miss the conversation and, on save, overwrite whatever the instance that
  // placed the call had written.
  const db = await refreshDb();
  if (!conversationId && message.call?.id) {
    conversationId = Array.from(db.conversations.values()).find((item) => item.providerCallId === message.call?.id)?.id;
  }
  if (!conversationId && message.call?.id && message.call.customer?.number) {
    const matches = Array.from(db.people.values()).filter((person) => person.role === "PRIMARY" && person.phoneE164 === message.call?.customer?.number);
    if (matches.length === 1) {
      const lead = db.leads.get(matches[0].leadId);
      if (lead) {
        const attemptId = `attempt_in_${message.call.id}`;
        conversationId = `conv_in_${message.call.id}`;
        if (!db.attempts.some((attempt) => attempt.id === attemptId)) {
          db.attempts.push({
            id: attemptId,
            leadId: lead.id,
            channel: "VOICE",
            direction: "INBOUND",
            idempotencyKey: `vapi-inbound:${message.call.id}`,
            providerMessageId: message.call.id,
            outcome: "QUEUED",
            attemptNumber: lead.attemptsTotal + 1,
            scheduledFor: nowIso(),
            startedAt: nowIso(),
          });
          db.conversations.set(conversationId, {
            id: conversationId,
            leadId: lead.id,
            contactAttemptId: attemptId,
            promptVersionId: "prompt_inbound_v1",
            channel: "VOICE",
            status: "IN_PROGRESS",
            startedAt: nowIso(),
            escalated: false,
            transcript: [],
            redactionApplied: false,
            callStatus: "QUEUED",
            providerCallId: message.call.id,
            contextSnapshot: { matchedBy: "exact_e164" },
          });
          const inboundSnapshot = buildLeadContextSnapshot({
            db,
            lead,
            person: matches[0],
            conversationId,
            promptVersionId: "prompt_inbound_v2",
            profileVersionId: "vapi_inbound",
          });
          initializeQualification(db, inboundSnapshot);
          await saveDb();
        }
      }
    } else {
      if (!db.inboundCallTriage.some((item) => item.providerCallId === message.call!.id)) {
        db.inboundCallTriage.push({
          id: `triage_${message.call.id}`,
          provider: "VAPI",
          providerCallId: message.call.id,
          fromPhone: message.call.customer.number,
          reason: matches.length === 0 ? "UNKNOWN_CALLER" : "AMBIGUOUS_CALLER",
          candidateLeadIds: matches.map((person) => person.leadId),
          status: "OPEN",
          receivedAt: nowIso(),
        });
        await saveDb();
      }
      await settleWebhook(queued.id, "QUARANTINED", "Inbound call requires human matching");
      return NextResponse.json({ ok: true, quarantined: true });
    }
  }
  if (!conversationId) {
    await settleWebhook(queued.id, "QUARANTINED", "Missing conversationId and caller match");
    return NextResponse.json({ ok: true, quarantined: true });
  }
  const resolvedConversationId = conversationId;
  const conversation = db.conversations.get(resolvedConversationId);
  if (!conversation) {
    await settleWebhook(queued.id, "QUARANTINED", `Unknown conversation ${conversationId}`);
    return NextResponse.json({ ok: true, quarantined: true });
  }
  if (message.call?.id) {
    conversation.providerCallId = message.call.id;
    const correlatedAttempt = db.attempts.find((attempt) => attempt.id === conversation.contactAttemptId);
    if (correlatedAttempt && !correlatedAttempt.providerMessageId) correlatedAttempt.providerMessageId = message.call.id;
  }

  if (message.type === "tool-calls") {
    const response = await processToolCalls(message, resolvedConversationId);
    if (claimed) await settleWebhook(queued.id, "COMPLETED");
    return NextResponse.json(response);
  }

  // Any event at all proves the call is still alive. Staleness is measured
  // from this rather than from when the call started, so a genuinely long
  // conversation that keeps emitting transcript events is never reaped.
  conversation.lastSignalAt = nowIso();

  const eventType = message.type.startsWith('transcript[') ? "transcript" : message.type;
  switch (eventType) {
    case "status-update": {
      // Mirror the carrier's own view onto callStatus so the board shows the
      // call progressing instead of claiming "connected" from the moment we
      // dialled. advanceCallStatus never regresses — webhook ordering is not
      // guaranteed, and a late "ringing" must not un-connect a live call.
      const next = advanceCallStatus(conversation.callStatus, mapVapiCallStatus(message.status));
      if (next !== conversation.callStatus) {
        conversation.callStatus = next;
        await saveDb();
      }

      if (message.status === "in-progress" && conversation.status !== "IN_PROGRESS") {
        conversation.status = "IN_PROGRESS";
        // The call is genuinely connected now, so restart the clock here
        // rather than from when we queued it. Otherwise the live timer counts
        // ringing time as conversation time.
        conversation.startedAt = nowIso();
        await saveDb();
      }

      // "ended" normally arrives just before end-of-call-report, which does the
      // real settling. Recording it here too means a call that never produces a
      // report (provider hiccup) still leaves the session closed rather than
      // stuck IN_PROGRESS forever.
      if (message.status === "ended" && conversation.status === "IN_PROGRESS") {
        conversation.endedAt = nowIso();
        await saveDb();
      }
      break;
    }

    case "transcript": {
      const finalTranscript = message.transcriptType === "final" || message.type.includes('transcriptType="final"');
      if (finalTranscript && message.transcript && conversation.transcriptSource !== "VAPI_ARTIFACT") {
        const role = message.role === "assistant" ? "AGENT" : "BORROWER";
        const sanitized = redactRestrictedText(message.transcript);
        const text = sanitized.text;
        if (sanitized.redacted) conversation.redactionApplied = true;
        const last = conversation.transcript[conversation.transcript.length - 1];

        // Vapi delivers at-least-once, and a duplicated utterance does more
        // damage than it looks: the AI brief for the NEXT call is built from
        // this transcript, so a stutter here becomes context the agent reads
        // back to the borrower.
        //
        // Keyed on the previous turn rather than the whole transcript because
        // a person genuinely can repeat themselves later in a call ("yes" …
        // "yes"), and dropping that would be worse than the duplicate. Only an
        // immediate, identical repeat from the same speaker is treated as a
        // redelivery.
        const providerEventId = queued.id;
        const isImmediateRepeat = last?.role === role && last?.text === text;
        const alreadyStored = conversation.transcript.some((turn) => turn.providerEventId === providerEventId);
        if (!isImmediateRepeat && !alreadyStored) {
          conversation.transcript.push({
            turn: conversation.transcript.length + 1,
            role,
            text,
            at: nowIso(),
            providerEventId,
          });
          conversation.transcriptSource = "LIVE_EVENTS";
          await saveDb();
        }
      }
      break;
    }

    case "transfer-update": {
      const transfer = Array.from(db.transferAttempts.values())
        .filter((item) => item.conversationId === resolvedConversationId)
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
      if (transfer) {
        const providerStatus = (message.transferStatus ?? message.status ?? "").toLowerCase();
        // A generic update proves only that the provider advanced the transfer;
        // it is not by itself evidence that borrower and officer were bridged.
        if (/failed|busy|timeout|no-answer|voicemail/.test(providerStatus)) {
          transfer.status = "FAILED";
          transfer.failureReason = providerStatus || "Provider transfer failure";
        } else if (/summary-delivered/.test(providerStatus)) {
          transfer.status = "SUMMARY_DELIVERED";
        } else if (/bridged|completed|connected/.test(providerStatus)) {
          transfer.status = "BRIDGED";
        } else if (/operator-answered|answered/.test(providerStatus)) {
          transfer.status = "OFFICER_ANSWERED";
        } else {
          transfer.status = "DIALING";
        }
        transfer.updatedAt = nowIso();
        db.events.push({
          id: newId("evt"), leadId: transfer.leadId, type: "TRANSFER_STATUS_CHANGED", actorType: "PROVIDER",
          payload: { transferAttemptId: transfer.id, status: transfer.status, providerStatus: providerStatus || undefined },
          occurredAt: nowIso(), recordedAt: nowIso(), correlationId: newId("corr"),
        });
        await saveDb();
      }
      break;
    }

    case "end-of-call-report": {
      conversation.status = "COMPLETED";
      conversation.endedAt = message.call?.endedAt ?? nowIso();
      // The final artifact is the authoritative record. It repairs a partially
      // delivered live transcript as well as a completely missing one, while
      // preserving speaker roles from artifact.messages.
      const finalTranscript = reconcileVapiTranscript({
        current: conversation.transcript,
        messages: message.artifact?.messages,
        transcript: message.artifact?.transcript,
        startedAt: message.call?.startedAt ?? conversation.startedAt,
        at: conversation.endedAt,
      });
      if (finalTranscript.authoritative) {
        conversation.transcript = finalTranscript.turns;
        conversation.transcriptSource = "VAPI_ARTIFACT";
      }
      if (finalTranscript.redactionApplied) conversation.redactionApplied = true;
      conversation.recordingAvailable = Boolean(message.artifact?.recording || message.artifact?.recordingUrl);
      conversation.callLogAvailable = Boolean(message.artifact?.logUrl);

      // Settle the ContactAttempt. Without this every AI call sits at QUEUED
      // forever: the lead's history shows a call that never resolved, and
      // nothing downstream can tell a conversation from a voicemail.
      // One classification for both what happened to the lead and whether an
      // administrator needs to act. A call that never placed because our
      // credit ran out is not "no answer" — nobody was dialled, and recording
      // it as such silently spends the lead's attempt budget on our fault.
      const verdict = classifyEndedReason(message.endedReason);
      const outcome = verdict.outcome;
      conversation.callStatus = "ENDED";
      conversation.endedReason = message.endedReason;
      conversation.settledBySystem = false;
      const attempt = db.attempts.find((a) => a.id === conversation.contactAttemptId);
      if (attempt) {
        attempt.outcome = outcome;
        attempt.endedAt = conversation.endedAt;
        attempt.transcriptId = conversation.transcript.length > 0 ? conversation.id : undefined;
        if (verdict.failureClass !== "NONE") {
          attempt.failureClass = verdict.failureClass;
          attempt.failureMessage = verdict.detail;
        }
        const rec = message.artifact?.recording;
        const recordingUrl =
          rec?.stereoUrl ?? rec?.combinedUrl ?? rec?.url ?? rec?.mono?.combinedUrl ?? message.artifact?.recordingUrl;
        if (recordingUrl && (await getConfigValue("RETAIN_RECORDING_URLS")) === "true") attempt.recordingUrl = protectBearerUrl(recordingUrl);
        if (conversation.startedAt && conversation.endedAt) {
          attempt.durationSec = Math.max(
            0,
            Math.round((new Date(conversation.endedAt).getTime() - new Date(conversation.startedAt).getTime()) / 1000)
          );
        }
      }

      const lead = db.leads.get(conversation.leadId);
      if (lead) {
        // Only a call the borrower actually engaged with advances the lead.
        // Marking a voicemail as IN_CONVERSATION would put it in front of an
        // officer as a live opportunity that never happened.
        if (isAnsweredOutcome(outcome)) {
          lead.lastContactAt = conversation.endedAt;
          try {
            lead.state = transition(lead.state, "CONTACT_ANSWERED");
          } catch (err) {
            if (!(err instanceof InvalidTransitionError)) throw err;
          }
          await pushEvent({ leadId: lead.id, type: "CONTACT_ANSWERED", actorType: "SYSTEM", occurredAt: nowIso(), channel: "VOICE", payload: { conversationId: conversation.id } });
        }
        lead.updatedAt = nowIso();

        await pushEvent({
          leadId: lead.id,
          type: "CONVERSATION_COMPLETED",
          actorType: "SYSTEM",
          occurredAt: nowIso(),
          channel: "VOICE",
          payload: { conversationId: conversation.id, outcome, endedReason: message.endedReason },
        });

        // Extraction/wrap-up is a durable outbox job. The best-effort `after`
        // kick keeps the UI quick, while the cron worker retries if this
        // instance disappears or the AI provider is temporarily unavailable.
        if (isAnsweredOutcome(outcome) && conversation.transcript.length > 0) {
          await saveDb();
          await enqueueOutbox({
            jobType: "VAPI_CALL_POST_PROCESSING",
            idempotencyKey: `vapi:${conversation.id}:post-processing`,
            aggregateType: "ConversationSession",
            aggregateId: conversation.id,
            payload: { leadId: lead.id, conversationId: conversation.id },
          });
          after(async () => { await processOutboxBatch(5); });
        }
      }
      await saveDb();
      break;
    }
  }

  // Persist lastSignalAt/provider correlation even for informational event
  // types that do not otherwise mutate a visible status.
  await saveDb();
  await settleWebhook(queued.id, "COMPLETED");
  return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vapi event processing failed";
    await settleWebhook(queued.id, "RETRY", message);
    console.error("[vapi-webhook] durable event processing failed:", message);
    return NextResponse.json({ ok: false, error: "Event processing deferred" }, { status: 503 });
  }
}
