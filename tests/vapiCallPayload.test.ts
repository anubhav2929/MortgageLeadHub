import { describe, expect, it } from "vitest";
import { buildVapiSavedAssistantCallPayload } from "@/adapters/voiceAgent";

describe("minimal Vapi saved-assistant call payload", () => {
  it("sends only stable call references, bounded variables, and correlation metadata", () => {
    const payload = buildVapiSavedAssistantCallPayload({
      assistantId: "11111111-1111-4111-8111-111111111111",
      phoneNumberId: "22222222-2222-4222-8222-222222222222",
      leadId: "lead-123",
      conversationId: "conversation-456",
      firstName: "  Jo\u0000hn  ",
      lastName: " Doe ",
      city: " Wichita\nKansas ",
      intent: "HOME_EQUITY",
      goal: "DEBT_CONSOLIDATION",
      phoneE164: "+13165550123",
      priorContext: "x".repeat(8_100),
      initialQuestionId: "timeline",
    });

    expect(Object.keys(payload).sort()).toEqual([
      "assistantId",
      "assistantOverrides",
      "customer",
      "metadata",
      "phoneNumberId",
    ]);
    expect(payload.customer).toEqual({ number: "+13165550123" });
    expect(payload.metadata).toEqual({ leadId: "lead-123", conversationId: "conversation-456" });
    expect(payload.assistantOverrides.variableValues).toMatchObject({
      firstName: "Jo hn",
      lastName: "Doe",
      fullName: "Jo hn Doe",
      city: "Wichita Kansas",
      intent: "home equity",
      goal: "debt consolidation",
      initialQuestionId: "timeline",
    });
    expect(payload.assistantOverrides.variableValues.priorContext).toHaveLength(8_000);
  });

  it("cannot reintroduce transient assistant configuration", () => {
    const serialized = JSON.stringify(buildVapiSavedAssistantCallPayload({
      assistantId: "11111111-1111-4111-8111-111111111111",
      phoneNumberId: "22222222-2222-4222-8222-222222222222",
      leadId: "lead-123",
      conversationId: "conversation-456",
      firstName: "John",
      intent: "REFINANCE",
      goal: "LOWER_PAYMENT",
      phoneE164: "+13165550123",
    }));

    for (const forbidden of ["\"assistant\"", "\"squad\"", "\"model\"", "\"voice\"", "\"transcriber\"", "\"server\"", "\"serverMessages\"", "\"tools\""]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
