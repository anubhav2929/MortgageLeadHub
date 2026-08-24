import type { CallbackAppointment, CallbackReminderPolicy, Officer } from "@/domain/types";
import { isValidIanaTimezone } from "@/core/timezone";

export interface CallbackSlot {
  startsAt: string;
  endsAt: string;
  borrowerLabel: string;
  officerId: string;
}

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number }

function partsInZone(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour") % 24, minute: read("minute") };
}

/** Converts a wall-clock time in an IANA zone into UTC without relying on the host timezone. */
export function zonedLocalToUtc(local: LocalParts, timeZone: string): Date | null {
  if (!isValidIanaTimezone(timeZone)) return null;
  const wallUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let candidate = new Date(wallUtc);
  for (let i = 0; i < 3; i += 1) {
    const shown = partsInZone(candidate, timeZone);
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
    candidate = new Date(candidate.getTime() + (wallUtc - shownAsUtc));
  }
  const roundTrip = partsInZone(candidate, timeZone);
  return Object.keys(local).every((key) => roundTrip[key as keyof LocalParts] === local[key as keyof LocalParts]) ? candidate : null;
}

function labelInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date);
}

function overlaps(startsAt: Date, endsAt: Date, appointment: CallbackAppointment, bufferMinutes: number): boolean {
  if (["CANCELLED", "COMPLETED"].includes(appointment.status)) return false;
  const buffer = bufferMinutes * 60_000;
  return startsAt.getTime() < new Date(appointment.endsAt).getTime() + buffer && endsAt.getTime() + buffer > new Date(appointment.startsAt).getTime();
}

export function generateCallbackSlots(input: {
  now: Date;
  adminTimezone: string;
  borrowerTimezone: string;
  officer: Officer;
  policy: CallbackReminderPolicy;
  appointments: CallbackAppointment[];
  limit?: number;
}): CallbackSlot[] {
  const { now, officer, policy } = input;
  const adminTimezone = isValidIanaTimezone(input.adminTimezone) ? input.adminTimezone : "America/Los_Angeles";
  const borrowerTimezone = isValidIanaTimezone(input.borrowerTimezone) ? input.borrowerTimezone : adminTimezone;
  const earliest = now.getTime() + policy.minimumLeadMinutes * 60_000;
  const today = partsInZone(now, adminTimezone);
  const output: CallbackSlot[] = [];
  for (let dayOffset = 0; dayOffset <= policy.bookingHorizonDays && output.length < (input.limit ?? 12); dayOffset += 1) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset));
    const year = day.getUTCFullYear();
    const month = day.getUTCMonth() + 1;
    const dayOfMonth = day.getUTCDate();
    const weekday = day.getUTCDay();
    if (weekday === 0) continue;
    for (let minute = officer.activeHoursStart * 60; minute + policy.slotDurationMinutes <= officer.activeHoursEnd * 60; minute += policy.slotDurationMinutes + policy.bufferMinutes) {
      const startsAt = zonedLocalToUtc({ year, month, day: dayOfMonth, hour: Math.floor(minute / 60), minute: minute % 60 }, adminTimezone);
      if (!startsAt || startsAt.getTime() < earliest) continue;
      const endsAt = new Date(startsAt.getTime() + policy.slotDurationMinutes * 60_000);
      if (input.appointments.some((appointment) => appointment.officerId === officer.id && overlaps(startsAt, endsAt, appointment, policy.bufferMinutes))) continue;
      output.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), borrowerLabel: labelInZone(startsAt, borrowerTimezone), officerId: officer.id });
      if (output.length >= (input.limit ?? 12)) break;
    }
  }
  return output;
}

export function renderCallbackTemplate(template: string, startsAt: string, borrowerTimezone: string): string {
  const zone = isValidIanaTimezone(borrowerTimezone) ? borrowerTimezone : "America/Los_Angeles";
  return template.replaceAll("{{localTime}}", labelInZone(new Date(startsAt), zone));
}
