"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { AlertCircle, ArrowDown, ArrowUp, Flame, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { assignOfficerAction, deleteLeadAction } from "@/domain/actions";
import { STATE_LABELS, STATE_TONE } from "@/core/stateMachine";
import { formatRelative } from "@/lib/utils";
import type { LeadListItem } from "@/domain/queries";
import type { Officer } from "@/domain/types";

type SortKey = "name" | "sla" | "completeness" | "created";

function SortHeader({ label, sortKey }: { label: string; sortKey: SortKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSort = searchParams.get("sort");
  const activeDir = searchParams.get("dir") === "asc" ? "asc" : "desc";
  const active = activeSort === sortKey;

  function onClick() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", sortKey);
    params.set("dir", active && activeDir === "desc" ? "asc" : "desc");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <button onClick={onClick} className="focus-ring flex items-center gap-1 text-left hover:text-[var(--foreground)]">
      {label}
      {active && (activeDir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
    </button>
  );
}

function SlaCell({ lead }: { lead: LeadListItem }) {
  const terminal = ["ACKNOWLEDGED", "SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"].includes(lead.state);
  if (terminal) return <span className="text-[13px] text-[var(--muted-foreground)]">—</span>;
  // Based on whether the due timestamp itself has passed, not the narrower
  // `slaBreached` flag (which only tracks first-contact SLA and stops
  // applying once any contact attempt has been made) — this column is a
  // general due-date proximity indicator, so it should stay honest about a
  // lead whose SLA date is in the past even if that flag has gone quiet.
  const overdue = lead.minutesToSla < 0;
  return (
    <span className={`text-[13px] ${overdue ? "font-medium text-[var(--danger)]" : "text-[var(--muted-foreground)]"}`}>
      {overdue ? "Overdue " : "Due "}
      {formatRelative(lead.slaDueAt)}
    </span>
  );
}

function BulkActionBar({
  selectedIds,
  officers,
  canDelete,
  onDone,
}: {
  selectedIds: string[];
  officers: Officer[];
  canDelete: boolean;
  onDone: () => void;
}) {
  const [officerId, setOfficerId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();

  function removeSelected() {
    startTransition(async () => {
      const results = await Promise.all(selectedIds.map((publicRef) => deleteLeadAction(publicRef)));
      const failed = results.filter((r) => !r.ok).length;
      push({
        title:
          failed === 0
            ? `Deleted ${results.length} lead${results.length === 1 ? "" : "s"}.`
            : `${results.length - failed} deleted, ${failed} failed.`,
        tone: failed === 0 ? "success" : "danger",
      });
      setConfirmDelete(false);
      onDone();
    });
  }

  function assign() {
    if (!officerId) return;
    startTransition(async () => {
      const results = await Promise.all(selectedIds.map((publicRef) => assignOfficerAction(publicRef, officerId)));
      const failed = results.filter((r) => !r.ok).length;
      push({
        title: failed === 0 ? `Assigned ${results.length} lead${results.length === 1 ? "" : "s"}.` : `${results.length - failed} assigned, ${failed} failed.`,
        tone: failed === 0 ? "success" : "danger",
      });
      onDone();
    });
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--primary-tint)] px-3.5 py-2.5">
      <span className="text-[13px] font-medium text-[var(--foreground)]">{selectedIds.length} selected</span>
      <Select value={officerId} onChange={(e) => setOfficerId(e.target.value)} className="h-8 w-auto min-w-40 text-[13px]">
        <option value="">Assign to officer…</option>
        {officers.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      <Button size="sm" className="h-8" loading={isPending} disabled={!officerId} onClick={assign}>
        Assign
      </Button>
      {canDelete &&
        (confirmDelete ? (
          <span className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--danger-tint)] px-2 py-1">
            <span className="text-[13px] font-medium text-[var(--foreground)]">
              Delete {selectedIds.length} permanently?
            </span>
            <Button variant="danger" size="sm" className="h-7" loading={isPending} onClick={removeSelected}>
              Yes, delete
            </Button>
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button variant="outlineDanger" size="sm" className="h-8" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        ))}
      <button onClick={onDone} className="focus-ring ml-auto flex items-center gap-1 text-[13px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
        <X className="h-3.5 w-3.5" /> Clear
      </button>
    </div>
  );
}

