import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { safeCompare } from "@/core/auth";
import { verifyVapiWebhookAuth } from "@/core/vapiWebhookAuth";

// Vapi currently recommends a Bearer Custom Credential and documents
// X-Vapi-Secret for backward compatibility. HMAC remains supported for an
// explicitly configured HMAC credential.

const SECRET = "s3cr3t-value";
const BODY = '{"message":{"type":"status-update","status":"ringing"}}';

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("HMAC signature verification", () => {
  it("matches a signature produced from the exact raw body", () => {
    expect(safeCompare(sign(BODY), sign(BODY))).toBe(true);
  });

  it("rejects a signature from a different secret", () => {
    expect(safeCompare(sign(BODY, "wrong"), sign(BODY))).toBe(false);
  });

  it("rejects a signature over a mutated body", () => {
    // Why the route reads text before parsing: re-serialising a parsed object
    // would not reproduce the bytes Vapi signed, and every request would fail.
    const tampered = BODY.replace("ringing", "ended");
    expect(safeCompare(sign(tampered), sign(BODY))).toBe(false);
  });

  it("is insensitive to hex case, which senders vary on", () => {
    expect(safeCompare(sign(BODY).toLowerCase(), sign(BODY))).toBe(true);
  });

  it("tolerates an algorithm prefix", () => {
    const prefixed = `sha256=${sign(BODY)}`;
    expect(safeCompare(prefixed.split("=").pop()!, sign(BODY))).toBe(true);
  });
});

describe("Vapi webhook authentication contracts", () => {
  it("accepts the recommended Bearer Custom Credential", () => {
    expect(verifyVapiWebhookAuth(new Headers({ authorization: `Bearer ${SECRET}` }), BODY, SECRET)).toBe(true);
  });

  it("accepts documented X-Vapi-Secret compatibility", () => {
    expect(verifyVapiWebhookAuth(new Headers({ "x-vapi-secret": SECRET }), BODY, SECRET)).toBe(true);
  });

  it("rejects a stale signed request", () => {
    const headers = new Headers({ "x-vapi-signature": sign(BODY), "x-vapi-timestamp": "1" });
    expect(verifyVapiWebhookAuth(headers, BODY, SECRET, 1_000)).toBe(false);
  });
});
