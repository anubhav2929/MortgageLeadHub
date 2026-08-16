"use client";

import { UrlTabs } from "@/components/ui/url-tabs";

const VALID_TABS = [
  "overview",
  "timeline",
  "package",
  "calls",
  "conversation",
  "consent",
  "tasks",
  "notes",
] as const;

/** URL-backed so a tab selection survives refresh, back/forward, and the
 *  periodic router.refresh() the live boards perform — and so a notification
 *  can link straight at Tasks. See components/ui/url-tabs.tsx. */
export function LeadDetailTabs({ children }: { children: React.ReactNode }) {
  return (
    <UrlTabs validTabs={VALID_TABS} defaultTab="overview">
      {children}
    </UrlTabs>
  );
}
