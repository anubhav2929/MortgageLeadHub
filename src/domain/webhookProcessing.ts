import { applyDeliveryUpdate } from "@/domain/deliveryUpdates";
import { claimWebhookBatch, settleWebhook, type WebhookEnvelope } from "@/domain/durableQueue";
import { ingestInboundSms } from "@/domain/inboundSms";
import { reconcileVapiConversation } from "@/domain/callReconciler";
import { refreshDb, saveDb } from "@/domain/store";

interface TelnyxPayload {
  data?: {
    event_type?: string;
    payload?: {
      id?: string;
      direction?: string;
      text?: string;
      autoresponse_type?: string;
      from?: { phone_number?: string };
      to?: { status?: string }[];
      errors?: { code?: string; detail?: string }[];
    };
  };
}

async function processTelnyx(envelope: WebhookEnvelope): Promise<void> {
  const body = envelope.payload as TelnyxPayload;
  const payload = body.data?.payload;
  if (!payload) throw new Error("Telnyx payload is missing data.payload");

  if (payload.direction === "inbound" || body.data?.event_type === "message.received") {
    if (!payload.from?.phone_number || !payload.text) throw new Error("Inbound Telnyx event is missing from/text");
    await ingestInboundSms({
      from: payload.from.phone_number,
      body: payload.text,
      providerMessageId: payload.id ?? envelope.providerEventId,
      providerManagedResponse: /^(STOP|START|HELP)$/i.test(payload.autoresponse_type ?? ""),
    });
    return;
  }

  const status = payload.to?.[0]?.status;
  if (payload.id && status) {
    await applyDeliveryUpdate("telnyx", {
      providerMessageId: payload.id,
      status,
      errorCode: payload.errors?.[0]?.code,
      errorMessage: payload.errors?.[0]?.detail,
    });
    return;
  }

  throw new Error(`Unsupported Telnyx event: ${body.data?.event_type ?? "unknown"}`);
}

interface VapiPayload {
  message?: {
    type?: string;
    call?: { id?: string; metadata?: { conversationId?: string } };
  };
}

/** Durable recovery for informational Vapi events. The provider API is the
 * authoritative fallback: if inline webhook handling failed, retrieve the
 * complete current call state and apply it to the already-correlated CRM
 * conversation. Tool calls are intentionally excluded from the background
 * queue because Vapi requires their result synchronously. */
async function processVapi(envelope: WebhookEnvelope): Promise<void> {
  const body = envelope.payload as VapiPayload;
  const message = body.message;
  if (!message?.call?.id) throw new Error("Vapi payload is missing message.call.id");
  if (message.type === "tool-calls") throw new Error("Vapi tool calls require synchronous processing");

  const db = await refreshDb({ force: true });
  const conversationId = message.call.metadata?.conversationId;
  const conversation = (conversationId ? db.conversations.get(conversationId) : undefined)
    ?? Array.from(db.conversations.values()).find((candidate) => candidate.providerCallId === message.call?.id)
    ?? Array.from(db.conversations.values()).find((candidate) =>
      db.attempts.find((attempt) => attempt.id === candidate.contactAttemptId)?.providerMessageId === message.call?.id
    );
  if (!conversation) throw new Error(`Unknown Vapi call ${message.call.id}`);

  conversation.providerCallId = message.call.id;
  const attempt = db.attempts.find((candidate) => candidate.id === conversation.contactAttemptId);
  if (attempt && !attempt.providerMessageId) attempt.providerMessageId = message.call.id;
  const result = await reconcileVapiConversation(db, conversation);
  if (!result.providerReachable) throw new Error("Vapi call state is temporarily unavailable");
  await saveDb();
}

export async function processWebhookEnvelope(envelope: WebhookEnvelope): Promise<void> {
  if (envelope.provider === "TELNYX") return processTelnyx(envelope);
  if (envelope.provider === "VAPI") return processVapi(envelope);
  throw new Error(`No processor registered for ${envelope.provider}`);
}

export async function processWebhookBatch(limit = 20): Promise<{ claimed: number; completed: number; quarantined: number; retried: number }> {
  const claimed = await claimWebhookBatch(limit);
  let completed = 0;
  let quarantined = 0;
  let retried = 0;

  for (const envelope of claimed) {
    try {
      await processWebhookEnvelope(envelope);
      await settleWebhook(envelope.id, "COMPLETED");
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown webhook processing error";
      const permanent = /missing|unsupported|invalid/i.test(message);
      await settleWebhook(envelope.id, permanent ? "QUARANTINED" : "RETRY", message);
      if (permanent) quarantined += 1;
      else retried += 1;
    }
  }
  return { claimed: claimed.length, completed, quarantined, retried };
}
