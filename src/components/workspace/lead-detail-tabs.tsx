"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

const VALID_TABS = ["overview", "timeline", "package", "calls", "conversation", "consent", "tasks", "notes"];

/** URL-backed so a tab selection survives refresh/back-forward and can be
 *  linked directly (e.g. from a notification pointing straight at Tasks). */
export function LeadDetailTabs({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const tab = requested && VALID_TABS.includes(requested) ? requested : "overview";

  function onValueChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={tab} onValueChange={onValueChange}>
      {children}
    </Tabs>
  );
}
