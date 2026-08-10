// SMS wrapper — Telnyx (preferred) or Twilio. This is the only file in the
// project allowed to import the Twilio SDK or call the Telnyx API (SPEC.md
// Rule A / grep test) — callers always go through PolicyGate first and never
// touch this adapter directly from a route handler.
//
// Telnyx is preferred when both are configured: roughly half Twilio's
// per-segment cost and native 10DLC registration (see DEPLOY.md). Plain REST,
// no SDK — Telnyx's send-message endpoint is a single JSON POST.
//
// Credentials resolve per call via lib/runtimeConfig, so a key saved in
// Admin → Integrations takes effect on the very next send with no redeploy.

import { getAppUrl, getConfigValue } from "@/lib/runtimeConfig";
import { classifyFailure } from "@/core/deliveryStatus";
import { adapterFailure, adapterSuccess, type AdapterResult } from "./result";

export interface SendSmsInput {
  to: string;
  body: string;
  idempotencyKey: string;
}

/** Where the carrier should report delivery. Returns null when the shared
 *  secret isn't set, in which case we simply don't ask for callbacks rather
 *  than exposing an unauthenticated endpoint. */
async function deliveryCallbackUrl(provider: "twilio" | "telnyx"): Promise<string | null> {
  const secret = await getConfigValue("DELIVERY_WEBHOOK_SECRET");
  if (!secret) return null;
  return `${await getAppUrl()}/api/webhooks/delivery/${provider}?secret=${encodeURIComponent(secret)}`;
}

/** Twilio and Telnyx both surface an error code the caller needs in order to
 *  tell "this number is a landline" from "our account is suspended". */
function errorCodeOf(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "number" || typeof code === "string") return String(code);
  }
  return undefined;
}

async function sendViaTelnyx(input: SendSmsInput, apiKey: string, from: string): Promise<AdapterResult> {
  try {
    const profileId = await getConfigValue("TELNYX_MESSAGING_PROFILE_ID");
    const statusCallback = await deliveryCallbackUrl("telnyx");
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: input.to,
        text: input.body,
        ...(profileId ? { messaging_profile_id: profileId } : {}),
        // Delivery is reported asynchronously; without this callback the
        // attempt would stay SENT forever regardless of what the carrier did.
        ...(statusCallback ? { webhook_url: statusCallback } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Telnyx API returned ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data?: { id?: string } };
    if (!data.data?.id) throw new Error("Telnyx response missing message id");
    return adapterSuccess(data.data.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Telnyx error";
    console.error("[Telnyx SMS] send failed:", message);
    return adapterFailure(classifyFailure("telnyx", errorCodeOf(err), message));
  }
}

async function sendViaTwilio(input: SendSmsInput, sid: string, token: string, from: string): Promise<AdapterResult> {
  try {
    const { default: Twilio } = await import("twilio");
    const client = Twilio(sid, token);
    const statusCallback = await deliveryCallbackUrl("twilio");
    const message = await client.messages.create({
      to: input.to,
      from,
      body: input.body,
      ...(statusCallback ? { statusCallback } : {}),
    });
    return adapterSuccess(message.sid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Twilio error";
    console.error("[Twilio SMS] send failed:", message);
    return adapterFailure(classifyFailure("twilio", errorCodeOf(err), message));
  }
}

export async function sendSms(input: SendSmsInput): Promise<AdapterResult> {
  const telnyxKey = await getConfigValue("TELNYX_API_KEY");
  const telnyxFrom = await getConfigValue("TELNYX_PHONE_NUMBER");
  if (telnyxKey && telnyxFrom) return sendViaTelnyx(input, telnyxKey, telnyxFrom);

  const sid = await getConfigValue("TWILIO_ACCOUNT_SID");
  const token = await getConfigValue("TWILIO_AUTH_TOKEN");
  const twilioFrom = await getConfigValue("TWILIO_PHONE_NUMBER");
  if (sid && token && twilioFrom) return sendViaTwilio(input, sid, token, twilioFrom);

  console.log(`[SIMULATED SMS] to=${input.to} body="${input.body}"`);
  return adapterSuccess(`sim_sms_${input.idempotencyKey}`, true);
}
