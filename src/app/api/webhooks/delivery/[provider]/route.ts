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
import { safeCompare, verifySvixSignature } from "@/core/auth";
import { applyDeliveryUpdate, type DeliveryProvider, type DeliveryUpdate } from "@/domain/deliveryUpdates";
import { getConfigValue } from "@/lib/runtimeConfig";

const SUPPORTED: DeliveryProvider[] = ["twilio", "telnyx", "resend"];

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await params;
  const provider = raw as DeliveryProvider;
  if (!SUPPORTED.includes(provider)) {
    return NextResponse.json({ ok: false, error: "Unknown provider" }, { status: 404 });
  }

  const rawBody = await request.text();

  let update: DeliveryUpdate | null = null;

  if (provider === "twilio") {
    // Twilio signs with X-Twilio-Signature over the URL + sorted params. We
    // additionally require a shared secret in the callback URL query string,
    // which is simpler to verify and sufficient here because the URL itself
    // is only ever known to Twilio. Reject if the secret isn't configured —
    // failing open would leave the endpoint forgeable.
    const expected = await getConfigValue("DELIVERY_WEBHOOK_SECRET");
    const supplied = new URL(request.url).searchParams.get("secret");
    if (!expected || !supplied || !safeCompare(supplied, expected)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const form = new URLSearchParams(rawBody);
    const sid = form.get("MessageSid") ?? form.get("CallSid");
    const status = form.get("MessageStatus") ?? form.get("CallStatus");
    if (sid && status) {
      update = {
        providerMessageId: sid,
        status,
        errorCode: form.get("ErrorCode") ?? undefined,
        errorMessage: form.get("ErrorMessage") ?? undefined,
      };
    }
  } else if (provider === "telnyx") {
    const expected = await getConfigValue("DELIVERY_WEBHOOK_SECRET");
    const supplied = new URL(request.url).searchParams.get("secret");
    if (!expected || !supplied || !safeCompare(supplied, expected)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = JSON.parse(rawBody) as {
      data?: { payload?: { id?: string; to?: { status?: string }[]; errors?: { code?: string; detail?: string }[] } };
    };
    const payload = body.data?.payload;
    const status = payload?.to?.[0]?.status;
    if (payload?.id && status) {
      update = {
        providerMessageId: payload.id,
        status,
        errorCode: payload.errors?.[0]?.code,
        errorMessage: payload.errors?.[0]?.detail,
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
