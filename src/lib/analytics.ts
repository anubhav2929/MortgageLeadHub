"use client";

// Thin wrapper around gtag so call sites never need to null-check `window`
// or worry about GA not being configured (simulated environments, workspace
// pages, tests). Never pass name/phone/email/address here — these are
// conversion-funnel signals, not a place to leak lead PII into a third
// party's servers.
type AnalyticsEvent =
  | "intake_started"
  | "intake_step_completed"
  | "intake_submitted"
  | "calculator_used"
  | "borrower_channel_selected"
  | "ab_test_exposure";

export function trackEvent(event: AnalyticsEvent, params?: Record<string, string | number | boolean>) {
  if (typeof window === "undefined") return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== "function") return;
  gtag("event", event, params);
}
