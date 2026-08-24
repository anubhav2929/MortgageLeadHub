import { applyDeliveryUpdate } from "@/domain/deliveryUpdates";
import { claimWebhookBatch, settleWebhook, type WebhookEnvelope } from "@/domain/durableQueue";
import { ingestInboundSms } from "@/domain/inboundSms";

interface TelnyxPayload {
  data?: {
    event_type?: string;
    payload?: {
      id?: string;
      direction?: string;
      text?: string;
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

export async function processWebhookEnvelope(envelope: WebhookEnvelope): Promise<void> {
  if (envelope.provider === "TELNYX") return processTelnyx(envelope);
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
