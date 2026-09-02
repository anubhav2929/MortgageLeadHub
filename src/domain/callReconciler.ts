// Brings our record of a live call back in line with the provider's.
//
// Runs when the board is read, for calls we believe are live but have not
// heard a webhook about recently. Webhooks stay the primary path — this only
// fills the gap when they are slow, dropped, or (as happened) rejected.

import { fetchVapiCallState } from "@/adapters/vapiCallStatus";
import { advanceCallStatus, classifyEndedReason, mapVapiCallStatus } from "@/core/vapiLifecycle";
import { mapWithConcurrency } from "@/core/concurrency";
import { getDb, nowIso, saveDb } from "@/domain/store";
import { protectBearerUrl } from "@/core/secretBox";
import { getConfigValue } from "@/lib/runtimeConfig";
import { reconcileVapiTranscript } from "@/core/vapiTranscript";
import { isAnsweredOutcome } from "@/core/deliveryStatus";
import { transition, InvalidTransitionError } from "@/core/stateMachine";
import type { ConversationSession } from "@/domain/types";
import type { Database } from "@/domain/store";
import { enqueueOutbox } from "@/domain/durableQueue";

/**
 * How quiet a call must be before we ask the provider about it.
 *
 * Short enough that a viewer watching the board sees state within a few
 * seconds even with webhooks entirely broken; long enough that a healthy
 * call — which emits transcript events continuously — is never polled at all.
 */
const SILENCE_BEFORE_POLL_MS = 12_000;

/** Never hammer the provider because someone left the board open. */
const MAX_CALLS_PER_PASS = 10;

export interface ReconcileSummary {
  checked: number;
  updated: number;
  settled: number;
  /**
   * False when we tried to reach the provider and could not.
   *
   * The reaper needs this to distinguish "the call ended" from "we are blind".
   * Without it a rate-limited provider — exactly what a hundred simultaneous
   * calls produces — looks identical to a finished call, and live calls get
   * deleted.
   */
  providerReachable: boolean;
}

/** Reconcile one known Vapi conversation from the provider API. Exported so
 * the durable webhook worker can recover an event after its inline request
 * failed, instead of leaving Vapi RETRY rows unprocessable forever. */
