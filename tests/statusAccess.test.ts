import { describe, expect, it } from "vitest";
import { issueStatusToken, matchesStatusToken } from "@/domain/statusAccess";
import type { Lead } from "@/domain/types";

function lead(): Lead {
  return {
    id: "lead_1", publicRef: "REF123", state: "NEW", intent: "REFINANCE", goal: "LOWER_PAYMENT",
    timeline: "ASAP", creditRange: "UNSURE", sourceId: "test", stateCode: "CA", occupancy: "PRIMARY",
    cadencePlanVersionId: "default", slaDueAt: new Date(0).toISOString(), completenessScore: 0,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), attemptsToday: 0,
    attemptsTotal: 0,
  };
}

describe("borrower status access", () => {
  it("stores only a digest and accepts the issued token", () => {
    const target = lead();
    const token = issueStatusToken(target);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(target.statusTokenHash).not.toBe(token);
    expect(matchesStatusToken(target, token)).toBe(true);
    expect(matchesStatusToken(target, `${token}x`)).toBe(false);
  });

  it("revokes the previous token when rotated", () => {
    const target = lead();
    const first = issueStatusToken(target);
    const second = issueStatusToken(target);
    expect(matchesStatusToken(target, first)).toBe(false);
    expect(matchesStatusToken(target, second)).toBe(true);
  });
});
