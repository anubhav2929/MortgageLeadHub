"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Select } from "@/components/ui/input";
import { Input } from "@/components/ui/input";
import { STATE_LABELS } from "@/core/stateMachine";
import type { LeadState } from "@/domain/types";

const ALL_STATES = Object.keys(STATE_LABELS) as LeadState[];

export function LeadFilters({
  stateCodes,
  officerNames,
  isOfficer,
  mine,
}: {
  stateCodes: string[];
  officerNames: string[];
  isOfficer?: boolean;
  mine?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  const hasFilters = ["state", "intent", "officer", "stateCode", "sla", "q"].some((k) => searchParams.get(k));

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {isOfficer && (
        <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] p-0.5">
          <button
            onClick={() => setParam("mine", "")}
            className={`h-8 rounded-[var(--radius-sm)] px-3 text-[13px] font-medium transition-colors ${
              mine ? "bg-[var(--primary)] text-white" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            My queue
          </button>
          <button
            onClick={() => setParam("mine", "false")}
            className={`h-8 rounded-[var(--radius-sm)] px-3 text-[13px] font-medium transition-colors ${
              !mine ? "bg-[var(--primary)] text-white" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            All leads
          </button>
        </div>
      )}

      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input
          placeholder="Search by name, phone, email..."
          defaultValue={searchParams.get("q") ?? ""}
          onChange={(e) => setParam("q", e.target.value)}
          className="pl-8"
        />
      </div>

      <Select value={searchParams.get("state") ?? ""} onChange={(e) => setParam("state", e.target.value)} className="w-auto min-w-36">
        <option value="">All states</option>
        {ALL_STATES.map((s) => (
          <option key={s} value={s}>
            {STATE_LABELS[s]}
          </option>
        ))}
      </Select>

      <Select value={searchParams.get("intent") ?? ""} onChange={(e) => setParam("intent", e.target.value)} className="w-auto min-w-32">
        <option value="">All intents</option>
        <option value="REFINANCE">Refinance</option>
        <option value="HOME_EQUITY">Home equity</option>
        <option value="CASH_OUT">Cash out</option>
      </Select>

      <Select value={searchParams.get("officer") ?? ""} onChange={(e) => setParam("officer", e.target.value)} className="w-auto min-w-36">
        <option value="">All assignees</option>
        <option value="unassigned">Unassigned</option>
        {officerNames.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>

      <Select value={searchParams.get("stateCode") ?? ""} onChange={(e) => setParam("stateCode", e.target.value)} className="w-auto min-w-28">
        <option value="">All US states</option>
        {stateCodes.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>

      <button
        onClick={() => setParam("sla", searchParams.get("sla") === "breached" ? "" : "breached")}
        className={`focus-ring h-9 rounded-[var(--radius-md)] border px-3 text-[13px] font-medium transition-colors ${
          searchParams.get("sla") === "breached"
            ? "border-[var(--danger-border)] bg-[var(--danger-tint)] text-[var(--danger)]"
            : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--background)]"
        }`}
      >
        SLA breached
      </button>

      {hasFilters && (
        <button
          onClick={() => router.push(pathname)}
          className="focus-ring flex items-center gap-1 rounded-[var(--radius-md)] px-2.5 py-2 text-[13px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