export function LeadTable({ leads, isAdmin, officers }: { leads: LeadListItem[]; isAdmin?: boolean; officers?: Officer[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const router = useRouter();
  const canBulkAssign = isAdmin && officers && officers.length > 0;

  function toggle(publicRef: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(publicRef)) next.delete(publicRef);
      else next.add(publicRef);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === leads.length ? new Set() : new Set(leads.map((l) => l.publicRef))));
  }

  function clearSelection() {
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div>
      {canBulkAssign && selected.size > 0 && (
        <BulkActionBar
          selectedIds={Array.from(selected)}
          officers={officers}
          canDelete={Boolean(isAdmin)}
          onDone={clearSelection}
        />
      )}
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
        {/* Desktop / tablet: full grid table */}
        <div className="hidden sm:block">
          <div
            className={`grid ${canBulkAssign ? "grid-cols-[auto_1.5fr_0.9fr_0.7fr_1fr_0.9fr_1fr]" : "grid-cols-[1.5fr_0.9fr_0.7fr_1fr_0.9fr_1fr]"} gap-3 border-b border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]`}
          >
            {canBulkAssign && (
              <input
                type="checkbox"
                checked={selected.size === leads.length && leads.length > 0}
                onChange={toggleAll}
                aria-label="Select all leads"
                className="h-3.5 w-3.5"
              />
            )}
            <SortHeader label="Borrower" sortKey="name" />
            <span>State</span>
            <span>Intent</span>
            <span>Assignee</span>
            <SortHeader label="Completeness" sortKey="completeness" />
            <SortHeader label="SLA" sortKey="sla" />
          </div>
          <div>
            {leads.map((lead, i) => (
              <motion.div key={lead.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(i * 0.025, 0.3) }}>
                <div
                  className={`grid ${canBulkAssign ? "grid-cols-[auto_1.5fr_0.9fr_0.7fr_1fr_0.9fr_1fr]" : "grid-cols-[1.5fr_0.9fr_0.7fr_1fr_0.9fr_1fr]"} items-center gap-3 border-b border-[var(--border)] px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-[var(--background)]`}
                >
                  {canBulkAssign && (
                    <input
                      type="checkbox"
                      checked={selected.has(lead.publicRef)}
                      onChange={() => toggle(lead.publicRef)}
                      aria-label={`Select ${lead.fullName}`}
                      className="h-3.5 w-3.5"
                    />
                  )}
                  <Link href={`/workspace/leads/${lead.publicRef}`} className="contents">
                    <span className="flex min-w-0 items-center gap-2">
                      {lead.slaBreached && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[var(--danger)]" />}
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[var(--foreground)]">{lead.fullName}</span>
                        <span className="block truncate text-xs text-[var(--muted-foreground)]">
                          {lead.city}, {lead.stateCode}
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Badge tone={STATE_TONE[lead.state]}>{STATE_LABELS[lead.state]}</Badge>
                      {lead.qualityTier === "HOT" && (
                        <span className="flex items-center gap-0.5 text-xs font-medium text-[var(--danger)]" title={`Quality score ${lead.qualityScore}/100`}>
                          <Flame className="h-3 w-3" /> {lead.qualityScore}
                        </span>
                      )}
                    </span>
                    <span className="text-[13px] text-[var(--muted)]">{lead.intent.replace("_", " ")}</span>
                    <span className="truncate text-[13px] text-[var(--muted)]">{lead.officerName ?? "Unassigned"}</span>
                    <span className="flex items-center gap-2">
                      <Progress value={lead.completenessScore} className="w-16" />
                      <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{lead.completenessScore}</span>
                    </span>
                    <SlaCell lead={lead} />
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Mobile: stacked cards */}
        <div className="divide-y divide-[var(--border)] sm:hidden">
          {leads.map((lead, i) => (
            <motion.div key={lead.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(i * 0.025, 0.3) }}>
              <Link href={`/workspace/leads/${lead.publicRef}`} className="block px-4 py-3.5 transition-colors hover:bg-[var(--background)]">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {lead.slaBreached && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[var(--danger)]" />}
                    <span className="truncate text-[14px] font-medium text-[var(--foreground)]">{lead.fullName}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {lead.qualityTier === "HOT" && (
                      <span className="flex items-center gap-0.5 text-xs font-medium text-[var(--danger)]">
                        <Flame className="h-3 w-3" /> {lead.qualityScore}
                      </span>
                    )}
                    <Badge tone={STATE_TONE[lead.state]}>{STATE_LABELS[lead.state]}</Badge>
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {lead.city}, {lead.stateCode} · {lead.intent.replace("_", " ")}
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-[var(--muted)]">{lead.officerName ?? "Unassigned"}</span>
                  <div className="flex items-center gap-1.5">
                    <Progress value={lead.completenessScore} className="w-12" />
                    <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{lead.completenessScore}</span>
                  </div>
                  <SlaCell lead={lead} />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
