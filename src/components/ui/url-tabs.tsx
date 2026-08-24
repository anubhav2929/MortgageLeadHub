"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition } from "react";
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
  const [isPending, startTransition] = useTransition();

  const requested = searchParams.get(param);
  const resolvedTab = requested && validTabs.includes(requested) ? requested : defaultTab;
  const [tab, setOptimisticTab] = useOptimistic(resolvedTab);

  function onValueChange(value: string) {
    if (value === resolvedTab && !isPending) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set(param, value);
    startTransition(() => {
      setOptimisticTab(value);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="relative" aria-busy={isPending}>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden transition-opacity ${isPending ? "opacity-100" : "opacity-0"}`}
      >
        <div className="h-full w-1/3 animate-[tab-progress_0.9s_ease-in-out_infinite] rounded-full bg-[var(--primary)]" />
      </div>
      <span className="sr-only" aria-live="polite">{isPending ? `Loading ${tab} tab` : ""}</span>
      <Tabs value={tab} onValueChange={onValueChange} pending={isPending}>
        {children}
      </Tabs>
    </div>
  );
}
