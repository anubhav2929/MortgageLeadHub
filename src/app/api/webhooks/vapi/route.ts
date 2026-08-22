// Receives Vapi's server events for a live voice-agent call (see
// adapters/voiceAgent.ts, which sets this route as the assistant's serverUrl
// and passes a shared secret Vapi echoes back on every request). Correlates
// each event back to the ConversationSession created when the call was
// placed (startVoiceAgentCallAction, via call.metadata.conversationId), and
// on end-of-call-report runs the transcript through the exact same
// extraction/promotion pipeline the manual "Run AI extraction" button uses.

import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { pushEvent, runExtractionForConversation } from "@/domain/actions";
import { getDb, nowIso, saveDb } from "@/domain/store";
import { safeCompare } from "@/core/auth";
import { isAnsweredOutcome } from "@/core/deliveryStatus";
import { advanceCallStatus, classifyEndedReason, mapVapiCallStatus } from "@/core/vapiLifecycle";
import { transition, InvalidTransitionError } from "@/core/stateMachine";
import { getConfigValue } from "@/lib/runtimeConfig";

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
    recordingUrl?: string;
    recording?: {
      stereoUrl?: string;
      url?: string;
      combinedUrl?: string;
      mono?: { combinedUrl?: string; assistantUrl?: string; customerUrl?: string };
    };
  };
  call?: { metadata?: { leadId?: string; conversationId?: string } };
}

/**
 * True when the request genuinely came from Vapi.
 *
 * Accepts either authentication style. Both comparisons are constant-time —
 * a webhook that can suppress a borrower or inject transcript text is worth
 * protecting from a timing oracle.
 */
