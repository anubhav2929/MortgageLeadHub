import { describe, expect, it } from "vitest";
import { LEAD_STAGE_TEMPLATE_IDS, renderLeadStageTemplate } from "@/core/outreachTemplates";

describe("lead-stage outreach templates", () => {
  it("covers every CRM lead state for email and SMS", () => {
    expect(LEAD_STAGE_TEMPLATE_IDS).toHaveLength(12);
    for (const state of LEAD_STAGE_TEMPLATE_IDS) {
      const base = { state, firstName: "Jordan", intent: "REFINANCE" as const, officerFirstName: "Alex", senderName: "Equity Flow Group" };
      const email = renderLeadStageTemplate({ ...base, channel: "EMAIL" });
      const sms = renderLeadStageTemplate({ ...base, channel: "SMS" });
      expect(email.subject).toBeTruthy();
      expect(email.body).toBeTruthy();
      expect(sms.body).toBeTruthy();
      expect(sms.body.length).toBeLessThanOrEqual(320);
      if (sms.sendable) expect(sms.body).toMatch(/STOP/i);
    }
  });

  it("prevents templates from bypassing closed/suppressed policy states", () => {
    for (const state of ["SUPPRESSED", "CLOSED_LOST"] as const) {
      expect(renderLeadStageTemplate({ state, channel: "SMS", firstName: "J", intent: "UNKNOWN", officerFirstName: "A", senderName: "EFG" }).sendable).toBe(false);
    }
  });
});
