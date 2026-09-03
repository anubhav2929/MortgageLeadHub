"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export interface DiscoveryFilterValues {
  q: string;
  status: string;
  intent: string;
  urgency: string;
  source: string;
  sort: string;
}

export function DiscoveryFilters({ values }: { values: DiscoveryFilterValues }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: keyof DiscoveryFilterValues, value: string, defaultValue = "") {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== defaultValue) params.set(key, value);
    else params.delete(key);
    router.replace(params.size ? `${pathname}?${params.toString()}` : pathname);
  }

  const filtered = Object.entries(values).some(([key, value]) => value && !((key === "sort" && value === "priority") || (key === "status" && value === "all")));

  return (
    <div className="mb-5 grid gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3 sm:grid-cols-2 xl:grid-cols-7">
      <label className="relative sm:col-span-2 xl:col-span-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input
          defaultValue={values.q}
          placeholder="Search posts, authors, keywords…"
          className="pl-9"
          onKeyDown={(event) => {
            if (event.key === "Enter") setParam("q", event.currentTarget.value.trim());
          }}
          onBlur={(event) => setParam("q", event.currentTarget.value.trim())}
        />
      </label>
      <Select value={values.status} onChange={(event) => setParam("status", event.target.value, "all")} aria-label="Filter by status">
        <option value="all">All statuses</option>
        <option value="NEW">Awaiting review</option>
        <option value="REVIEWED">Reviewed</option>
        <option value="ACTIONED">Actioned</option>
        <option value="DISMISSED">Dismissed</option>
      </Select>
      <Select value={values.intent} onChange={(event) => setParam("intent", event.target.value)} aria-label="Filter by intent">
        <option value="">All intents</option>
        <option value="REFINANCE">Refinance</option>
        <option value="CASH_OUT">Cash out</option>
        <option value="HOME_EQUITY">Home equity</option>
        <option value="UNKNOWN">Unknown</option>
      </Select>
      <Select value={values.urgency} onChange={(event) => setParam("urgency", event.target.value)} aria-label="Filter by urgency">
        <option value="">All urgency</option>
        <option value="IMMEDIATE">Acting now</option>
        <option value="WEEKS">Next few weeks</option>
        <option value="RESEARCHING">Researching</option>
        <option value="UNKNOWN">Unknown</option>
      </Select>
      <div className="flex gap-2">
        <Select value={values.sort} onChange={(event) => setParam("sort", event.target.value, "priority")} aria-label="Sort signals">
          <option value="priority">Priority</option>
          <option value="confidence">Confidence</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </Select>
        {filtered && (
          <Button variant="ghost" size="sm" title="Clear filters" onClick={() => router.replace(pathname)}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <Select value={values.source} onChange={(event) => setParam("source", event.target.value)} aria-label="Filter by source">
        <option value="">All sources</option>
        <option value="REDDIT">Reddit</option>
        <option value="FORUM">Forums</option>
      </Select>
    </div>
  );
}
