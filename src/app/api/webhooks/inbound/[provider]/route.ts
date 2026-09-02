// Inbound SMS from the carrier — borrower replies, and STOP/START/HELP.
//
// Without this route the platform makes a promise it cannot keep: the SMS
// consent text says "Reply STOP to opt out at any time" and the FAQ says it
// works across every channel, but a STOP reply never reached us. The carrier
// blocked SMS at its own level while our cadence kept calling and emailing.
//
// Setup (see docs/INTEGRATION-BEHAVIOR.md):
//   Telnyx — messaging profile → inbound webhook URL →
//            {APP_URL}/api/webhooks/telnyx
//   Twilio — phone number → "A message comes in" →
//            {APP_URL}/api/webhooks/inbound/twilio

import { after, NextResponse } from "next/server";
import { ingestInboundSms } from "@/domain/inboundSms";
import { getAppUrl, getConfigValue } from "@/lib/runtimeConfig";
import { applyDeliveryUpdate } from "@/domain/deliveryUpdates";
import { formParams, verifyTwilioWebhook } from "@/adapters/twilioWebhookAuth";
import { processOutboxBatch } from "@/domain/outboxProcessing";

const SUPPORTED = ["twilio", "telnyx"] as const;
type Provider = (typeof SUPPORTED)[number];

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await params;
  if (!SUPPORTED.includes(raw as Provider)) {
    return NextResponse.json({ ok: false, error: "Unknown provider" }, { status: 404 });
  }
  const provider = raw as Provider;
  if (provider === "telnyx") {
    return NextResponse.json({ ok: false, error: "Retired. Configure the signed /api/webhooks/telnyx primary or failover endpoint." }, { status: 410 });
  }

  const rawBody = await request.text();
  const requestUrl = new URL(request.url);
  const appUrl = await getAppUrl();
  const publicUrl = `${appUrl}${requestUrl.pathname}${requestUrl.search}`;
  const authToken = await getConfigValue("TWILIO_AUTH_TOKEN");
  if (!authToken || !verifyTwilioWebhook({ authToken, signature: request.headers.get("x-twilio-signature"), publicUrl, rawBody })) {
    return NextResponse.json({ ok: false, error: "Invalid Twilio signature" }, { status: 401 });
  }
  let from: string | null = null;
  let body: string | null = null;
  let providerMessageId: string | undefined;

  try {
    if (provider === "twilio") {
      // Twilio posts form-encoded.
      const form = formParams(rawBody);
      from = form.From ?? null;
      body = form.Body ?? null;
      providerMessageId = form.MessageSid;
    } else {
      const parsed = JSON.parse(rawBody) as {
        data?: {
          payload?: {
            from?: { phone_number?: string };
            text?: string;
            id?: string;
            direction?: string;
            to?: { status?: string }[];
            errors?: { code?: string; detail?: string }[];
          };
        };
      };
      const payload = parsed.data?.payload;

      // Telnyx allows exactly ONE webhook URL per messaging profile, and it
      // receives inbound messages AND delivery receipts on that same URL.
      // Handling only inbound here would silently discard every receipt, so
      // an operator would configure the one URL Telnyx offers and quietly
      // lose delivery tracking — every text stuck on "sent" forever.
      //
      // So dispatch instead of reject: outbound events are delivery receipts
      // and go to the same code the dedicated delivery route uses.
      if (payload?.direction && payload.direction !== "inbound") {
        const status = payload.to?.[0]?.status;
        if (payload.id && status) {
          const result = await applyDeliveryUpdate("telnyx", {
            providerMessageId: payload.id,
            status,
            errorCode: payload.errors?.[0]?.code,
            errorMessage: payload.errors?.[0]?.detail,
          });
          return NextResponse.json({ ok: true, deliveryUpdate: true, ...result });
        }
        return NextResponse.json({ ok: true, ignored: "outbound event with no status" });
      }
      from = payload?.from?.phone_number ?? null;
      body = payload?.text ?? null;
      providerMessageId = payload?.id;
    }
  } catch {
    // Acknowledge so the carrier doesn't retry a payload we can never parse.
    return NextResponse.json({ ok: true, ignored: "unparseable payload" });
  }

  if (!from || !body) {
    return NextResponse.json({ ok: true, ignored: "missing from/body" });
  }

  const result = await ingestInboundSms({ from, body, providerMessageId });
  if (result.handled && result.intent === "MESSAGE") after(async () => { await processOutboxBatch(10); });

  // Always 200 to the carrier. A non-2xx triggers retries, and for an opt-out
  // the suppression has already been written — replaying it helps nobody.
  return NextResponse.json({ ok: true, ...result });
}
