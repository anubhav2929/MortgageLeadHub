import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelnyxWebhook } from "@/core/telnyxWebhookAuth";

describe("verifyTelnyxWebhook", () => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const rawBody = JSON.stringify({ data: { id: "event-1" } });
  const timestamp = "1720000000";
  const signature = sign(null, Buffer.from(`${timestamp}|${rawBody}`), keys.privateKey).toString("base64");

  it("accepts a current valid signature", () => {
    expect(verifyTelnyxWebhook({ rawBody, signature, timestamp, publicKey, nowSeconds: 1720000010 })).toEqual({ ok: true });
  });

  it("accepts Telnyx's raw base64 public-key format", () => {
    const spki = keys.publicKey.export({ type: "spki", format: "der" });
    const rawPublicKey = spki.subarray(spki.length - 32).toString("base64");
    expect(verifyTelnyxWebhook({ rawBody, signature, timestamp, publicKey: rawPublicKey, nowSeconds: 1720000010 })).toEqual({ ok: true });
  });

  it("rejects stale and tampered events", () => {
    expect(verifyTelnyxWebhook({ rawBody, signature, timestamp, publicKey, nowSeconds: 1720001000 })).toEqual({ ok: false, reason: "stale" });
    expect(verifyTelnyxWebhook({ rawBody: rawBody + " ", signature, timestamp, publicKey, nowSeconds: 1720000010 })).toEqual({ ok: false, reason: "invalid_signature" });
  });
});
