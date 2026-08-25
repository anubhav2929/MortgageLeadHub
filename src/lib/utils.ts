import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DEFAULT_ADMIN_TIMEZONE, isValidIanaTimezone } from "@/core/timezone";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(d: Date | string, timeZone = DEFAULT_ADMIN_TIMEZONE) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: isValidIanaTimezone(timeZone) ? timeZone : DEFAULT_ADMIN_TIMEZONE });
}

export function formatDateTime(d: Date | string, timeZone = DEFAULT_ADMIN_TIMEZONE) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: isValidIanaTimezone(timeZone) ? timeZone : DEFAULT_ADMIN_TIMEZONE,
    timeZoneName: "short",
  });
}

export function formatRelative(d: Date | string, now: Date = new Date()) {
  const date = typeof d === "string" ? new Date(d) : d;
  const diffMs = date.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const abs = Math.abs(diffMin);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  return rtf.format(diffDay, "day");
}

export function initials(first: string, last: string) {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

export function titleCase(s: string) {
  if (s === "DEBT_CONSOLIDATION") return "Simplify monthly payments";
  return s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
