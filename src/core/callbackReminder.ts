import type { CallbackAppointment } from "@/domain/types";

export function callbackMessageEligibility(
  appointment: CallbackAppointment,
  kind: "confirmation" | "reminder",
  now = new Date(),
): { allowed: true } | { allowed: false; reason: string } {
  if (["CANCELLED", "COMPLETED", "MISSED"].includes(appointment.status)) {
    return { allowed: false, reason: `Appointment is ${appointment.status.toLowerCase()}` };
  }
  if (kind === "reminder" && now.getTime() >= new Date(appointment.startsAt).getTime()) {
    return { allowed: false, reason: "Callback already started" };
  }
  return { allowed: true };
}
