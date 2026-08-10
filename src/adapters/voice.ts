// Thin Twilio Voice wrapper. Places a real outbound call reading a static,
// compliance-approved message via inline TwiML — no public webhook required,
// which keeps this safe to flip on for a same-day demo. A full conversational
// voice agent (SPEC.md F-05, Vapi) is a separate, larger lift; see
// adapters/voiceAgent.ts.
//
// Deliberately Twilio-only, unlike adapters/sms.ts: Twilio's Calls API takes
// TwiML inline in the same request that places the call. Telnyx's TeXML
// equivalent needs either a `Url` pointing at a *hosted* XML document or a
// pre-created "TeXML Bin" in their dashboard — there's no inline-content
// field, so per-call dynamic text needs a small XML-serving endpoint of our
// own first. Genuinely buildable, just a distinct piece of work from the SMS
// swap. The AI voice agent doesn't have this problem: Vapi can use either
// carrier's number interchangeably.
//
// Credentials resolve per call, so a key saved in Admin → Integrations works
// on the next call with no redeploy.

import { getConfigValue } from "@/lib/runtimeConfig";
import { classifyFailure } from "@/core/deliveryStatus";
import { adapterFailure, adapterSuccess, type AdapterResult } from "./result";

export interface PlaceCallInput {
  to: string;
  message: string;
  idempotencyKey: string;
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function placeCall(input: PlaceCallInput): Promise<AdapterResult> {
  const sid = await getConfigValue("TWILIO_ACCOUNT_SID");
  const token = await getConfigValue("TWILIO_AUTH_TOKEN");
  const from = await getConfigValue("TWILIO_PHONE_NUMBER");

  if (!sid || !token || !from) {
    console.log(`[SIMULATED CALL] to=${input.to} message="${input.message}"`);
    return adapterSuccess(`sim_call_${input.idempotencyKey}`, true);
  }

  try {
    const { default: Twilio } = await import("twilio");
    const client = Twilio(sid, token);
    const twiml = `<Response><Say voice="Polly.Joanna">${escapeXml(input.message)}</Say></Response>`;
    const call = await client.calls.create({ to: input.to, from, twiml });
    return adapterSuccess(call.sid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Twilio error";
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : undefined;
    console.error("[Twilio Voice] call failed:", message);
    return adapterFailure(classifyFailure("twilio", code, message));
  }
}
