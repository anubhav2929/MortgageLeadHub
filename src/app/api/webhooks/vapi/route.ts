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
import { env } from "@/lib/env";

interface VapiServerMessage {
  type: string;
  status?: string;
  role?: "assistant" | "user";
  transcriptType?: "partial" | "final";
  transcript?: string;
  artifact?: { transcript?: string };
  call?: { metadata?: { leadId?: string; conversationId?: string } };
}

export async function POST(request: Request) {
  if (!env.VAPI_WEBHOOK_SECRET || !safeCompare(request.headers.get("x-vapi-secret") ?? "", env.VAPI_WEBHOOK_SECRET)) {
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
      if (message.status === "in-progress" && conversation.status !== "IN_PROGRESS") {
        conversation.status = "IN_PROGRESS";
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

      const lead = db.leads.get(conversation.leadId);
      if (lead) {
        await pushEvent({ leadId: lead.id, type: "CONVERSATION_COMPLETED", actorType: "SYSTEM", occurredAt: nowIso(), channel: "VOICE" });
        if (conversation.transcript.length > 0) {
          await runExtractionForConversation(db, lead, conversation, { actorType: "SYSTEM" });
        }
      }
      saveDb();
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
