"use client";

// Lightweight A/B testing infrastructure — variant assignment + measurement.
// No vendor (Optimizely/GrowthBook/etc): the app already has GA4 wired
// (components/layout/google-analytics.tsx), so exposures ride on that same
// pipe via trackEvent("ab_test_exposure") instead of standing up a second
// analytics integration.
//
// Assignment is deterministic per visitor: a random id is minted once and
// cached in localStorage, then each testKey is hashed together with that id
// to pick a variant. Same visitor always sees the same variant on repeat
// visits; different visitors split evenly across variants.
//
// SSR safety: useABVariant always returns variants[0] on the very first
// render (server and client match, so no hydration mismatch — see the
// lesson in intake-wizard.tsx's loadDraft()), then swaps to the assigned
// variant in an effect after mount. Callers should keep variants[0] as a
// perfectly reasonable default in case JS is slow or disabled.

import { useEffect, useSyncExternalStore } from "react";

const VISITOR_ID_KEY = "mlh_ab_visitor_id";

function getOrCreateVisitorId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(VISITOR_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_ID_KEY, id);
    return id;
  } catch {
    return "";
  }
}

// Simple deterministic string hash (FNV-1a) — no crypto needed, just an
// even, stable split across variants.
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function assignVariant<T extends string>(testKey: string, variantKeys: readonly T[]): T {
  if (variantKeys.length === 0) throw new Error("assignVariant requires at least one variant");
  const visitorId = getOrCreateVisitorId();
  if (!visitorId) return variantKeys[0];
  const bucket = hashString(`${visitorId}:${testKey}`) % variantKeys.length;
  return variantKeys[bucket];
}

function noopSubscribe() {
  return () => {};
}

/** Returns the assigned variant key for `testKey`, one of `variantKeys`.
 *  Fires an `ab_test_exposure` GA4 event once the real variant is known.
 *  Uses useSyncExternalStore (not useState+useEffect) so the SSR snapshot
 *  (variantKeys[0]) and the client's first read never disagree — that's
 *  what avoids the hydration mismatch a plain "read localStorage in an
 *  effect" version would hit. */
export function useABVariant<T extends string>(testKey: string, variantKeys: readonly T[]): T {
  const variant = useSyncExternalStore(
    noopSubscribe,
    () => assignVariant(testKey, variantKeys),
    () => variantKeys[0]
  );

  useEffect(() => {
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
    if (typeof gtag === "function") gtag("event", "ab_test_exposure", { test_key: testKey, variant });
  }, [testKey, variant]);

  return variant;
}
