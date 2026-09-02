import { describe, expect, it } from "vitest";
import { selectLeadForInboundSms } from "@/domain/inboundSms";
import type { ContactAttempt, Lead, Person } from "@/domain/types";

function match(id: string, createdAt: string, state: Lead["state"] = "NEW") {
  return {
    lead: { id, createdAt, state } as Lead,
    person: { id: `person-${id}`, leadId: id, role: "PRIMARY" } as Person,
  };
}

function sms(leadId: string, at: string, outcome: ContactAttempt["outcome"] = "DELIVERED") {
  return {
    id: `attempt-${leadId}-${at}`,
    leadId,
    channel: "SMS",
    direction: "OUTBOUND",
    outcome,
    scheduledFor: at,
  } as ContactAttempt;
}

describe("inbound SMS lead routing", () => {
  it("attaches a reply to the inquiry that most recently texted the number", () => {
    const matches = [match("older", "2026-01-01T00:00:00Z"), match("newer", "2026-08-01T00:00:00Z")];
    const selected = selectLeadForInboundSms(matches, [
      sms("newer", "2026-08-01T00:00:00Z"),
      sms("older", "2026-09-01T00:00:00Z"),
    ]);
    expect(selected?.lead.id).toBe("older");
  });

  it("falls back to the newest non-terminal inquiry", () => {
    const matches = [
      match("closed-newer", "2026-09-01T00:00:00Z", "CLOSED_LOST"),
      match("active", "2026-08-01T00:00:00Z"),
    ];
    expect(selectLeadForInboundSms(matches, [])?.lead.id).toBe("active");
  });

  it("ignores failed outbound texts as a routing signal", () => {
    const matches = [match("older", "2026-01-01T00:00:00Z"), match("newer", "2026-08-01T00:00:00Z")];
    expect(selectLeadForInboundSms(matches, [sms("older", "2026-09-01T00:00:00Z", "FAILED")])?.lead.id).toBe("newer");
  });
});
