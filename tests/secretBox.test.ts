import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isSecretStorageEnabled, maskSecret } from "@/core/secretBox";

// These functions protect every provider API key at rest. The properties
// asserted here are the ones a security reviewer will ask about directly:
// ciphertext is non-deterministic, tampering is detected rather than silently
// tolerated, a wrong root key yields nothing usable, and the mask shown in the
// admin UI cannot be reversed into the original key.

const ROOT = "test-root-secret-that-is-long-enough-32chars";
const ORIGINAL = process.env.CREDENTIAL_SECRET;

beforeEach(() => {
  process.env.CREDENTIAL_SECRET = ROOT;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CREDENTIAL_SECRET;
  else process.env.CREDENTIAL_SECRET = ORIGINAL;
});

describe("isSecretStorageEnabled", () => {
  it("is enabled with a sufficiently long root secret", () => {
    expect(isSecretStorageEnabled()).toBe(true);
  });

  it("is disabled when the root secret is absent", () => {
    delete process.env.CREDENTIAL_SECRET;
    expect(isSecretStorageEnabled()).toBe(false);
  });

  it("rejects a root secret short enough to be brute-forced", () => {
    process.env.CREDENTIAL_SECRET = "tooshort";
    expect(isSecretStorageEnabled()).toBe(false);
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value exactly", () => {
    const plain = "sk-ant-api03-abcdef1234567890";
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("round-trips unicode and punctuation without corruption", () => {
    const plain = "påsswörd-✓-with £symbols & spaces";
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("never emits the plaintext inside the stored payload", () => {
    const plain = "SUPER_SECRET_VALUE";
    expect(encryptSecret(plain)).not.toContain(plain);
  });

  it("produces different ciphertext each time for the same input", () => {
    // A fresh IV per encryption. Without this, identical keys across
    // integrations would be visibly identical in a database dump.
    const plain = "same-value-every-time";
    expect(encryptSecret(plain)).not.toBe(encryptSecret(plain));
  });

  it("tags the payload with a version so the algorithm can be rotated later", () => {
    expect(encryptSecret("x").startsWith("v1:")).toBe(true);
  });

  it("returns null when the ciphertext has been tampered with", () => {
    const payload = encryptSecret("original-value");
    // Flip one character in the base64 body — GCM's auth tag must catch it.
    const body = payload.slice(3);
    const tampered = `v1:${body.slice(0, -2)}${body.slice(-2) === "AA" ? "BB" : "AA"}`;
    expect(decryptSecret(tampered)).toBeNull();
  });

  it("returns null when decrypting under a different root key", () => {
    const payload = encryptSecret("value-under-key-one");
    process.env.CREDENTIAL_SECRET = "an-entirely-different-root-secret-value";
    expect(decryptSecret(payload)).toBeNull();
  });

  it("returns null rather than throwing on an unversioned payload", () => {
    // Degrading to "not configured" is correct here; throwing would take down
    // every request that touches the credential store.
    expect(decryptSecret("not-a-valid-payload")).toBeNull();
  });

  it("throws a directive error when encrypting with no root key set", () => {
    delete process.env.CREDENTIAL_SECRET;
    expect(() => encryptSecret("x")).toThrow(/CREDENTIAL_SECRET/);
  });
});

describe("maskSecret", () => {
  it("keeps a short prefix and suffix for recognisability", () => {
    const masked = maskSecret("sk-ant-api03-abcdef1234567890");
    expect(masked.startsWith("sk-")).toBe(true);
    expect(masked.endsWith("7890")).toBe(true);
  });

  it("leaks at most 7 characters of a long secret", () => {
    const plain = "abcdefghijklmnopqrstuvwxyz0123456789";
    const masked = maskSecret(plain);
    const revealed = masked.replace(/•/g, "");
    expect(revealed.length).toBeLessThanOrEqual(7);
  });

  it("reveals nothing at all for a short secret", () => {
    // Prefix+suffix on an 8-character key would expose most of it.
    expect(maskSecret("short123")).toBe("••••••••");
  });
});
