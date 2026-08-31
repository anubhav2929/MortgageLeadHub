import { describe, expect, it } from "vitest";
import { hasUnresolvedVapiConfigurationFailure } from "@/domain/voiceOrchestrator";
import type { Database } from "@/domain/store";

function database(overrides: Partial<Database> = {}): Database {
  return {
    attempts: [],
    conversations: new Map(),
    integrationHealth: new Map(),
    ...overrides,
  } as Database;
}

const failedAttempt = {
  id: "attempt-failed",
  leadId: "lead-1",
  channel: "VOICE" as const,
  direction: "OUTBOUND" as const,
  idempotencyKey: "idem-1",
  outcome: "FAILED" as const,
  failureClass: "CONFIGURATION" as const,
  failureMessage: "Vapi rejected the request",
  attemptNumber: 1,
  scheduledFor: "2026-08-30T10:00:00.000Z",
  endedAt: "2026-08-30T10:00:05.000Z",
};

describe("Vapi configuration recovery", () => {
  it("keeps an unacknowledged latest configuration failure blocked for automation", () => {
    const db = database({ attempts: [failedAttempt] });
    expect(hasUnresolvedVapiConfigurationFailure(db, "lead-1")).toBe(true);
  });

  it("recovers after the failure is acknowledged", () => {
    const db = database({ attempts: [{ ...failedAttempt, acknowledgedAt: "2026-08-30T10:05:00.000Z" }] });
    expect(hasUnresolvedVapiConfigurationFailure(db, "lead-1")).toBe(false);
  });

  it("recovers after a newer successful Vapi verification", () => {
    const db = database({
      attempts: [failedAttempt],
      integrationHealth: new Map([["vapi", {
        integrationId: "vapi",
        ok: true,
        message: "Assistant and phone exist",
        verifiedAt: "2026-08-30T10:10:00.000Z",
        verifiedById: "admin-1",
        verifiedByName: "Admin",
      }]]),
    });
    expect(hasUnresolvedVapiConfigurationFailure(db, "lead-1")).toBe(false);
  });

  it("does not let an older verification clear a newer provider failure", () => {
    const db = database({
      attempts: [failedAttempt],
      integrationHealth: new Map([["vapi", {
        integrationId: "vapi",
        ok: true,
        message: "Assistant and phone exist",
        verifiedAt: "2026-08-30T09:00:00.000Z",
        verifiedById: "admin-1",
        verifiedByName: "Admin",
      }]]),
    });
    expect(hasUnresolvedVapiConfigurationFailure(db, "lead-1")).toBe(true);
  });
});
