import { after, NextResponse } from "next/server";
import { verifyTelnyxWebhook } from "@/core/telnyxWebhookAuth";
import { enqueueWebhook, stableWebhookId } from "@/domain/durableQueue";
import { processWebhookBatch } from "@/domain/webhookProcessing";
import { getConfigValue } from "@/lib/runtimeConfig";
import { processOutboxBatch } from "@/domain/outboxProcessing";

export async function ingestTelnyxRequest(request: Request, source: "primary" | "failover") {
  const rawBody = await request.text();
  const publicKey = await getConfigValue("TELNYX_PUBLIC_KEY");
  if (!publicKey) {
    return NextResponse.json({ ok: false, error: "Telnyx webhook signing is not configured" }, { status: 503 });
  }

  const verified = verifyTelnyxWebhook({
    rawBody,
    publicKey,
    signature: request.headers.get("telnyx-signature-ed25519"),
    timestamp: request.headers.get("telnyx-timestamp"),
  });
  if (!verified.ok) return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });

  let payload: { data?: { id?: string; event_type?: string } };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const providerEventId = stableWebhookId("TELNYX", rawBody, payload.data?.id);
  const queued = await enqueueWebhook({
    provider: "TELNYX",
    providerEventId,
    eventType: payload.data?.event_type ?? "unknown",
    source,
    payload,
    headers: { "telnyx-timestamp": request.headers.get("telnyx-timestamp") ?? "" },
  });

  if (!queued.duplicate) after(async () => {
    await processWebhookBatch(10);
    // Ordinary inbound texts enqueue their AI response while the inbox batch
    // runs. Kick the outbox in the same background lifetime for a fast reply;
    // cron remains the durable recovery path if this instance disappears.
    await processOutboxBatch(10);
  });
  return NextResponse.json({ ok: true, duplicate: queued.duplicate }, { status: 200 });
}
