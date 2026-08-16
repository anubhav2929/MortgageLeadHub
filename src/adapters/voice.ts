// Outbound announcement calls — Telnyx or Twilio. Places a real call reading a
// static, compliance-approved message. A full conversational voice agent
// (SPEC.md F-05, Vapi) is separate; see adapters/voiceAgent.ts.
//
// This file is the only place allowed to talk to a voice carrier.
//
// ---------------------------------------------------------------------------
// The two carriers need genuinely different shapes
// ---------------------------------------------------------------------------
// Twilio's Calls API takes TwiML inline in the same request that places the
// call — one round trip, no public endpoint required.
//
// Telnyx TeXML has no inline-content field. It takes a `Url` that Telnyx
// fetches when the call connects, so the script has to be stored somewhere the
// carrier can read a moment later, on a possibly different serverless
// instance. That is what db.voiceAnnouncements and the /api/texml/announcement
// route exist for. It also needs two identifiers beyond the SMS credentials: a
// TeXML Application and the account id.
//
// Preference order is Twilio-first here, which is the opposite of
// adapters/sms.ts. Telnyx is cheaper and preferred for SMS, but for voice it
// needs strictly more setup, so a deployment with both configured should use
// the path that is already known to work rather than the one that depends on a
// dashboard field somebody may not have filled in. Telnyx is used when it is
// *fully* configured.
//
// Credentials resolve per call, so a key saved in Admin → Integrations works
// on the next call with no redeploy.

import { nanoid } from "nanoid";
import { getAppUrl, getConfigValue } from "@/lib/runtimeConfig";
import { classifyFailure } from "@/core/deliveryStatus";
import { getDb, saveDb } from "@/domain/store";
import { adapterFailure, adapterSuccess, type AdapterResult } from "./result";

export interface PlaceCallInput {
  to: string;
  message: string;
  idempotencyKey: string;
}

/** Long enough to survive a queued call, short enough that an unused
 *  announcement stops being a live credential. */
const ANNOUNCEMENT_TTL_MS = 15 * 60_000;

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function statusCallbackUrl(provider: "twilio" | "telnyx"): Promise<string | undefined> {
  const secret = await getConfigValue("DELIVERY_WEBHOOK_SECRET");
  if (!secret) return undefined;
  return `${await getAppUrl()}/api/webhooks/delivery/${provider}?secret=${encodeURIComponent(secret)}`;
}

/**
 * Stores the script and returns the URL Telnyx should fetch. Purges expired
 * rows on the way through — this collection is written on every call and read
 * once, so without a sweep it grows forever.
 */
async function createAnnouncementUrl(text: string): Promise<string | null> {
  const secret = await getConfigValue("DELIVERY_WEBHOOK_SECRET");
  if (!secret) return null;

  const db = await getDb();
  const now = Date.now();
  for (const [key, a] of db.voiceAnnouncements) {
    if (new Date(a.expiresAt).getTime() < now) db.voiceAnnouncements.delete(key);
  }

  const id = nanoid(24);
  db.voiceAnnouncements.set(id, {
    id,
    text,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ANNOUNCEMENT_TTL_MS).toISOString(),
  });
  saveDb();

  return `${await getAppUrl()}/api/texml/announcement/${id}?secret=${encodeURIComponent(secret)}`;
}

