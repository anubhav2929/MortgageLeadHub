import { describe, expect, it } from "vitest";
import { evaluateVapiAssistantSetup } from "@/core/vapiSetup";

const webhook = "https://www.equityflowgroup.com/api/webhooks/vapi";

describe("Vapi assistant operational verification", () => {
  it("accepts a fully wired assistant", () => {
    expect(evaluateVapiAssistantSetup({
      server: { url: webhook, credentialId: "cred-1" },
      serverMessages: ["status-update", "transcript", "end-of-call-report"],
      artifactPlan: { loggingEnabled: true, transcriptPlan: { enabled: true } },
    }, webhook)).toEqual({ ok: true });
  });

  it("rejects an assistant that can call but cannot report to this CRM", () => {
    const result = evaluateVapiAssistantSetup({ serverMessages: [] }, webhook);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toMatch(/Server URL/);
      expect(result.issues.join(" ")).toMatch(/Custom Credential/);
      expect(result.issues.join(" ")).toMatch(/status-update/);
      expect(result.issues.join(" ")).toMatch(/end-of-call-report/);
      expect(result.issues.join(" ")).toMatch(/transcript/);
    }
  });

  it("rejects explicitly disabled transcript and logging artifacts", () => {
    const result = evaluateVapiAssistantSetup({
      server: { url: webhook, credentialId: "cred-1" },
      serverMessages: ["status-update", "conversation-update", "end-of-call-report"],
      artifactPlan: { loggingEnabled: false, transcriptPlan: { enabled: false } },
    }, webhook);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toMatch(/transcript generation.*disabled.*call logging.*disabled/i);
  });
});
