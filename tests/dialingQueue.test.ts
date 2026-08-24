import { describe, expect, it } from "vitest";
import { callItemHasSettled, dialingSessionProgress, nextPendingDialItem } from "@/core/dialingQueue";
import type { DialingQueueItem, DialingSession } from "@/domain/types";

const session: DialingSession = {
  id: "session_1", name: "Morning list", mode: "MANUAL_NEXT", status: "ACTIVE",
  createdById: "user_1", createdByName: "Officer", createdAt: "2026-08-24T00:00:00Z", updatedAt: "2026-08-24T00:00:00Z",
};

const item = (id: string, position: number, status: DialingQueueItem["status"]): DialingQueueItem => ({
  id, sessionId: session.id, leadId: `lead_${id}`, position, status,
});

describe("back-to-back dialing queue", () => {
  it("selects the earliest pending lead and never jumps ahead", () => {
    const items = [item("third", 2, "PENDING"), item("first", 0, "COMPLETED"), item("second", 1, "PENDING")];
    expect(nextPendingDialItem(session, items)?.id).toBe("second");
  });

  it("waits while a call is queued/ringing and advances only after settlement", () => {
    expect(callItemHasSettled("QUEUED", "RINGING")).toBe(false);
    expect(callItemHasSettled("ANSWERED", "CONNECTED")).toBe(false);
    expect(callItemHasSettled("ANSWERED", "ENDED")).toBe(true);
    expect(callItemHasSettled("NO_ANSWER")).toBe(true);
  });

  it("counts blocked, failed, and skipped records as settled without hiding them", () => {
    expect(dialingSessionProgress([item("a", 0, "BLOCKED"), item("b", 1, "FAILED"), item("c", 2, "PENDING")])).toEqual({ completed: 2, total: 3, remaining: 1 });
  });
});
