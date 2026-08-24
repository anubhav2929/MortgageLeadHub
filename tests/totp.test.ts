import { describe, expect, it } from "vitest";
import { createRecoveryCodes, hashRecoveryCode, verifyTotp } from "@/core/totp";
import { validateNewPassword } from "@/core/passwordPolicy";

describe("TOTP and recovery authentication", () => {
  it("accepts a standard TOTP vector and a one-window clock skew", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(verifyTotp(secret, "287082", 59_000)).toBe(true);
    expect(verifyTotp(secret, "287082", 89_000)).toBe(true);
    expect(verifyTotp(secret, "000000", 59_000)).toBe(false);
  });

  it("creates unique recovery codes and normalizes their hashes", () => {
    const codes = createRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(codes[0].replace("-", "").toLowerCase()));
  });

  it("rejects short and locally known compromised passwords without a network call", async () => {
    expect(await validateNewPassword("short")).toMatch(/12/);
    expect(await validateNewPassword("Password123!")).toMatch(/commonly used/);
  });
});