function isAuthenticVapiRequest(request: Request, rawBody: string, secret: string): boolean {
  const plaintext = request.headers.get("x-vapi-secret");
  if (plaintext && safeCompare(plaintext, secret)) return true;

  const signature = request.headers.get("x-vapi-signature");
  if (!signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  // Some senders prefix the algorithm; compare against the hex either way.
  const supplied = signature.includes("=") ? signature.split("=").pop()! : signature;
  return safeCompare(supplied.trim().toLowerCase(), expected);
}

export async function POST(request: Request) {
  const vapiSecret = await getConfigValue("VAPI_WEBHOOK_SECRET");

  // Read the body as text first: HMAC verification needs the exact bytes, and
  // re-serialising a parsed object would not reproduce them.
  const rawBody = await request.text();

  // ---------------------------------------------------------------------
  // Vapi authenticates in TWO different ways and we must accept both.
  //
  // Setting `server.secret` does NOT make Vapi send `x-vapi-secret`. By
  // default it sends `x-vapi-signature`, an HMAC-SHA256 of the raw body keyed
  // with that secret. Checking only for the plaintext header meant the header
  // was simply absent, so EVERY status-update and end-of-call-report was
  // rejected 401 — which is why calls placed fine and then never produced a
  // transcript or advanced past "Calling".
  //
  // We now also send the plaintext header explicitly via `server.headers`
  // (see adapters/voiceAgent.ts), so both paths work regardless of which
  // behaviour the account is on.
  // ---------------------------------------------------------------------
  if (!vapiSecret || !isAuthenticVapiRequest(request, rawBody, vapiSecret)) {
    console.error(
      vapiSecret
        ? "[vapi-webhook] rejected: neither x-vapi-secret nor a valid x-vapi-signature matched VAPI_WEBHOOK_SECRET"
        : "[vapi-webhook] rejected: VAPI_WEBHOOK_SECRET is not configured"
    );
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { message?: VapiServerMessage };
  try {
    body = JSON.parse(rawBody);
  } catch {
    // Malformed body — reply 200 rather than 500 so Vapi doesn't treat this
    // as a transient failure and retry-storm the same bad payload.
    return NextResponse.json({ ok: false, error: "Invalid JSON body" });
  }
  const message = body.message;
  const conversationId = message?.call?.metadata?.conversationId;
  if (!message || !conversationId) return NextResponse.json({ ok: true });

  const db = await getDb();
  const conversation = db.conversations.get(conversationId);
  if (!conversation) return NextResponse.json({ ok: true });

  // Any event at all proves the call is still alive. Staleness is measured
  // from this rather than from when the call started, so a genuinely long
  // conversation that keeps emitting transcript events is never reaped.
  conversation.lastSignalAt = nowIso();

  switch (message.type) {
    case "status-update": {
      // Mirror the carrier's own view onto callStatus so the board shows the
      // call progressing instead of claiming "connected" from the moment we
      // dialled. advanceCallStatus never regresses — webhook ordering is not
      // guaranteed, and a late "ringing" must not un-connect a live call.
      const next = advanceCallStatus(conversation.callStatus, mapVapiCallStatus(message.status));
      if (next !== conversation.callStatus) {
        conversation.callStatus = next;
        saveDb();
      }

      if (message.status === "in-progress" && conversation.status !== "IN_PROGRESS") {
        conversation.status = "IN_PROGRESS";
        // The call is genuinely connected now, so restart the clock here
        // rather than from when we queued it. Otherwise the live timer counts
        // ringing time as conversation time.
        conversation.startedAt = nowIso();
        saveDb();
      }

      // "ended" normally arrives just before end-of-call-report, which does the
      // real settling. Recording it here too means a call that never produces a
      // report (provider hiccup) still leaves the session closed rather than
      // stuck IN_PROGRESS forever.
      if (message.status === "ended" && conversation.status === "IN_PROGRESS") {
        conversation.endedAt = nowIso();
        saveDb();
      }
      break;
    }

    case "transcript": {
      if (message.transcriptType === "final" && message.transcript) {
        conversation.transcript.push({
          turn: conversation.transcript.length + 1,
          role: message.role === "assistant" ? "AGENT" : "BORROWER",
          text: message.transcript,
          at: nowIso(),
        });
        saveDb();
      }
      break;
    }

    case "end-of-call-report": {
      conversation.status = "COMPLETED";
      conversation.endedAt = nowIso();
      // Fallback: if per-turn "transcript" events were missed for any
      // reason, Vapi's own concatenated transcript still gets us a result.
      if (conversation.transcript.length === 0 && message.artifact?.transcript) {
        conversation.transcript.push({ turn: 1, role: "BORROWER", text: message.artifact.transcript, at: nowIso() });
      }

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
        attempt.endedAt = nowIso();
        if (verdict.failureClass !== "NONE") {
          attempt.failureClass = verdict.failureClass;
          attempt.failureMessage = verdict.detail;
        }
        const rec = message.artifact?.recording;
        const recordingUrl =
          rec?.stereoUrl ?? rec?.combinedUrl ?? rec?.url ?? rec?.mono?.combinedUrl ?? message.artifact?.recordingUrl;
        if (recordingUrl) attempt.recordingUrl = recordingUrl;
        if (conversation.startedAt) {
          attempt.durationSec = Math.max(
            0,
            Math.round((Date.now() - new Date(conversation.startedAt).getTime()) / 1000)
          );
        }
      }

      const lead = db.leads.get(conversation.leadId);
      if (lead) {
        // Only a call the borrower actually engaged with advances the lead.
        // Marking a voicemail as IN_CONVERSATION would put it in front of an
        // officer as a live opportunity that never happened.
        if (isAnsweredOutcome(outcome)) {
          lead.lastContactAt = nowIso();
          try {
            lead.state = transition(lead.state, "CONTACT_ANSWERED");
          } catch (err) {
            if (!(err instanceof InvalidTransitionError)) throw err;
          }
          await pushEvent({ leadId: lead.id, type: "CONTACT_ANSWERED", actorType: "SYSTEM", occurredAt: nowIso(), channel: "VOICE" });
        }
        lead.updatedAt = nowIso();

        await pushEvent({
          leadId: lead.id,
          type: "CONVERSATION_COMPLETED",
          actorType: "SYSTEM",
          occurredAt: nowIso(),
          channel: "VOICE",
          payload: { outcome, endedReason: message.endedReason },
        });

        // Extraction only makes sense when somebody actually said something.
        if (isAnsweredOutcome(outcome) && conversation.transcript.length > 0) {
          await runExtractionForConversation(db, lead, conversation, { actorType: "SYSTEM" });
        }
      }
      saveDb();
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
