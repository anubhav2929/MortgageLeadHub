"use client";

import { useEffect, useState } from "react";

const CONSENT_COOKIE = "mlh_analytics_consent";
type MetaPixelFunction = ((...args: unknown[]) => void) & { queue: unknown[][]; loaded: boolean; version: string };

function readConsent(): "granted" | "denied" | null {
  if (typeof document === "undefined") return null;
  const value = document.cookie.split("; ").find((item) => item.startsWith(`${CONSENT_COOKIE}=`))?.split("=")[1];
  return value === "granted" || value === "denied" ? value : null;
}

export function GoogleAnalytics({ measurementId, metaPixelId }: { measurementId?: string; metaPixelId?: string }) {
  const [consent, setConsent] = useState<"granted" | "denied" | null>(() => readConsent());

  useEffect(() => {
    if (consent !== "granted") return;
    if (measurementId && /^G-[A-Z0-9]+$/.test(measurementId)) {
      const host = window as unknown as { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
      host.dataLayer ??= [];
      host.gtag = (...args: unknown[]) => host.dataLayer!.push(args);
      host.gtag("consent", "update", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
      host.gtag("js", new Date());
      host.gtag("config", measurementId, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      document.head.appendChild(script);
    }
    if (metaPixelId && /^\d{5,30}$/.test(metaPixelId)) {
      const host = window as unknown as { fbq?: MetaPixelFunction };
      if (!host.fbq) {
        const queue: unknown[][] = [];
        const fbq = ((...args: unknown[]) => { queue.push(args); }) as unknown as MetaPixelFunction;
        fbq.queue = queue;
        fbq.loaded = true;
        fbq.version = "2.0";
        host.fbq = fbq;
        const script = document.createElement("script");
        script.async = true;
        script.src = "https://connect.facebook.net/en_US/fbevents.js";
        document.head.appendChild(script);
      }
      host.fbq!("init", metaPixelId);
      host.fbq!("track", "PageView", {}, { eventID: crypto.randomUUID() });
    }
  }, [consent, measurementId, metaPixelId]);

  function choose(value: "granted" | "denied") {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    setConsent(value);
  }

  if (consent !== null) return null;
  return (
    <aside className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl" aria-label="Analytics consent">
      <p className="text-sm font-medium text-[var(--foreground)]">Optional analytics</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
        Allow privacy-limited Google and Meta analytics to help us understand generic funnel usage. We do not send contact, property, mortgage, credit, transcript, or qualification data.
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => choose("granted")} className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white">Allow analytics</button>
        <button type="button" onClick={() => choose("denied")} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)]">Decline</button>
      </div>
    </aside>
  );
}
