export const DEFAULT_ADMIN_TIMEZONE = "America/Los_Angeles";

export function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

export function dateKeyInTimezone(value: Date | string, timeZone = DEFAULT_ADMIN_TIMEZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const zone = isValidIanaTimezone(timeZone) ? timeZone : DEFAULT_ADMIN_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function sameCalendarDay(a: Date | string, b: Date | string, timeZone = DEFAULT_ADMIN_TIMEZONE): boolean {
  return dateKeyInTimezone(a, timeZone) === dateKeyInTimezone(b, timeZone);
}

export function hourInTimezone(value: Date | string, timeZone: string): number | null {
  if (!isValidIanaTimezone(timeZone)) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  return hour === undefined ? null : Number(hour);
}
