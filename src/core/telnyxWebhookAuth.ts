import { createPublicKey, timingSafeEqual, verify } from "node:crypto";

export const TELNYX_REPLAY_WINDOW_SECONDS = 5 * 60;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function publicKeyFrom(value: string) {
  const trimmed = value.trim();
  if (trimmed.includes("BEGIN PUBLIC KEY")) return createPublicKey(trimmed);
  const der = Buffer.from(trimmed, "base64");
  // Mission Control exposes the raw 32-byte Ed25519 verification key, while
  // some secret managers store an exported SPKI key. Accept both formats.
  const spki = der.length === 32
    ? Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), der])
    : der;
  return createPublicKey({ key: spki, format: "der", type: "spki" });
}

export function verifyTelnyxWebhook(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  publicKey: string;
  nowSeconds?: number;
}): { ok: true } | { ok: false; reason: "missing_headers" | "stale" | "invalid_timestamp" | "invalid_signature" } {
  if (!input.signature || !input.timestamp) return { ok: false, reason: "missing_headers" };
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "invalid_timestamp" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > TELNYX_REPLAY_WINDOW_SECONDS) return { ok: false, reason: "stale" };

  try {
    const signed = Buffer.from(`${input.timestamp}|${input.rawBody}`, "utf8");
    const signature = Buffer.from(input.signature, "base64");
    return verify(null, signed, publicKeyFrom(input.publicKey), signature)
      ? { ok: true }
      : { ok: false, reason: "invalid_signature" };
  } catch {
    // Constant-shape failure: callers should not expose key parsing details.
    safeEqual("invalid", "invalid");
    return { ok: false, reason: "invalid_signature" };
  }
}
