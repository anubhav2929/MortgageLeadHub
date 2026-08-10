// Thin Twilio Voice wrapper. Places a real outbound call reading a static,
// compliance-approved message via inline TwiML — no public webhook required,
// which keeps this safe to flip on for a same-day demo. A full conversational
// voice agent (SPEC.md F-05, Vapi/Retell) is a separate, larger lift; see
// adapters/voiceAgent.ts.
//
// Deliberately Twilio-only, unlike adapters/sms.ts: Twilio's Calls API takes
// TwiML inline in the same request that places the call. Telnyx's TeXML
// equivalent needs either a `Url` pointing at a *hosted* XML document or a
// pre-created "TeXML Bin" in their dashboard — there's no inline-content
// field, so per-call dynamic text needs a small XML-serving endpoint of our
// own first. Genuinely buildable (and Telnyx is still the better economics
// here, same as SMS), just a distinct, slightly larger piece of work than
// the SMS swap — worth doing as a fast follow-up rather than shipping
// untested on a delivery deadline. The AI voice agent (Vapi, above) doesn't
// have this problem: Vapi can use either carrier's number interchangeably.

import { capabilities, env } from "@/lib/env";

export interface PlaceCallInput {
  to: string;
  message: string;
  idempotencyKey: string;
}

export interface AdapterSendResult {
  providerMessageId: string;
  simulated: boolean;
  error?: string;
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let twilioClient: import("twilio").Twilio | null = null;
async function getClient() {
  if (!twilioClient) {
    const { default: Twilio } = await import("twilio");
    twilioClient = Twilio(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!);
  }
  return twilioClient;
}

export async function placeCall(input: PlaceCallInput): Promise<AdapterSendResult> {
  if (!capabilities.hasTwilio) {
    console.log(`[SIMULATED CALL] to=${input.to} message="${input.message}"`);
    return { providerMessageId: `sim_call_${input.idempotencyKey}`, simulated: true };
  }

  try {
    const client = await getClient();
    const twiml = `<Response><Say voice="Polly.Joanna">${escapeXml(input.message)}</Say></Response>`;
    const call = await client.calls.create({
      to: input.to,
      from: env.TWILIO_PHONE_NUMBER!,
      twiml,
    });
    return { providerMessageId: call.sid, simulated: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown Twilio error";
    console.error("[Twilio Voice] call failed:", error);
    return { providerMessageId: `failed_${input.idempotencyKey}`, simulated: false, error };
  }
}
