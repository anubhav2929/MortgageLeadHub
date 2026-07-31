// Thin Twilio SMS wrapper. This is the only file in the project allowed to
// import the Twilio SDK (SPEC.md Rule A / grep test) — callers always go
// through PolicyGate first and never touch this adapter directly from a
// route handler.

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

let twilioClient: import("twilio").Twilio | null = null;
async function getClient() {
  if (!twilioClient) {
    const { default: Twilio } = await import("twilio");
    twilioClient = Twilio(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!);
  }
  return twilioClient;
}

export async function sendSms(input: SendSmsInput): Promise<AdapterSendResult> {
  if (!capabilities.hasTwilio) {
    console.log(`[SIMULATED SMS] to=${input.to} body="${input.body}"`);
    return { providerMessageId: `sim_sms_${input.idempotencyKey}`, simulated: true };
  }

  try {
    const client = await getClient();
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