async function placeViaTelnyx(
  input: PlaceCallInput,
  cfg: { apiKey: string; from: string; accountSid: string; appId: string }
): Promise<AdapterResult> {
  try {
    const url = await createAnnouncementUrl(input.message);
    if (!url) {
      // Without the shared secret the TeXML route cannot authenticate the
      // carrier's fetch, so the call would connect to silence. Failing here
      // with a nameable cause beats dialling someone and saying nothing.
      return adapterFailure(
        classifyFailure(
          "telnyx",
          "MISSING_WEBHOOK_SECRET",
          "Set DELIVERY_WEBHOOK_SECRET — Telnyx voice needs it to fetch the call script."
        )
      );
    }

    const statusCallback = await statusCallbackUrl("telnyx");
    const res = await fetch(`https://api.telnyx.com/v2/texml/Accounts/${encodeURIComponent(cfg.accountSid)}/Calls`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        To: input.to,
        From: cfg.from,
        ApplicationSid: cfg.appId,
        Url: url,
        ...(statusCallback
          ? {
              StatusCallback: statusCallback,
              // Space-separated, per Telnyx's TeXML spec — not an array.
              StatusCallbackEvent: "initiated ringing answered completed",
              StatusCallbackMethod: "POST",
            }
          : {}),
      }),
    });

    if (!res.ok) throw new Error(`Telnyx TeXML returned ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data?: { call_sid?: string; sid?: string } };
    const id = data.data?.call_sid ?? data.data?.sid;
    if (!id) throw new Error("Telnyx response missing call sid");
    return adapterSuccess(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Telnyx error";
    console.error("[Telnyx Voice] call failed:", message);
    return adapterFailure(classifyFailure("telnyx", undefined, message));
  }
}

async function placeViaTwilio(
  input: PlaceCallInput,
  cfg: { sid: string; token: string; from: string }
): Promise<AdapterResult> {
  try {
    const { default: Twilio } = await import("twilio");
    const client = Twilio(cfg.sid, cfg.token);
    const twiml = `<Response><Say voice="Polly.Joanna">${escapeXml(input.message)}</Say></Response>`;
    // Without a status callback a Twilio call is recorded as QUEUED and never
    // resolves — we'd never learn whether it was answered, went to voicemail,
    // or hit a busy signal. statusCallbackEvent must be listed explicitly;
    // Twilio only sends "completed" by default.
    const statusCallback = await statusCallbackUrl("twilio");
    const call = await client.calls.create({
      to: input.to,
      from: cfg.from,
      twiml,
      ...(statusCallback
        ? {
            statusCallback,
            statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
            statusCallbackMethod: "POST" as const,
          }
        : {}),
    });
    return adapterSuccess(call.sid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Twilio error";
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : undefined;
    console.error("[Twilio Voice] call failed:", message);
    return adapterFailure(classifyFailure("twilio", code, message));
  }
}

export async function placeCall(input: PlaceCallInput): Promise<AdapterResult> {
  const [sid, token, twilioFrom] = await Promise.all([
    getConfigValue("TWILIO_ACCOUNT_SID"),
    getConfigValue("TWILIO_AUTH_TOKEN"),
    getConfigValue("TWILIO_PHONE_NUMBER"),
  ]);
  if (sid && token && twilioFrom) {
    return placeViaTwilio(input, { sid, token, from: twilioFrom });
  }

  const [telnyxKey, telnyxFrom, accountSid, appId] = await Promise.all([
    getConfigValue("TELNYX_API_KEY"),
    getConfigValue("TELNYX_PHONE_NUMBER"),
    getConfigValue("TELNYX_ACCOUNT_SID"),
    getConfigValue("TELNYX_TEXML_APP_ID"),
  ]);
  if (telnyxKey && telnyxFrom && accountSid && appId) {
    return placeViaTelnyx(input, { apiKey: telnyxKey, from: telnyxFrom, accountSid, appId });
  }

  console.log(`[SIMULATED CALL] to=${input.to} message="${input.message}"`);
  return adapterSuccess(`sim_call_${input.idempotencyKey}`, true);
}

/**
 * Which carrier an outbound call would actually use right now.
 * The admin panel needs this to explain *why* voice is dark when Telnyx SMS
 * is plainly working — "Telnyx is configured" and "Telnyx can place calls"
 * are different statements, and conflating them was the original bug.
 */
export async function voiceCarrierStatus(): Promise<{
  carrier: "twilio" | "telnyx" | "none";
  missing: string[];
}> {
  const [sid, token, twilioFrom] = await Promise.all([
    getConfigValue("TWILIO_ACCOUNT_SID"),
    getConfigValue("TWILIO_AUTH_TOKEN"),
    getConfigValue("TWILIO_PHONE_NUMBER"),
  ]);
  if (sid && token && twilioFrom) return { carrier: "twilio", missing: [] };

  const entries: [string, string | undefined][] = await Promise.all(
    (["TELNYX_API_KEY", "TELNYX_PHONE_NUMBER", "TELNYX_ACCOUNT_SID", "TELNYX_TEXML_APP_ID", "DELIVERY_WEBHOOK_SECRET"] as const).map(
      async (k) => [k, await getConfigValue(k)] as [string, string | undefined]
    )
  );
  const missing = entries.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length === 0) return { carrier: "telnyx", missing: [] };

  return { carrier: "none", missing };
}
