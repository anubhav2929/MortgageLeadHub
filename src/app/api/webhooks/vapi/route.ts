// Receives Vapi's server events for a live voice-agent call (see
// adapters/voiceAgent.ts, which sets this route as the assistant's serverUrl
// and passes a shared secret Vapi echoes back on every request). Correlates
// each event back to the ConversationSession created when the call was
// placed (startVoiceAgentCallAction, via call.metadata.conversationId), and
// on end-of-call-report runs the transcript through the exact same
// extraction/promotion pipeline the manual "Run AI extraction" button uses.

import { NextResponse } from "next/server";
import { pushEvent, runExtractionForConversation } from "@/domain/actions";
import { getDb, nowIso, saveDb } from "@/domain/store";
import { safeCompare } from "@/core/auth";
import { isAnsweredOutcome, mapVapiEndedReason } from "@/core/deliveryStatus";
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

export async function POST(request: Request) {
  const vapiSecret = await getConfigValue("VAPI_WEBHOOK_SECRET");
  if (!vapiSecret || !safeCompare(request.headers.get("x-vapi-secret") ?? "", vapiSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { message?: VapiServerMessage };
  try {
    body = await request.json();
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

  switch (message.type) {
    case "status-update": {
      // Vapi emits scheduled | queued | ringing | in-progress | forwarding | ended.
      if (message.status === "in-progress" && conversation.status !== "IN_PROGRESS") {
        conversation.status = "IN_PROGRESS";
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
      const outcome = mapVapiEndedReason(message.endedReason);
      const attempt = db.attempts.find((a) => a.id === conversation.contactAttemptId);
      if (attempt) {
        attempt.outcome = outcome;
        attempt.endedAt = nowIso();
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
