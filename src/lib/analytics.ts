"use client";

import { sanitizeAnalyticsParams, type AnalyticsEvent } from "@/core/analyticsPrivacy";

// Thin wrapper around gtag so call sites never need to null-check `window`
// or worry about GA not being configured (simulated environments, workspace
// pages, tests). Never pass name/phone/email/address here — these are
// conversion-funnel signals, not a place to leak lead PII into a third
// party's servers.
export function trackEvent(event: AnalyticsEvent, params?: Record<string, string | number | boolean>) {
  if (typeof window === "undefined") return;
  if (!document.cookie.includes("mlh_analytics_consent=granted")) return;
  const safeParams = sanitizeAnalyticsParams(event, params);
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag === "function") gtag("event", event, safeParams);
  const eventId = crypto.randomUUID();
  const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
  if (typeof fbq === "function") fbq("trackCustom", event, {}, { eventID: eventId });
  void fetch("/api/analytics/event", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, eventId }), keepalive: true,
  });
}
