import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateToken, hashPassword, hashPasswordSync, safeCompare, verifyPassword, verifySvixSignature } from "@/core/auth";

// Authentication primitives. The properties asserted here are the ones whose
// absence causes a breach rather than a bug: salts must be unique, comparison
// must not short-circuit on the first differing byte, and a webhook signature
// must be rejected when replayed outside its time window.

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("Correct horse battery staple", stored)).toBe(false);
  });

  it("never stores the password itself", async () => {
    const stored = await hashPassword("plaintext-password");
    expect(stored).not.toContain("plaintext-password");
  });

  it("salts each hash, so identical passwords store differently", async () => {
    // Without a per-hash salt, a leaked table shows at a glance which users
    // share a password, and one cracked hash breaks all of them.
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("produces sync hashes that the async verifier accepts", async () => {
    // Seed data uses the sync variant; a mismatch here would lock every
    // seeded account out with a confusing "wrong password".
    const stored = hashPasswordSync("seeded-password");
    expect(await verifyPassword("seeded-password", stored)).toBe(true);
  });

  it("returns false rather than throwing on a malformed stored value", async () => {
    expect(await verifyPassword("anything", "not-a-valid-hash")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });
});

describe("generateToken", () => {
  it("produces a long hex token", () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
  });
});

describe("safeCompare", () => {
  it("matches identical strings", () => {
    expect(safeCompare("shared-secret", "shared-secret")).toBe(true);
  });

  it("rejects different strings of the same length", () => {
    expect(safeCompare("shared-secret", "shared-secreT")).toBe(false);
  });

  it("rejects strings of differing length without throwing", () => {
    // node's timingSafeEqual throws on a length mismatch; this must absorb
    // that rather than 500-ing every webhook with a malformed header.
    expect(safeCompare("short", "much-longer-value")).toBe(false);
    expect(safeCompare("", "x")).toBe(false);
  });
});

describe("verifySvixSignature", () => {
  const SECRET = "whsec_dGVzdHNlY3JldGtleWZvcnZlcmlmaWNhdGlvbg==";
  const BODY = '{"type":"email.received","data":{"email_id":"abc"}}';

  function sign(id: string, timestamp: string, body: string, secret = SECRET) {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
  }

  const now = () => Math.floor(Date.now() / 1000).toString();

  it("accepts a correctly signed, current request", () => {
    const ts = now();
    const ok = verifySvixSignature(SECRET, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, BODY) }, BODY);
    expect(ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ts = now();
    const sig = sign("msg_1", ts, BODY);
    const ok = verifySvixSignature(SECRET, { id: "msg_1", timestamp: ts, signature: sig }, `${BODY} `);
    expect(ok).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const ts = now();
    const sig = sign("msg_1", ts, BODY, "whsec_b3RoZXJzZWNyZXR2YWx1ZWhlcmVwYWQ=");
    expect(verifySvixSignature(SECRET, { id: "msg_1", timestamp: ts, signature: sig }, BODY)).toBe(false);
  });

  it("rejects a replayed request from outside the time window", () => {
    // A captured request must stop working once its window closes.
    const old = (Math.floor(Date.now() / 1000) - 3600).toString();
    const sig = sign("msg_1", old, BODY);
    expect(verifySvixSignature(SECRET, { id: "msg_1", timestamp: old, signature: sig }, BODY)).toBe(false);
  });

  it("rejects a timestamp far in the future", () => {
    const future = (Math.floor(Date.now() / 1000) + 3600).toString();
    const sig = sign("msg_1", future, BODY);
    expect(verifySvixSignature(SECRET, { id: "msg_1", timestamp: future, signature: sig }, BODY)).toBe(false);
  });

  it("rejects missing headers", () => {
    const ts = now();
    expect(verifySvixSignature(SECRET, { id: null, timestamp: ts, signature: sign("m", ts, BODY) }, BODY)).toBe(false);
    expect(verifySvixSignature(SECRET, { id: "m", timestamp: null, signature: sign("m", ts, BODY) }, BODY)).toBe(false);
    expect(verifySvixSignature(SECRET, { id: "m", timestamp: ts, signature: null }, BODY)).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    expect(verifySvixSignature(SECRET, { id: "m", timestamp: "not-a-number", signature: "v1,x" }, BODY)).toBe(false);
  });

  it("accepts when the correct signature appears among several", () => {
    // Svix sends space-delimited signatures during secret rotation.
    const ts = now();
    const correct = sign("msg_1", ts, BODY);
    const header = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${correct}`;
    expect(verifySvixSignature(SECRET, { id: "msg_1", timestamp: ts, signature: header }, BODY)).toBe(true);
  });
});
