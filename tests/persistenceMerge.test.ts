import { describe, expect, it } from "vitest";
import { mergeSerializedSnapshots } from "@/domain/persistence";

function snapshot(conversations: [string, Record<string, unknown>][] = []) {
  return {
    leads: [],
    conversations,
    events: [],
  } as Record<string, unknown>;
}

describe("serverless snapshot merge", () => {
  it("preserves records committed by another instance", () => {
    const base = snapshot();
    const current = { ...snapshot(), leads: [["lead-a", { id: "lead-a", state: "NEW" }]] };
    const latest = { ...snapshot(), leads: [["lead-b", { id: "lead-b", state: "NEW" }]] };

    const merged = mergeSerializedSnapshots(base, current, latest);
    expect(Array.from(new Map(merged.leads as [string, unknown][]).keys())).toEqual(expect.arrayContaining(["lead-a", "lead-b"]));
  });

  it("combines independent updates to the same call", () => {
    const original = { id: "call-1", status: "IN_PROGRESS", callStatus: "RINGING", transcript: [] };
    const base = snapshot([["call-1", original]]);
    const current = snapshot([["call-1", { ...original, callStatus: "IN_PROGRESS" }]]);
    const latest = snapshot([["call-1", { ...original, providerCallId: "vapi-1" }]]);

    const merged = mergeSerializedSnapshots(base, current, latest);
    expect(new Map(merged.conversations as [string, Record<string, unknown>][]).get("call-1")).toMatchObject({
      callStatus: "IN_PROGRESS",
      providerCallId: "vapi-1",
    });
  });

  it("combines distinct live transcript events without duplicates", () => {
    const original = { id: "call-1", transcript: [] };
    const base = snapshot([["call-1", original]]);
    const current = snapshot([["call-1", {
      ...original,
      transcript: [{ turn: 1, role: "AGENT", text: "Hello", at: "2026-09-02T10:00:01Z", providerEventId: "evt-a" }],
    }]]);
    const latest = snapshot([["call-1", {
      ...original,
      transcript: [{ turn: 1, role: "BORROWER", text: "Hi", at: "2026-09-02T10:00:02Z", providerEventId: "evt-b" }],
    }]]);

    const merged = mergeSerializedSnapshots(base, current, latest);
    const conversation = new Map(merged.conversations as [string, Record<string, unknown>][]).get("call-1")!;
    expect((conversation.transcript as Array<{ providerEventId: string }>).map((turn) => turn.providerEventId)).toEqual(["evt-a", "evt-b"]);
  });

  it("does not let a late live event overwrite the final Vapi artifact", () => {
    const original = { id: "call-1", transcript: [] };
    const base = snapshot([["call-1", original]]);
    const current = snapshot([["call-1", {
      ...original,
      transcriptSource: "LIVE_EVENTS",
      transcript: [{ turn: 1, role: "AGENT", text: "Partial", at: "2026-09-02T10:00:01Z", providerEventId: "evt-a" }],
    }]]);
    const latest = snapshot([["call-1", {
      ...original,
      transcriptSource: "VAPI_ARTIFACT",
      transcript: [{ turn: 1, role: "AGENT", text: "Complete", at: "2026-09-02T10:00:01Z", providerEventId: "vapi-message:0" }],
    }]]);

    const merged = mergeSerializedSnapshots(base, current, latest);
    const conversation = new Map(merged.conversations as [string, Record<string, unknown>][]).get("call-1")!;
    expect(conversation.transcriptSource).toBe("VAPI_ARTIFACT");
    expect(conversation.transcript).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Complete" })]));
    expect(conversation.transcript).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: "Partial" })]));
  });
});
