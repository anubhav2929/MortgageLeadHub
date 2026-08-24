import { describe, expect, it } from "vitest";
import { dateKeyInTimezone, hourInTimezone, isValidIanaTimezone, sameCalendarDay } from "@/core/timezone";

describe("timezone utilities", () => {
  it("validates IANA timezone names", () => {
    expect(isValidIanaTimezone("America/New_York")).toBe(true);
    expect(isValidIanaTimezone("not/a-zone")).toBe(false);
  });

  it("groups records by the configured calendar day", () => {
    const a = "2026-08-22T03:30:00.000Z";
    const b = "2026-08-22T05:30:00.000Z";
    expect(dateKeyInTimezone(a, "Asia/Kolkata")).toBe("2026-08-22");
    expect(sameCalendarDay(a, b, "Asia/Kolkata")).toBe(true);
    expect(sameCalendarDay(a, b, "America/New_York")).toBe(false);
  });

  it("handles DST using Intl rather than fixed offsets", () => {
    expect(hourInTimezone("2026-03-08T07:30:00Z", "America/New_York")).toBe(3);
  });
});
