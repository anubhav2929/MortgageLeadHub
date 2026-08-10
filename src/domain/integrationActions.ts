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
import { decryptSecret, encryptSecret, isSecretStorageEnabled, maskSecret } from "@/core/secretBox";
import { ALL_INTEGRATION_KEYS, INTEGRATIONS, isSecretKey } from "@/core/integrationRegistry";
import { getCapabilities, getConfigValue } from "@/lib/runtimeConfig";

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
    anthropic: caps.hasAnthropic,
    nvidia: caps.hasNvidia,
    resend: caps.hasResend,
    vapi: caps.hasVoiceAgent,
    rentcast: caps.hasPropertyData,
    reddit: caps.hasLeadDiscovery,
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
        display = isSecretKey(f.key) ? maskSecret(resolved) : resolved;
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
    integrations.push({ id: def.id, live: liveById[def.id] ?? false, fields });
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

  const db = await getDb();
  const changed: string[] = [];
  const cleared: string[] = [];

  for (const [key, rawValue] of Object.entries(values)) {
    // Only keys the product actually reads — stops the panel becoming an
    // arbitrary key-value store that nothing consumes.
    if (!ALL_INTEGRATION_KEYS.includes(key)) continue;
    if (!def.fields.some((f) => f.key === key)) continue;

    const value = rawValue.trim();

    // Empty means "clear this key", not "save an empty string" — otherwise a
    // blank field would mask a working env var with an empty override.
    if (!value) {
      if (db.credentials.delete(key)) cleared.push(key);
      continue;
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

  saveDb();
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
      anthropic: caps.hasAnthropic,
      nvidia: caps.hasNvidia,
      resend: caps.hasResend,
      vapi: caps.hasVoiceAgent,
      rentcast: caps.hasPropertyData,
      reddit: caps.hasLeadDiscovery,
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
export async function testIntegrationAction(integrationId: string): Promise<TestResult> {
  await requireAdmin();

  try {
    switch (integrationId) {
      case "telnyx": {
        const key = await getConfigValue("TELNYX_API_KEY");
        if (!key) return { ok: false, message: "No API key saved yet." };
        const res = await fetch("https://api.telnyx.com/v2/phone_numbers?page[size]=1", {
          headers: { Authorization: `Bearer ${key}` },
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
        });
        return res.ok
          ? { ok: true, message: "Connected to Anthropic." }
          : { ok: false, message: `Anthropic rejected the key (HTTP ${res.status}).` };
      }
      case "resend": {
        const key = await getConfigValue("RESEND_API_KEY");
        if (!key) return { ok: false, message: "No API key saved yet." };
        const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
        return res.ok
          ? { ok: true, message: "Connected to Resend." }
          : { ok: false, message: `Resend rejected the key (HTTP ${res.status}).` };
      }
      case "vapi": {
        const key = await getConfigValue("VAPI_API_KEY");
        if (!key) return { ok: false, message: "No API key saved yet." };
        const res = await fetch("https://api.vapi.ai/phone-number", { headers: { Authorization: `Bearer ${key}` } });
        return res.ok
          ? { ok: true, message: "Connected to Vapi." }
          : { ok: false, message: `Vapi rejected the key (HTTP ${res.status}).` };
      }
      case "rentcast": {
        const key = await getConfigValue("PROPERTY_DATA_API_KEY");
        if (!key) return { ok: false, message: "No API key saved yet." };
        const res = await fetch("https://api.rentcast.io/v1/avm/value?address=1600%20Pennsylvania%20Ave%20NW,%20Washington,%20DC", {
          headers: { "X-Api-Key": key },
        });
        return res.ok || res.status === 404
          ? { ok: true, message: "Connected to RentCast." }
          : { ok: false, message: `RentCast rejected the key (HTTP ${res.status}).` };
      }
      case "nvidia": {
        const key = await getConfigValue("NVIDIA_API_KEY");
        if (!key) return { ok: false, message: "No API key saved yet." };
        const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
        });
        return res.ok
          ? { ok: true, message: "Connected to NVIDIA NIM." }
          : { ok: false, message: `NVIDIA rejected the key (HTTP ${res.status}).` };
      }
      case "reddit": {
        const id = await getConfigValue("REDDIT_CLIENT_ID");
        const secret = await getConfigValue("REDDIT_CLIENT_SECRET");
        if (!id || !secret) return { ok: false, message: "Client ID and secret are both required." };
        const res = await fetch("https://www.reddit.com/api/v1/access_token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "equityflowgroup-discovery/1.0",
          },
          body: "grant_type=client_credentials",
        });
        return res.ok
          ? { ok: true, message: "Connected to Reddit." }
          : { ok: false, message: `Reddit rejected the credentials (HTTP ${res.status}).` };
      }
      default:
        return { ok: false, message: "This integration has no connection test." };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Connection test failed." };
  }
}

/** Reveals one secret in full, for an admin who needs to verify or copy it.
 *  Separate action so it's a deliberate click, audit-logged on its own. */
export async function revealIntegrationKeyAction(key: string): Promise<{ ok: boolean; value?: string; message?: string }> {
  const user = await requireAdmin();
  if (!ALL_INTEGRATION_KEYS.includes(key)) return { ok: false, message: "Unknown key." };

  const db = await getDb();
  const stored = db.credentials.get(key);
  if (!stored) return { ok: false, message: "That key is set by an environment variable, not here." };

  const plain = decryptSecret(stored.value);
  if (!plain) return { ok: false, message: "Could not decrypt — CREDENTIAL_SECRET may have changed since this was saved." };

  await audit(user.id, user.name, "INTEGRATION_KEY_REVEALED", "Integration", key, "ALLOW");
  return { ok: true, value: plain };
}
