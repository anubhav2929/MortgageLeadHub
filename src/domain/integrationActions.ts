"use server";

// Admin-only management of provider credentials.
//
// Security posture, deliberately:
//   - ADMIN role only. Compliance and Officer can see integration *status*
//     elsewhere, but never touch keys.
//   - Values are encrypted before they touch the database (core/secretBox.ts).
//   - Plaintext never travels back to the browser. The panel receives a mask
//     ("sk-••••••••4f2a") — enough to confirm which key is installed, useless
//     if the page is screenshotted, cached, or shoulder-surfed.
//   - Every write is audit-logged with who and when, but never the value.

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/domain/session";
import { getDb, nowIso, saveDb } from "@/domain/store";
import { audit } from "@/domain/audit";
import { encryptSecret, isSecretStorageEnabled } from "@/core/secretBox";
import { ALL_INTEGRATION_KEYS, INTEGRATIONS, isSecretKey } from "@/core/integrationRegistry";
import { getCapabilities, getConfigValue } from "@/lib/runtimeConfig";
import { getRedditAccessToken } from "@/adapters/reddit";
import { verifyArcticShiftConnection } from "@/adapters/leadDiscovery";
import { verifyPropertyEvidenceConnection } from "@/adapters/propertyData";
import { normalizePublicAppUrl } from "@/core/publicUrl";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** How one field appears in the panel. Never carries a usable secret. */
export interface CredentialStatus {
  key: string;
  /** Masked for secrets, plaintext for non-secrets (phone numbers, URLs —
   *  useless to an attacker and genuinely helpful to see). */
  display: string;
  isSet: boolean;
  /** True when the value comes from an env var rather than this panel, so the
   *  admin understands why it isn't editable-looking. */
  fromEnv: boolean;
  updatedAt?: string;
  updatedByName?: string;
}

export interface IntegrationStatus {
  id: string;
  live: boolean;
  fields: CredentialStatus[];
  lastVerified?: { ok: boolean; message: string; verifiedAt: string; verifiedByName: string };
}

async function requireAdmin() {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") throw new Error("Only Admin can manage integrations.");
  return user;
}

export async function getIntegrationStatusesAction(): Promise<{
  storageEnabled: boolean;
  integrations: IntegrationStatus[];
}> {
  await requireAdmin();
  const db = await getDb();
  const caps = await getCapabilities();

  const liveById: Record<string, boolean> = {
    telnyx: caps.hasTelnyx,
    twilio: caps.hasTwilio,
    openai: caps.hasOpenAi,
    anthropic: caps.hasAnthropic,
    nvidia: caps.hasNvidia,
    resend: caps.hasResend,
    vapi: caps.hasVoiceAgent,
    rentcast: caps.hasPropertyData,
    "arctic-shift": caps.hasLeadDiscovery,
    "public-data": true,
    isoftpull: caps.hasCredit,
    reddit:
      (await getConfigValue("REDDIT_COMMERCIAL_APPROVED")) === "true" &&
      Boolean(Array.from(db.redditConnections.values()).find((item) => !item.revokedAt)),
    analytics: Boolean(await getConfigValue("NEXT_PUBLIC_GA_MEASUREMENT_ID")),
    platform: true,
  };

  const integrations: IntegrationStatus[] = [];
  for (const def of INTEGRATIONS) {
    const fields: CredentialStatus[] = [];
    for (const f of def.fields) {
      const stored = db.credentials.get(f.key);
      const resolved = await getConfigValue(f.key);
      const fromEnv = !stored && Boolean(resolved);
      let display = "";
      if (resolved) {
        if (isSecretKey(f.key)) {
          display = "••••••••";
        } else if (f.key === "APP_URL") {
          const normalized = normalizePublicAppUrl(resolved);
          display = normalized.ok ? normalized.url : resolved;
        } else {
          display = resolved;
        }
      }
      fields.push({
        key: f.key,
        display,
        isSet: Boolean(resolved),
        fromEnv,
        updatedAt: stored?.updatedAt,
        updatedByName: stored?.updatedByName,
      });
    }
    const health = db.integrationHealth.get(def.id);
    integrations.push({ id: def.id, live: liveById[def.id] ?? false, fields, lastVerified: health ? { ok: health.ok, message: health.message, verifiedAt: health.verifiedAt, verifiedByName: health.verifiedByName } : undefined });
  }

  return { storageEnabled: isSecretStorageEnabled(), integrations };
}

