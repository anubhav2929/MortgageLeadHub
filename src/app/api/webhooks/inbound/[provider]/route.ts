// Inbound SMS from the carrier — borrower replies, and STOP/START/HELP.
//
// Without this route the platform makes a promise it cannot keep: the SMS
// consent text says "Reply STOP to opt out at any time" and the FAQ says it
// works across every channel, but a STOP reply never reached us. The carrier
// blocked SMS at its own level while our cadence kept calling and emailing.
//
// Setup (see docs/INTEGRATION-BEHAVIOR.md):
//   Telnyx — messaging profile → inbound webhook URL →
//            {APP_URL}/api/webhooks/inbound/telnyx?secret=...
//   Twilio — phone number → "A message comes in" →
//            {APP_URL}/api/webhooks/inbound/twilio?secret=...

import { NextResponse } from "next/server";
import { safeCompare } from "@/core/auth";
import { ingestInboundSms } from "@/domain/inboundSms";
import { getConfigValue } from "@/lib/runtimeConfig";
import { applyDeliveryUpdate } from "@/domain/deliveryUpdates";

const SUPPORTED = ["twilio", "telnyx"] as const;
type Provider = (typeof SUPPORTED)[number];

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await params;
  if (!SUPPORTED.includes(raw as Provider)) {
    return NextResponse.json({ ok: false, error: "Unknown provider" }, { status: 404 });
  }
  const provider = raw as Provider;

  // Authenticate before doing anything. An unauthenticated caller here could
  // forge an opt-out for an arbitrary number (denial of service against a real
  // borrower) or, worse, forge a START to resurrect a suppressed one.
  const expected = await getConfigValue("DELIVERY_WEBHOOK_SECRET");
  const supplied = new URL(request.url).searchParams.get("secret");
  if (!expected || !supplied || !safeCompare(supplied, expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await request.text();
  let from: string | null = null;
  let body: string | null = null;
  let providerMessageId: string | undefined;

  try {
    if (provider === "twilio") {
      // Twilio posts form-encoded.
      const form = new URLSearchParams(rawBody);
      from = form.get("From");
      body = form.get("Body");
      providerMessageId = form.get("MessageSid") ?? undefined;
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

  // Always 200 to the carrier. A non-2xx triggers retries, and for an opt-out
  // the suppression has already been written — replaying it helps nobody.
  return NextResponse.json({ ok: true, ...result });
}
