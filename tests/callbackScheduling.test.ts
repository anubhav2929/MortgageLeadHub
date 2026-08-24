import { describe, expect, it } from "vitest";
import { generateCallbackSlots, zonedLocalToUtc } from "@/core/callbackScheduling";
import type { Officer } from "@/domain/types";

const officer: Officer = {
  id: "off", userId: "user", name: "Officer", email: "o@example.com", nmlsId: "1", licensedStates: ["CA"],
  productTypes: ["REFINANCE"], dailyCapacity: 10, currentLoad: 0, activeHoursStart: 9, activeHoursEnd: 17, isActive: true,
};

describe("callback scheduling", () => {
  it("rejects a nonexistent DST wall-clock time", () => {
    expect(zonedLocalToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York")).toBeNull();
  });

  it("applies lead time, duration, buffer, horizon, and borrower timezone labels", () => {
    const slots = generateCallbackSlots({
      now: new Date("2026-08-24T15:00:00Z"), adminTimezone: "America/Los_Angeles", borrowerTimezone: "America/New_York",
      officer, policy: { slotDurationMinutes: 30, bufferMinutes: 10, minimumLeadMinutes: 30, bookingHorizonDays: 14, reminderMinutesBefore: 15, confirmationTemplate: "{{localTime}}", reminderTemplate: "{{localTime}}" },
      appointments: [], limit: 3,
    });
    expect(slots).toHaveLength(3);
    expect(new Date(slots[0].startsAt).getTime()).toBeGreaterThanOrEqual(new Date("2026-08-24T15:30:00Z").getTime());
    expect(new Date(slots[0].endsAt).getTime() - new Date(slots[0].startsAt).getTime()).toBe(30 * 60_000);
    expect(slots[0].borrowerLabel).toMatch(/EDT/);
  });
});
