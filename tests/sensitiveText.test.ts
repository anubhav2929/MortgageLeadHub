import { describe, expect, it } from "vitest";
import { redactRestrictedText } from "@/core/sensitiveText";

describe("restricted voice text redaction", () => {
  it("redacts identity, account, and exact credit details before persistence or prompt reuse", () => {
    const result = redactRestrictedText("DOB 1/2/1980, SSN 123-45-6789, account number 123456789012, credit score 715");
    expect(result.redacted).toBe(true);
    expect(result.text).not.toMatch(/1980|123-45-6789|123456789012|715/);
  });
});
