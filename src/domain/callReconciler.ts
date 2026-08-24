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

export async function reconcileLiveCalls(now = new Date()): Promise<ReconcileSummary> {
  const db = await getDb();
  const summary: ReconcileSummary = { checked: 0, updated: 0, settled: 0, providerReachable: true };

  const candidates = Array.from(db.conversations.values())
    .filter((c) => c.status === "IN_PROGRESS" && c.callStatus !== "ENDED")
    .filter((c) => {
      const last = Date.parse(c.lastSignalAt ?? c.startedAt);
      // An unreadable timestamp is exactly the case worth checking.
      return !Number.isFinite(last) || now.getTime() - last > SILENCE_BEFORE_POLL_MS;
    })
    .slice(0, MAX_CALLS_PER_PASS);

  if (candidates.length === 0) return summary;

  await mapWithConcurrency(candidates, 4, async (convo) => {
    const attempt = db.attempts.find((a) => a.id === convo.contactAttemptId);
    const providerCallId = attempt?.providerMessageId;
    if (!providerCallId || providerCallId.startsWith("sim_")) return null;

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
      return null;
    }

    const state = result.state;
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
    if (Array.isArray(state.messages) && state.messages.length > convo.transcript.length) {
      for (const m of state.messages.slice(convo.transcript.length)) {
        const text = (m.message ?? "").trim();
        if (!text) continue;
        convo.transcript.push({
          turn: convo.transcript.length + 1,
          role: m.role === "assistant" || m.role === "bot" ? "AGENT" : "BORROWER",
          text,
          at: nowIso(),
        });
      }
      changed = true;
    }

    if (state.status === "ended") {
      const verdict = classifyEndedReason(state.endedReason);
      convo.status = "COMPLETED";
      convo.callStatus = "ENDED";
      convo.endedAt = state.endedAt ?? now.toISOString();
      convo.endedReason = state.endedReason;

      if (convo.transcript.length === 0 && state.transcript) {
        convo.transcript.push({ turn: 1, role: "BORROWER", text: state.transcript, at: nowIso() });
      }

      // Settle the attempt too, or the call log keeps showing QUEUED for a
      // call the provider finished minutes ago.
      if (attempt && (attempt.outcome === "QUEUED" || attempt.outcome === "SENT")) {
        attempt.outcome = verdict.outcome;
        attempt.endedAt = convo.endedAt;
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
      summary.settled += 1;
      changed = true;
    }

    if (changed) summary.updated += 1;
    return null;
  });

  if (summary.updated > 0 || summary.settled > 0) await saveDb();
  return summary;
}
