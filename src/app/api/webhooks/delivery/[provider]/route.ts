// Provider delivery-status callbacks — the other half of every outbound send.
//
// Twilio, Telnyx, and Resend all report the *outcome* of a message
// asynchronously, minutes after the API call that created it returned 201.
// That callback is the only source of truth for whether a borrower actually
// received anything. Without this route the CRM records "SENT" and never
// learns otherwise.
//
// Setup (see docs/INTEGRATION-BEHAVIOR.md):
//   Twilio  — set StatusCallback on the messaging service / number to
//             {APP_URL}/api/webhooks/delivery/twilio
//   Telnyx  — set the messaging profile's webhook URL to
//             {APP_URL}/api/webhooks/delivery/telnyx
//   Resend  — add a webhook for email.sent / email.delivered / email.bounced
//             pointing at {APP_URL}/api/webhooks/delivery/resend
//
// Authentication differs per provider and is enforced per branch below. An
// unauthenticated caller must never be able to mark a lead's message
// delivered — that would let anyone forge a contact history.

import { NextResponse } from "next/server";
import { verifySvixSignature } from "@/core/auth";
import { applyDeliveryUpdate, type DeliveryProvider, type DeliveryUpdate } from "@/domain/deliveryUpdates";
import { getAppUrl, getConfigValue } from "@/lib/runtimeConfig";
import { formParams, verifyTwilioWebhook } from "@/adapters/twilioWebhookAuth";

const SUPPORTED: DeliveryProvider[] = ["twilio", "telnyx", "resend"];

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await params;
  const provider = raw as DeliveryProvider;
  if (!SUPPORTED.includes(provider)) {
    return NextResponse.json({ ok: false, error: "Unknown provider" }, { status: 404 });
  }
  if (provider === "telnyx") {
    return NextResponse.json({ ok: false, error: "Retired. Configure the signed /api/webhooks/telnyx primary or failover endpoint." }, { status: 410 });
  }

  const rawBody = await request.text();

  let update: DeliveryUpdate | null = null;

  if (provider === "twilio") {
    const requestUrl = new URL(request.url);
    const publicUrl = `${await getAppUrl()}${requestUrl.pathname}${requestUrl.search}`;
    const authToken = await getConfigValue("TWILIO_AUTH_TOKEN");
    if (!authToken || !verifyTwilioWebhook({ authToken, signature: request.headers.get("x-twilio-signature"), publicUrl, rawBody })) {
      return NextResponse.json({ ok: false, error: "Invalid Twilio signature" }, { status: 401 });
    }
    const form = formParams(rawBody);
    const sid = form.MessageSid ?? form.CallSid;
    const status = form.MessageStatus ?? form.CallStatus;
    if (sid && status) {
      update = {
        providerMessageId: sid,
        status,
        errorCode: form.ErrorCode,
        errorMessage: form.ErrorMessage,
      };
    }
  } else {
    // Resend signs with Svix, same as the inbound-email webhook.
    const secret = await getConfigValue("RESEND_WEBHOOK_SECRET");
    if (!secret) {
      return NextResponse.json({ ok: false, error: "Delivery webhook is not configured" }, { status: 401 });
    }
    const verified = verifySvixSignature(
      secret,
      {
        id: request.headers.get("svix-id"),
        timestamp: request.headers.get("svix-timestamp"),
        signature: request.headers.get("svix-signature"),
      },
      rawBody
    );
    if (!verified) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }
    const body = JSON.parse(rawBody) as { type?: string; data?: { email_id?: string; bounce?: { message?: string } } };
    if (body.type && body.data?.email_id) {
      update = {
        providerMessageId: body.data.email_id,
        status: body.type,
        errorMessage: body.data.bounce?.message,
      };
    }
  }

  if (!update) {
    // Acknowledge with 200 so the provider doesn't retry a payload we will
    // never be able to parse — a retry storm helps nobody.
    return NextResponse.json({ ok: true, ignored: "unparseable payload" });
  }

  const result = await applyDeliveryUpdate(provider, update);
  return NextResponse.json({ ok: true, ...result });
}
