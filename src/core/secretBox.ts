// Encryption for provider API keys stored in the database.
//
// Admin-entered keys have to live somewhere, and "somewhere" is the same
// Postgres row as everything else. Plaintext secrets in a database is how
// routine incidents become credential breaches, so nothing is written
// unencrypted — a database dump, a backup file, or a support engineer with
// read access never yields a usable key.
//
// AES-256-GCM: authenticated, so a tampered ciphertext fails loudly instead
// of decrypting to garbage that gets sent to a vendor as a bearer token.
//
// The root key comes from CREDENTIAL_SECRET and is never itself stored. That
// is deliberate: encrypting DB contents with a key that also lives in the DB
// protects against nothing. It means one env var must still be set by hand —
// see integrationRegistry.ts for the setup copy the admin panel shows.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
// Fixed salt: the root secret is already high-entropy and per-deployment, and
// a per-value salt would have to be stored alongside each value anyway.
const KEY_SALT = "equity-flow-group.credential.v1";

export function isSecretStorageEnabled(): boolean {
  return Boolean(process.env.CREDENTIAL_SECRET && process.env.CREDENTIAL_SECRET.length >= 16);
}

function rootKey(): Buffer {
  const secret = process.env.CREDENTIAL_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "CREDENTIAL_SECRET is not set (or is under 16 characters). Set it before saving provider keys — see Admin → Integrations."
    );
  }
  return scryptSync(secret, KEY_SALT, 32);
}

/** Returns "v1:<base64(iv|tag|ciphertext)>". The version prefix means the
 *  algorithm can be rotated later without guessing at stored formats. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, rootKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

/** Returns null rather than throwing when a value can't be read — a rotated
 *  or corrupted CREDENTIAL_SECRET should degrade that provider to "not
 *  configured", not crash every request that touches the store. */
export function decryptSecret(payload: string): string | null {
  try {
    if (!payload.startsWith("v1:")) return null;
    const raw = Buffer.from(payload.slice(3), "base64");
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGO, rootKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** What the admin panel displays. Never returns enough to reconstruct the key
 *  — the plaintext must not travel back to the browser once saved. */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return "••••••••";
  return `${plain.slice(0, 3)}••••••••${plain.slice(-4)}`;
}