export async function reconcileVapiConversation(
  db: Database,
  convo: ConversationSession,
  now = new Date()
): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = { checked: 0, updated: 0, settled: 0, providerReachable: true };
    const attempt = db.attempts.find((candidate) => candidate.id === convo.contactAttemptId);
    const providerCallId = convo.providerCallId ?? attempt?.providerMessageId;
    if (!providerCallId || providerCallId.startsWith("sim_")) return summary;

    summary.checked += 1;
    const result = await fetchVapiCallState(providerCallId);

    if (!result.ok && !result.gone) {
      // A transient failure means we learned nothing. Record that so the
      // reaper holds off rather than treating silence as an ending.
      summary.providerReachable = false;
    }
    if (!result.ok) {
      // Only a definitive 404 lets us close the call. A network blip or a
      // rate limit must never be read as "the call ended" — that would end a
      // live conversation on the board while the borrower is still talking.
      if (result.gone) {
        convo.status = "COMPLETED";
        convo.callStatus = "ENDED";
        convo.endedAt = convo.endedAt ?? now.toISOString();
        convo.endedReason = "provider-has-no-record";
        convo.settledBySystem = true;
        summary.settled += 1;
      }
      return summary;
    }

    const state = result.state;
    convo.providerCallId = providerCallId;
    let changed = false;

    const nextStatus = advanceCallStatus(convo.callStatus, mapVapiCallStatus(state.status));
    if (nextStatus !== convo.callStatus) {
      convo.callStatus = nextStatus;
      changed = true;
    }

    // Provider contact IS a signal, so record it — otherwise the reaper would
    // still delete a call we have just confirmed is alive.
    convo.lastSignalAt = now.toISOString();

    // Partial transcript while the call is running. Only append what is new,
    // matched on turn count rather than text, so a repeated poll cannot
    // duplicate lines already ingested by the webhook path.
    if (Array.isArray(state.messages) && state.messages.length > 0 && convo.transcriptSource !== "VAPI_ARTIFACT") {
      const reconciled = reconcileVapiTranscript({
        current: convo.transcript,
        messages: state.messages,
        startedAt: state.startedAt ?? convo.startedAt,
        at: nowIso(),
      });
      if (reconciled.turns.length !== convo.transcript.length || reconciled.turns.some((turn, index) => turn.text !== convo.transcript[index]?.text)) {
        convo.transcript = reconciled.turns;
        convo.transcriptSource = state.status === "ended" ? "VAPI_ARTIFACT" : "LIVE_EVENTS";
        convo.redactionApplied ||= reconciled.redactionApplied;
        changed = true;
      }
    }

    if (state.status === "ended") {
      const verdict = classifyEndedReason(state.endedReason);
      convo.status = "COMPLETED";
      convo.callStatus = "ENDED";
      convo.endedAt = state.endedAt ?? now.toISOString();
      convo.endedReason = state.endedReason;

      const finalTranscript = reconcileVapiTranscript({
        current: convo.transcript,
        messages: state.messages,
        transcript: state.transcript,
        startedAt: state.startedAt ?? convo.startedAt,
        at: convo.endedAt,
      });
      if (finalTranscript.authoritative) {
        convo.transcript = finalTranscript.turns;
        convo.transcriptSource = "VAPI_ARTIFACT";
        convo.redactionApplied ||= finalTranscript.redactionApplied;
      }
      convo.recordingAvailable = state.recordingAvailable;
      convo.callLogAvailable = state.callLogAvailable;

      // Settle the attempt too, or the call log keeps showing QUEUED for a
      // call the provider finished minutes ago.
      if (attempt && (attempt.outcome === "QUEUED" || attempt.outcome === "SENT")) {
        attempt.outcome = verdict.outcome;
        attempt.endedAt = convo.endedAt;
        attempt.transcriptId = convo.transcript.length > 0 ? convo.id : undefined;
        if (verdict.failureClass !== "NONE") {
          attempt.failureClass = verdict.failureClass;
          attempt.failureMessage = verdict.detail;
        }
        if (state.recordingUrl && (await getConfigValue("RETAIN_RECORDING_URLS")) === "true") attempt.recordingUrl = protectBearerUrl(state.recordingUrl);
        if (convo.startedAt) {
          attempt.durationSec = Math.max(
            0,
            Math.round((Date.parse(convo.endedAt) - Date.parse(convo.startedAt)) / 1000)
          );
        }
      }

      // Poll recovery must produce the same lead-level truth as the webhook
      // path. Otherwise a recovered transcript appears in the call centre but
      // the lead remains NEW and its timeline claims nobody answered.
      const lead = db.leads.get(convo.leadId);
      if (lead) {
        if (isAnsweredOutcome(verdict.outcome)) {
          lead.lastContactAt = convo.endedAt;
          try {
            lead.state = transition(lead.state, "CONTACT_ANSWERED");
          } catch (error) {
            if (!(error instanceof InvalidTransitionError)) throw error;
          }
          if (!db.events.some((event) => event.leadId === lead.id && event.type === "CONTACT_ANSWERED" && event.payload?.conversationId === convo.id)) {
            db.events.push({
              id: `evt_vapi_answered_${convo.id}`, leadId: lead.id, type: "CONTACT_ANSWERED", actorType: "SYSTEM", channel: "VOICE",
              occurredAt: convo.endedAt, recordedAt: nowIso(), correlationId: `corr_vapi_${convo.id}`, payload: { conversationId: convo.id, recovered: true },
            });
          }
        }
        lead.updatedAt = nowIso();
        if (!db.events.some((event) => event.leadId === lead.id && event.type === "CONVERSATION_COMPLETED" && event.payload?.conversationId === convo.id)) {
          db.events.push({
            id: `evt_vapi_completed_${convo.id}`, leadId: lead.id, type: "CONVERSATION_COMPLETED", actorType: "SYSTEM", channel: "VOICE",
            occurredAt: convo.endedAt, recordedAt: nowIso(), correlationId: `corr_vapi_${convo.id}`, payload: { conversationId: convo.id, outcome: verdict.outcome, endedReason: state.endedReason, recovered: true },
          });
        }
      }
      if (isAnsweredOutcome(verdict.outcome) && convo.transcript.length > 0) {
        await enqueueOutbox({
          jobType: "VAPI_CALL_POST_PROCESSING",
          idempotencyKey: `vapi:${convo.id}:post-processing`,
          aggregateType: "ConversationSession",
          aggregateId: convo.id,
          payload: { leadId: convo.leadId, conversationId: convo.id },
        });
      }
      summary.settled += 1;
      changed = true;
    }

    if (changed) summary.updated += 1;
    return summary;
}

export async function reconcileLiveCalls(now = new Date()): Promise<ReconcileSummary> {
  const db = await getDb();
  const summary: ReconcileSummary = { checked: 0, updated: 0, settled: 0, providerReachable: true };

  const candidates = Array.from(db.conversations.values())
    // A status-update can report `ended` before Vapi's final artifact arrives.
    // Keep that conversation eligible for pull recovery; otherwise a missing
    // end-of-call-report leaves it permanently IN_PROGRESS with no transcript.
    .filter((c) => c.status === "IN_PROGRESS")
    .filter((c) => {
      const last = Date.parse(c.lastSignalAt ?? c.startedAt);
      // An unreadable timestamp is exactly the case worth checking.
      return !Number.isFinite(last) || now.getTime() - last > SILENCE_BEFORE_POLL_MS;
    })
    .slice(0, MAX_CALLS_PER_PASS);

  if (candidates.length === 0) return summary;

  const results = await mapWithConcurrency(candidates, 4, (conversation) => reconcileVapiConversation(db, conversation, now));
  for (const result of results) {
    summary.checked += result.checked;
    summary.updated += result.updated;
    summary.settled += result.settled;
    summary.providerReachable &&= result.providerReachable;
  }

  if (summary.updated > 0 || summary.settled > 0) await saveDb();
  return summary;
}
