"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

/**
 * Tabs whose selection lives in the URL.
 *
 * Uncontrolled tabs lose their selection on every reload, on back/forward, and
 * on any `router.refresh()` — which the live boards do on a timer, so a tab
 * could reset itself while being read. They also cannot be linked to: the
 * dashboard's blocked-automation band points at `?tab=integrations`, and
 * against uncontrolled tabs that link silently lands on whatever tab is first.
 *
 * `replace` rather than `push` so switching tabs does not stack history
 * entries — back should leave the page, not walk through every tab visited.
 * `scroll: false` so the page does not jump to the top on each switch.
 *
 * An unrecognised or absent `?tab=` falls back to the default rather than
 * rendering nothing, so a stale bookmark degrades to a working page.
 */
export function UrlTabs({
  param = "tab",
  validTabs,
  defaultTab,
  children,
}: {
  /** Query-string key. Distinct keys let two independent tab groups coexist. */
  param?: string;
  validTabs: readonly string[];
  defaultTab: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requested = searchParams.get(param);
  const tab = requested && validTabs.includes(requested) ? requested : defaultTab;

  function onValueChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(param, value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={tab} onValueChange={onValueChange}>
      {children}
    </Tabs>
  );
}
