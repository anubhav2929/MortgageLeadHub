import { createHmac } from "node:crypto";
import { safeCompare } from "@/core/auth";

/** Supports Vapi's recommended Bearer Custom Credential, documented legacy
 * X-Vapi-Secret, and an explicitly configured HMAC credential. */
export function verifyVapiWebhookAuth(headers: Headers, rawBody: string, secret: string, nowSeconds = Date.now() / 1000): boolean {
  const plaintext = headers.get("x-vapi-secret");
  if (plaintext && safeCompare(plaintext, secret)) return true;

  const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer && safeCompare(bearer, secret)) return true;

  const signature = headers.get("x-vapi-signature");
  if (!signature) return false;
  const timestamp = headers.get("x-vapi-timestamp");
  if (timestamp) {
    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds) || Math.abs(nowSeconds - seconds) > 300) return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const supplied = signature.includes("=") ? signature.split("=").pop()! : signature;
  return safeCompare(supplied.trim().toLowerCase(), expected);
}
