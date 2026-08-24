import { describe, expect, it } from "vitest";
import { sanitizeAnalyticsParams } from "@/core/analyticsPrivacy";

describe("analytics privacy", () => {
  it("drops borrower, property, mortgage, and credit parameters", () => {
    expect(sanitizeAnalyticsParams("intake_submitted", {
      email: "borrower@example.test",
      address: "100 Main St",
      loanAmount: 450_000,
      creditBand: "excellent",
    })).toEqual({});
  });

  it("keeps only a bounded intake step number", () => {
    expect(sanitizeAnalyticsParams("intake_step_completed", { step: 999, email: "x@y.test" })).toEqual({ step: 20 });
  });
});
