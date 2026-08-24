import { describe, expect, it } from "vitest";
import { toVapiControlPayload } from "@/adapters/vapiCallControl";

describe("Vapi warm transfer control", () => {
  it("waits for the operator and delivers the approved summary before bridge", () => {
    expect(toVapiControlPayload({ type: "TRANSFER", toNumberE164: "+14155550100", sayFirst: "Please hold", operatorMessage: "Approved summary" })).toEqual({
      type: "transfer",
      destination: { type: "number", number: "+14155550100", transferPlan: { mode: "warm-transfer-wait-for-operator-to-speak-first-and-then-say-message", message: "Approved summary", timeout: 20 } },
      content: "Please hold",
    });
  });
});
