import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { safeCompare } from "@/core/auth";

// Setting server.secret does NOT make Vapi send x-vapi-secret — by default it
// sends x-vapi-signature, an HMAC of the raw body. Checking only for the
// plaintext header meant every status-update and end-of-call-report was
// rejected 401, so calls placed fine and then never produced a transcript.
//
// This pins the HMAC construction the route relies on.

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
