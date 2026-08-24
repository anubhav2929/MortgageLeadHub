import { describe, expect, it } from "vitest";
import { callbackMessageEligibility } from "@/core/callbackReminder";
import type { CallbackAppointment } from "@/domain/types";

const appointment: CallbackAppointment = {
  id: "callback_1", leadId: "lead_1", startsAt: "2026-08-24T18:00:00.000Z", endsAt: "2026-08-24T18:30:00.000Z",
  borrowerTimezone: "America/Los_Angeles", status: "BOOKED", consentRecordId: "consent_1",
  createdAt: "2026-08-24T16:00:00.000Z", updatedAt: "2026-08-24T16:00:00.000Z", providerCorrelationIds: [],
};

describe("callback message selection", () => {
  it("allows a reminder before the callback", () => {
    expect(callbackMessageEligibility(appointment, "reminder", new Date("2026-08-24T17:45:00.000Z"))).toEqual({ allowed: true });
  });

  it("suppresses a late reminder", () => {
    expect(callbackMessageEligibility(appointment, "reminder", new Date("2026-08-24T18:00:00.000Z"))).toEqual({ allowed: false, reason: "Callback already started" });
  });

  it("suppresses both messages for a cancelled appointment", () => {
    expect(callbackMessageEligibility({ ...appointment, status: "CANCELLED" }, "confirmation")).toEqual({ allowed: false, reason: "Appointment is cancelled" });
  });
});
