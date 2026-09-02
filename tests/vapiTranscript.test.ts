import { describe, expect, it } from "vitest";
import { reconcileVapiTranscript, turnsFromVapiMessages, turnsFromVapiTranscript } from "@/core/vapiTranscript";

describe("Vapi transcript normalization", () => {
  const startedAt = "2026-09-02T10:00:00.000Z";
  const endedAt = "2026-09-02T10:01:00.000Z";

  it("keeps only spoken assistant and borrower messages with stable identities", () => {
    const result = turnsFromVapiMessages([
      { role: "system", message: "internal prompt" },
      { role: "assistant", message: "Hello", secondsFromStart: 1 },
      { role: "user", message: "Hi", secondsFromStart: 3 },
      { role: "tool", message: "{}" },
    ], startedAt, endedAt);
    expect(result.turns.map(({ role, text, providerEventId }) => ({ role, text, providerEventId }))).toEqual([
      { role: "AGENT", text: "Hello", providerEventId: "vapi-message:1" },
      { role: "BORROWER", text: "Hi", providerEventId: "vapi-message:2" },
    ]);
    expect(result.turns[0].at).toBe("2026-09-02T10:00:01.000Z");
  });

  it("replaces a partial live transcript with the complete final artifact", () => {
    const result = reconcileVapiTranscript({
      current: [{ turn: 1, role: "AGENT", text: "Hello", at: startedAt, providerEventId: "event-1" }],
      messages: [
        { role: "assistant", message: "Hello", time: 1 },
        { role: "user", message: "I would like to refinance", time: 4 },
      ],
      startedAt,
      at: endedAt,
    });
    expect(result.authoritative).toBe(true);
    expect(result.turns).toHaveLength(2);
    expect(result.turns[1]).toMatchObject({ role: "BORROWER", text: "I would like to refinance" });
  });

  it("preserves speaker roles from the concatenated transcript fallback", () => {
    const result = turnsFromVapiTranscript("AI: Welcome\nUser: Thank you", endedAt);
    expect(result.turns.map((turn) => turn.role)).toEqual(["AGENT", "BORROWER"]);
  });
});
