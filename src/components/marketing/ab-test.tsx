"use client";

import type { ReactNode } from "react";
import { useABVariant } from "@/lib/abtest";

/** Wraps two (or more) copy variants for a page section. Renders one based
 *  on a deterministic per-visitor assignment and reports the exposure to
 *  GA4 — see lib/abtest.ts for how assignment and measurement work. */
export function ABTest<T extends string>({ testKey, variants }: { testKey: string; variants: Record<T, ReactNode> }) {
  const keys = Object.keys(variants) as T[];
  const variant = useABVariant(testKey, keys);
  return <>{variants[variant]}</>;
}
