// SMS wrapper — Telnyx (preferred) or Twilio. This is the only file in the
// project allowed to import the Twilio SDK or call the Telnyx API (SPEC.md
// Rule A / grep test) — callers always go through PolicyGate first and
// never touch this adapter directly from a route handler.
//
// Telnyx is preferred when both are configured — roughly half Twilio's
// per-segment cost and native 10DLC registration (see the vendor comparison
// in DEPLOY.md). Plain REST call, no SDK: Telnyx's send-message endpoint is
// a single JSON POST, the same "skip the SDK for one endpoint" call made
// for NVIDIA NIM elsewhere in adapters/llm.ts.

import { capabilities, env } from "@/lib/env";

export interface SendSmsInput {
  to: string;
  body: string;
  idempotencyKey: string;
}

export interface AdapterSendResult {
  providerMessageId: string;
  simulated: boolean;
  error?: string;
}

async function sendViaTelnyx(input: SendSmsInput): Promise<AdapterSendResult> {
  try {
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.TELNYX_PHONE_NUMBER,
        to: input.to,
        text: input.body,
        ...(env.TELNYX_MESSAGING_PROFILE_ID ? { messaging_profile_id: env.TELNYX_MESSAGING_PROFILE_ID } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Telnyx API returned ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data?: { id?: string } };
    if (!data.data?.id) throw new Error("Telnyx response missing message id");
    return { providerMessageId: data.data.id, simulated: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown Telnyx error";
    console.error("[Telnyx SMS] send failed:", error);
    return { providerMessageId: `failed_${input.idempotencyKey}`, simulated: false, error };
  }
}

let twilioClient: import("twilio").Twilio | null = null;
async function getTwilioClient() {
  if (!twilioClient) {
    const { default: Twilio } = await import("twilio");
    twilioClient = Twilio(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!);
  }
  return twilioClient;
}

async function sendViaTwilio(input: SendSmsInput): Promise<AdapterSendResult> {
  try {
    const client = await getTwilioClient();
    const message = await client.messages.create({
      to: input.to,
      from: env.TWILIO_PHONE_NUMBER!,
      body: input.body,
    });
    return { providerMessageId: message.sid, simulated: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown Twilio error";
    console.error("[Twilio SMS] send failed:", error);
    return { providerMessageId: `failed_${input.idempotencyKey}`, simulated: false, error };
  }
}

export async function sendSms(input: SendSmsInput): Promise<AdapterSendResult> {
  if (capabilities.hasTelnyx) return sendViaTelnyx(input);
  if (capabilities.hasTwilio) return sendViaTwilio(input);
  console.log(`[SIMULATED SMS] to=${input.to} body="${input.body}"`);
  return { providerMessageId: `sim_sms_${input.idempotencyKey}`, simulated: true };
}