export async function saveIntegrationKeysAction(
  integrationId: string,
  values: Record<string, string>
): Promise<ActionResult> {
  const user = await requireAdmin();

  if (!isSecretStorageEnabled()) {
    return {
      ok: false,
      message:
        "CREDENTIAL_SECRET isn't set on this deployment, so keys can't be stored securely. Set it (any random string, 32+ characters) and redeploy — see the note at the top of this page.",
    };
  }

  const def = INTEGRATIONS.find((i) => i.id === integrationId);
  if (!def) return { ok: false, message: "Unknown integration." };

  if (integrationId === "public-data") {
    const rawSources = values.PROPERTY_PUBLIC_RECORD_SOURCES_JSON?.trim();
    if (rawSources) {
      try {
        const sources = JSON.parse(rawSources) as unknown;
        if (!Array.isArray(sources) || sources.length > 8) {
          return { ok: false, message: "Public-record source definitions must be a JSON array with at most 8 entries." };
        }
        const hosts = new Set((values.PROPERTY_RECORD_ALLOWLIST ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
        for (const source of sources) {
          if (!source || typeof source !== "object") return { ok: false, message: "Every public-record source must be a JSON object." };
          const endpoint = String((source as Record<string, unknown>).endpoint ?? "");
          const url = new URL(endpoint);
          if (url.protocol !== "https:" || !hosts.has(url.hostname.toLowerCase())) {
            return { ok: false, message: `Add ${url.hostname || "the endpoint host"} to the allowlist and use HTTPS before saving.` };
          }
        }
      } catch (error) {
        return { ok: false, message: `Public-record source JSON is invalid: ${error instanceof Error ? error.message : "parse failed"}` };
      }
    }
  }

  const db = await getDb();
  const changed: string[] = [];
  const cleared: string[] = [];

  for (const [key, rawValue] of Object.entries(values)) {
    // Only keys the product actually reads — stops the panel becoming an
    // arbitrary key-value store that nothing consumes.
    if (!ALL_INTEGRATION_KEYS.includes(key)) continue;
    if (!def.fields.some((f) => f.key === key)) continue;

    let value = rawValue.trim();

    // Empty means "clear this key", not "save an empty string" — otherwise a
    // blank field would mask a working env var with an empty override.
    if (!value) {
      if (db.credentials.delete(key)) cleared.push(key);
      continue;
    }

    if (key === "APP_URL") {
      const normalized = normalizePublicAppUrl(value);
      if (!normalized.ok) return { ok: false, message: normalized.reason };
      value = normalized.url;
    }

    // The panel sends back the mask for untouched secret fields. Saving that
    // literally would overwrite a real key with "sk-••••••••4f2a".
    if (value.includes("••")) continue;

    db.credentials.set(key, {
      key,
      value: encryptSecret(value),
      updatedAt: nowIso(),
      updatedByName: user.name,
    });
    changed.push(key);
  }

  if (changed.length === 0 && cleared.length === 0) {
    return { ok: true, message: "No changes to save." };
  }

  await saveDb();
  await audit(
    user.id,
    user.name,
    "INTEGRATION_KEYS_UPDATED",
    "Integration",
    def.id,
    "ALLOW",
    // Key NAMES only — never values, not even masked.
    { changed, cleared }
  );
  revalidatePath("/workspace/admin");

  const caps = await getCapabilities();
  const nowLive =
    ({
      telnyx: caps.hasTelnyx,
      twilio: caps.hasTwilio,
      openai: caps.hasOpenAi,
      anthropic: caps.hasAnthropic,
      nvidia: caps.hasNvidia,
      resend: caps.hasResend,
      vapi: caps.hasVoiceAgent,
      rentcast: caps.hasPropertyData,
      "arctic-shift": caps.hasLeadDiscovery,
      "public-data": true,
      isoftpull: caps.hasCredit,
      reddit:
        (await getConfigValue("REDDIT_COMMERCIAL_APPROVED")) === "true" &&
        Boolean(Array.from(db.redditConnections.values()).find((item) => !item.revokedAt)),
      analytics: Boolean(await getConfigValue("NEXT_PUBLIC_GA_MEASUREMENT_ID")),
      platform: true,
    } as Record<string, boolean>)[def.id] ?? false;

  return {
    ok: true,
    message: nowLive
      ? `${def.name} saved and live — it's in use from the next send, no redeploy needed.`
      : `${def.name} saved. Still missing a required field before it goes live.`,
  };
}

export interface TestResult {
  ok: boolean;
  message: string;
}

/** Makes a real, cheap, read-only call to the provider so the admin finds out
 *  a key is wrong here — not later, silently, in the middle of a lead's
 *  cadence. Never sends a message or places a call. */
async function runIntegrationTest(integrationId: string): Promise<TestResult> {
  try {
    switch (integrationId) {
      case "telnyx": {
        const key = await getConfigValue("TELNYX_API_KEY");
        const number = await getConfigValue("TELNYX_PHONE_NUMBER");
        const publicKey = await getConfigValue("TELNYX_PUBLIC_KEY");
        if (!key || !number || !publicKey) return { ok: false, message: "API key, sending number, and webhook public key are all required for production two-way SMS." };
        const res = await fetch("https://api.telnyx.com/v2/phone_numbers?page[size]=1", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok
          ? { ok: true, message: "Connected to Telnyx." }
          : { ok: false, message: `Telnyx rejected the key (HTTP ${res.status}).` };
      }
      case "twilio": {
        const sid = await getConfigValue("TWILIO_ACCOUNT_SID");
        const token = await getConfigValue("TWILIO_AUTH_TOKEN");
        if (!sid || !token) return { ok: false, message: "Account SID and auth token are both required." };
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
          headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok
          ? { ok: true, message: "Connected to Twilio." }
          : { ok: false, message: `Twilio rejected the credentials (HTTP ${res.status}).` };
      }
      case "anthropic": {
        const key = await getConfigValue("ANTHROPIC_API_KEY");
        if (!key) return { ok: false, message: "No API key saved yet." };
        const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok
          ? { ok: true, message: "Connected to Anthropic." }
          : { ok: false, message: `Anthropic rejected the key (HTTP ${res.status}).` };
      }
      case "openai": {
        const key = await getConfigValue("OPENAI_API_KEY");
        if (!key) return { ok: false, message: "No API key saved yet." };
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok
          ? { ok: true, message: "Connected to OpenAI." }
          : { ok: false, message: `OpenAI rejected the key (HTTP ${res.status}).` };
      }
      case "resend": {
        const key = await getConfigValue("RESEND_API_KEY");
        const from = await getConfigValue("RESEND_FROM_EMAIL");
        if (!key || !from) return { ok: false, message: "Resend API key and a From address on a verified domain are both required." };
        const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return { ok: false, message: `Resend rejected the key (HTTP ${res.status}).` };
        const payload = await res.json() as { data?: Array<{ name?: string; status?: string }> };
        const fromDomain = from.match(/@([^>\s]+)>?$/)?.[1]?.toLowerCase();
        const verified = payload.data?.some((domain) => {
          const name = domain.name?.toLowerCase();
          return name && domain.status?.toLowerCase() === "verified" && (fromDomain === name || fromDomain?.endsWith(`.${name}`));
        });
        return verified
          ? { ok: true, message: "Connected to Resend; the configured From domain is verified." }
          : { ok: false, message: "Connected to Resend, but the configured From address is not on a verified domain." };
      }
      case "vapi": {
        const key = await getConfigValue("VAPI_API_KEY");
        const phoneNumberId = await getConfigValue("VAPI_PHONE_NUMBER_ID");
        const webhookSecret = await getConfigValue("VAPI_WEBHOOK_SECRET");
        if (!key || !phoneNumberId || !webhookSecret) return { ok: false, message: "Vapi API key, phone-number ID, and webhook token are all required." };
        const res = await fetch(`https://api.vapi.ai/phone-number/${encodeURIComponent(phoneNumberId)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
        return res.ok
          ? { ok: true, message: "Connected to Vapi; the configured phone-number ID exists." }
          : { ok: false, message: `Vapi could not verify that phone-number ID (HTTP ${res.status}).` };
      }
      case "rentcast": {
        const key = await getConfigValue("PROPERTY_DATA_API_KEY");
        if (!key) return { ok: false, message: "No API key saved yet." };
        const res = await fetch("https://api.rentcast.io/v1/avm/value?address=1600%20Pennsylvania%20Ave%20NW,%20Washington,%20DC", {
          headers: { "X-Api-Key": key },
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok || res.status === 404
          ? { ok: true, message: "Connected to RentCast." }
          : { ok: false, message: `RentCast rejected the key (HTTP ${res.status}).` };
      }
      case "arctic-shift": {
        return verifyArcticShiftConnection();
      }
      case "public-data": {
        return verifyPropertyEvidenceConnection();
      }
      case "nvidia": {
        const key = await getConfigValue("NVIDIA_API_KEY");
        if (!key) return { ok: false, message: "No API key saved yet." };
        const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok
          ? { ok: true, message: "Connected to NVIDIA NIM." }
          : { ok: false, message: `NVIDIA rejected the key (HTTP ${res.status}).` };
      }
      case "reddit": {
        if ((await getConfigValue("REDDIT_COMMERCIAL_APPROVED")) !== "true") return { ok: false, message: "Written commercial approval has not been recorded." };
        const db = await getDb();
        const connection = Array.from(db.redditConnections.values()).find((item) => !item.revokedAt);
        if (!connection) return { ok: false, message: "No Reddit OAuth account is connected." };
        const token = await getRedditAccessToken(connection);
        const res = await fetch("https://oauth.reddit.com/api/v1/me", { headers: { Authorization: `Bearer ${token}`, "User-Agent": "EquityFlowGroup/1.0" }, signal: AbortSignal.timeout(10_000) });
        return res.ok ? { ok: true, message: `Connected to Reddit as u/${connection.accountName}.` } : { ok: false, message: `Reddit account verification failed (HTTP ${res.status}).` };
      }
      case "analytics": {
        const ga = await getConfigValue("NEXT_PUBLIC_GA_MEASUREMENT_ID");
        const meta = await getConfigValue("META_PIXEL_ID");
        return ga || meta ? { ok: true, message: "Analytics configuration is present. Complete consent-denial and network-payload UAT before enabling Meta CAPI." } : { ok: false, message: "No GA4 or Meta identifiers are configured." };
      }
      case "isoftpull": {
        const ready = (await getCapabilities()).hasCredit;
        return ready
          ? { ok: true, message: "iSoftpull credentials and the legal approval gate are present. Complete an approved sandbox pull before live activation." }
          : { ok: false, message: "Add both iSoftpull credentials and set CREDIT_LIVE_APPROVED=true only after counsel approval." };
      }
      default:
        return { ok: false, message: "This integration has no connection test." };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Connection test failed." };
  }
}

export async function testIntegrationAction(integrationId: string): Promise<TestResult> {
  const user = await requireAdmin();
  const result = await runIntegrationTest(integrationId);
  const db = await getDb();
  db.integrationHealth.set(integrationId, {
    integrationId, ok: result.ok, message: result.message, verifiedAt: nowIso(), verifiedById: user.id, verifiedByName: user.name,
  });
  await audit(user.id, user.name, "INTEGRATION_VERIFIED", "Integration", integrationId, result.ok ? "ALLOW" : "DENY", { message: result.message });
  await saveDb();
  revalidatePath("/workspace/admin");
  return result;
}
