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
import { classifyFailure, classifyHttpFailure } from "@/core/deliveryStatus";
import { adapterFailure, adapterSuccess, type AdapterResult } from "./result";

export interface SendSmsInput {
  to: string;
  body: string;
  idempotencyKey: string;
  /** Callback confirmations/reminders are restricted to the configured
   * Telnyx campaign. Application idempotency is enforced by the durable
   * outbox; the Telnyx Messages API does not advertise a provider-side
   * idempotency-key contract. */
  requireIdempotentProvider?: boolean;
}

/** Twilio signs this exact public URL with the account auth token. */
async function deliveryCallbackUrl(provider: "twilio"): Promise<string> {
  return `${await getAppUrl()}/api/webhooks/delivery/${provider}`;
}

async function telnyxWebhookUrls(): Promise<{ primary: string; failover: string } | null> {
  if (!(await getConfigValue("TELNYX_PUBLIC_KEY"))) return null;
  const appUrl = await getAppUrl();
  return {
    primary: `${appUrl}/api/webhooks/telnyx`,
    failover: `${appUrl}/api/webhooks/telnyx/failover`,
  };
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

const E164 = /^\+[1-9]\d{7,14}$/;

function redactPhoneNumbers(value: string): string {
  return value.replace(/\+[1-9]\d{7,14}/g, (phone) => `+••••${phone.slice(-4)}`);
}

function telnyxRemedy(status: number, code: string | undefined, detail: string): string {
  const lower = detail.toLowerCase();
  if (status === 402) return "Add funds or raise the account spending limit in Telnyx Billing.";
  if (code === "40300" && /\bstop\b|opt(?:ed)?[ -]?out/.test(lower)) return "The recipient opted out; do not retry until they send START.";
  if (code === "40300" || code === "40305" || /messaging profile|not assigned/.test(lower)) {
    return "Assign the saved sending number to the saved messaging profile in Telnyx.";
  }
  if (["40010", "40301", "47000"].includes(code ?? "") || /10dlc|registration required/.test(lower)) {
    return "Activate the sender's 10DLC campaign (or toll-free verification) and assign the number to it.";
  }
  if (code === "40302") return "Enable the messaging profile in Telnyx.";
  if (code === "40309") return "Allow the destination country in the messaging profile.";
  if (code === "40329" || code === "40330") return "Complete toll-free verification/provisioning for the sending number.";
  if (code === "40333") return "Raise or reset the messaging-profile spend limit.";
  if (status === 401) return "Replace the Telnyx API key with an active key from the same account as the sending number.";
  if (status === 404) return "Verify that the messaging profile belongs to the API-key account.";
  if (status === 400 || status === 422) return "Correct the sender, recipient, profile ID, or message validation error shown above.";
  return "Open Admin → Integrations → Telnyx and run Test connection for the exact readiness check.";
}

async function sendViaTelnyx(input: SendSmsInput, apiKey: string, from: string): Promise<AdapterResult> {
  try {
    if (!E164.test(from)) {
      return adapterFailure({ class: "CONFIGURATION", message: "Telnyx sending number must be E.164, for example +13165550123.", affectsAllLeads: true });
    }
    if (!E164.test(input.to)) {
      return adapterFailure({ class: "PERMANENT", message: "SMS destination is not a valid E.164 phone number.", affectsAllLeads: false });
    }
    if (!input.body.trim() || input.body.length > 1_600) {
      return adapterFailure({ class: "CONFIGURATION", message: "Telnyx SMS text must contain 1 to 1,600 characters.", affectsAllLeads: true });
    }
    const profileId = await getConfigValue("TELNYX_MESSAGING_PROFILE_ID");
    const webhooks = await telnyxWebhookUrls();
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: input.to,
        text: input.body,
        auto_detect: true,
        ...(profileId ? { messaging_profile_id: profileId } : {}),
        // A configured messaging profile is the source of truth for inbound
        // and delivery webhooks. Without one, apply the same signed primary
        // and failover endpoints per-message so callbacks are never sent to
        // the legacy query-string-secret routes.
        ...(profileId
          ? { use_profile_webhooks: true }
          : webhooks
            ? { webhook_url: webhooks.primary, webhook_failover_url: webhooks.failover, use_profile_webhooks: false }
            : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const raw = await res.text();
      let providerCode: string | undefined;
      let providerDetail = raw;
      let providerTitle = "Request rejected";
      try {
        const parsed = JSON.parse(raw) as { errors?: Array<{ code?: string | number; title?: string; detail?: string }> };
        const first = parsed.errors?.[0];
        providerCode = first?.code === undefined ? undefined : String(first.code);
        providerTitle = first?.title || providerTitle;
        providerDetail = first?.detail || raw;
      } catch {
        // Preserve the raw provider response when it is not JSON.
      }
      const safeDetail = redactPhoneNumbers(providerDetail).slice(0, 500);
      const message = `Telnyx API returned HTTP ${res.status}${providerCode ? ` (${providerCode})` : ""}: ${providerTitle}: ${safeDetail} ${telnyxRemedy(res.status, providerCode, providerDetail)}`;
      console.warn("[Telnyx SMS] request rejected", { status: res.status, providerCode });
      return adapterFailure(classifyHttpFailure("telnyx", res.status, providerCode, message));
    }
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
      statusCallback,
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
  if (sid && token && twilioFrom) {
    if (input.requireIdempotentProvider) {
      return adapterFailure({ class: "PERMANENT", message: "Callback SMS requires the configured Telnyx campaign and durable outbox.", affectsAllLeads: true });
    }
    return sendViaTwilio(input, sid, token, twilioFrom);
  }

  console.log(`[SIMULATED SMS] idempotencyKey=${input.idempotencyKey}`);
  return adapterSuccess(`sim_sms_${input.idempotencyKey}`, true);
}
