import { NextResponse } from "next/server";
import { safeCompare } from "@/core/auth";
import { processWebhookBatch } from "@/domain/webhookProcessing";
import { processOutboxBatch } from "@/domain/outboxProcessing";
import { getConfigValue } from "@/lib/runtimeConfig";
import { processAutomatedDialingSessions } from "@/domain/dialingSessions";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const expected = await getConfigValue("CRON_SECRET");
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || !safeCompare(expected, supplied)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const [webhooks, outbox] = await Promise.all([processWebhookBatch(50), processOutboxBatch(50)]);
  const dialing = await processAutomatedDialingSessions(5);
  return NextResponse.json({ ok: true, webhooks, outbox, dialing });
}
