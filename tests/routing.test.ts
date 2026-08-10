import { describe, expect, it } from "vitest";
import { isEligible, selectOfficer, type RoutingInput } from "@/core/routing";
import { resolveCadence } from "@/core/cadence";
import type { CadencePlan, Officer } from "@/domain/types";

// Assignment has a hard constraint (state licensing) and a soft one (fair
// load distribution). The hard constraint is a legal one — assigning a lead
// to an officer not licensed in the property's state is an unlicensed
// origination, not a UX annoyance — so it is tested first and separately.

function officer(overrides: Partial<Officer> = {}): Officer {
  return {
    id: "off1",
    userId: "user_off1",
    name: "Marcus Chen",
    email: "marcus@equityflowgroup.com",
    nmlsId: "1234567",
    licensedStates: ["FL", "TX"],
    productTypes: ["REFINANCE", "CASH_OUT"],
    dailyCapacity: 10,
    currentLoad: 0,
    activeHoursStart: 9,
    activeHoursEnd: 18,
    isActive: true,
    ...overrides,
  };
}

function routing(overrides: Partial<RoutingInput> = {}): RoutingInput {
  return {
    propertyStateCode: "FL",
    intent: "REFINANCE",
    nowLocalHour: 12,
    lastAssignedAtByOfficer: {},
    ...overrides,
  };
}

describe("isEligible — hard constraints", () => {
  it("accepts a licensed, available officer", () => {
    expect(isEligible(officer(), routing())).toBe(true);
  });

  it("rejects an officer not licensed in the property's state", () => {
    expect(isEligible(officer({ licensedStates: ["TX"] }), routing({ propertyStateCode: "FL" }))).toBe(false);
  });

  it("rejects an officer who doesn't handle the product", () => {
    expect(isEligible(officer({ productTypes: ["HOME_EQUITY"] }), routing({ intent: "REFINANCE" }))).toBe(false);
  });

  it("rejects a deactivated officer", () => {
    expect(isEligible(officer({ isActive: false }), routing())).toBe(false);
  });

  it("rejects an officer at capacity", () => {
    expect(isEligible(officer({ currentLoad: 10, dailyCapacity: 10 }), routing())).toBe(false);
  });

  it("accepts an officer one below capacity", () => {
    expect(isEligible(officer({ currentLoad: 9, dailyCapacity: 10 }), routing())).toBe(true);
  });

  it("treats active hours as start-inclusive and end-exclusive", () => {
    const o = officer({ activeHoursStart: 9, activeHoursEnd: 18 });
    expect(isEligible(o, routing({ nowLocalHour: 9 }))).toBe(true);
    expect(isEligible(o, routing({ nowLocalHour: 17 }))).toBe(true);
    expect(isEligible(o, routing({ nowLocalHour: 18 }))).toBe(false);
    expect(isEligible(o, routing({ nowLocalHour: 8 }))).toBe(false);
  });
});

describe("selectOfficer — fairness", () => {
  it("returns null when nobody is eligible rather than assigning anyway", () => {
    // Falling back to "any officer" here would be an unlicensed assignment.
    expect(selectOfficer([officer({ licensedStates: ["CA"] })], routing())).toBeNull();
    expect(selectOfficer([], routing())).toBeNull();
  });

  it("prefers the least-loaded officer", () => {
    const chosen = selectOfficer(
      [officer({ id: "busy", currentLoad: 5 }), officer({ id: "free", currentLoad: 1 })],
      routing()
    );
    expect(chosen?.id).toBe("free");
  });

  it("breaks a load tie by who has waited longest for a lead", () => {
    const chosen = selectOfficer(
      [officer({ id: "recent" }), officer({ id: "waiting" })],
      routing({ lastAssignedAtByOfficer: { recent: 5_000, waiting: 1_000 } })
    );
    expect(chosen?.id).toBe("waiting");
  });

  it("treats a never-assigned officer as having waited longest", () => {
    const chosen = selectOfficer(
      [officer({ id: "recent" }), officer({ id: "brand-new" })],
      routing({ lastAssignedAtByOfficer: { recent: 5_000 } })
    );
    expect(chosen?.id).toBe("brand-new");
  });

  it("is deterministic when load and wait are identical", () => {
    const officers = [officer({ id: "b" }), officer({ id: "a" })];
    expect(selectOfficer(officers, routing())?.id).toBe("a");
    expect(selectOfficer([...officers].reverse(), routing())?.id).toBe("a");
  });

  it("does not mutate the officer list it was given", () => {
    const officers = [officer({ id: "b", currentLoad: 3 }), officer({ id: "a", currentLoad: 1 })];
    selectOfficer(officers, routing());
    expect(officers.map((o) => o.id)).toEqual(["b", "a"]);
  });
});

describe("resolveCadence — most-specific match wins", () => {
  function plan(overrides: Partial<CadencePlan> = {}): CadencePlan {
    return { id: "p", name: "Plan", steps: [], isDefault: false, ...overrides } as CadencePlan;
  }

  const match = { sourceId: "src1", stateCode: "FL", intent: "REFINANCE" as const };

  it("prefers a source-specific plan over a state-specific one", () => {
    const chosen = resolveCadence([plan({ id: "state", stateCode: "FL" }), plan({ id: "source", sourceId: "src1" })], match);
    expect(chosen.id).toBe("source");
  });

  it("prefers a state match over an intent-only match", () => {
    const chosen = resolveCadence([plan({ id: "intent", intent: "REFINANCE" }), plan({ id: "state", stateCode: "FL" })], match);
    expect(chosen.id).toBe("state");
  });

  it("falls back to the default plan when nothing matches", () => {
    const chosen = resolveCadence(
      [plan({ id: "other", stateCode: "CA" }), plan({ id: "fallback", isDefault: true })],
      match
    );
    expect(chosen.id).toBe("fallback");
  });

  it("still returns a plan when nothing matches and none is marked default", () => {
    // A lead must always get a cadence; returning undefined would strand it.
    const chosen = resolveCadence([plan({ id: "only", stateCode: "CA" })], match);
    expect(chosen.id).toBe("only");
  });

  it("breaks a specificity tie deterministically by id", () => {
    const chosen = resolveCadence([plan({ id: "zz", stateCode: "FL" }), plan({ id: "aa", stateCode: "FL" })], match);
    expect(chosen.id).toBe("aa");
  });
});
