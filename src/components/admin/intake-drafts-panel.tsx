"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, FileClock, Mail, Phone, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { deleteIntakeDraftAction } from "@/domain/actions";
import { formatDateTime } from "@/lib/utils";
import type { IntakeDraft } from "@/domain/types";

const STEP_LABELS = ["Purpose", "Contact", "Property", "Timeline & credit", "Consent"];

function field(snapshot: Record<string, unknown>, key: string): string {
  const value = snapshot[key];
  return typeof value === "string" ? value.trim() : "";
}

export function IntakeDraftsPanel({ drafts, canManage, retentionDays }: { drafts: IntakeDraft[]; canManage: boolean; retentionDays: number }) {
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drafts;
    return drafts.filter((d) => {
      const s = d.formSnapshot;
      return [field(s, "firstName"), field(s, "lastName"), field(s, "phone"), field(s, "email")].some((v) => v.toLowerCase().includes(q));
    });
  }, [drafts, search]);

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteIntakeDraftAction(id);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-tint)] px-4 py-3 text-[13px] leading-relaxed text-[var(--foreground)]">
        <span className="font-medium">No consent is on file for anything below.</span> These are visitors who started the
        intake form and left before submitting — they never agreed to be called, texted, or emailed. Reaching out is a
        manual, human decision only; nothing here is or should be wired into automated outreach. Rows older than{" "}
        {retentionDays} days are purged automatically.
      </div>

      {drafts.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <Input placeholder="Search name, phone, email…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <p className="text-xs text-[var(--muted-foreground)]">
            {filtered.length} of {drafts.length}
          </p>
        </div>
      )}

      {drafts.length === 0 ? (
        <Card>
          <EmptyState icon={FileClock} title="No incomplete leads" description="Every visitor who started the form either finished it or hasn't dropped off yet." />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState icon={FileClock} title="No drafts match that search" />
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-[var(--border)] p-0">
            {filtered.map((d) => {
              const firstName = field(d.formSnapshot, "firstName");
              const lastName = field(d.formSnapshot, "lastName");
              const phone = field(d.formSnapshot, "phone");
              const email = field(d.formSnapshot, "email");
              const name = [firstName, lastName].filter(Boolean).join(" ");
              const stepLabel = STEP_LABELS[d.furthestStep] ?? `Step ${d.furthestStep + 1}`;
              return (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-[var(--foreground)]">{name || "Name not entered"}</p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--muted-foreground)]">
                      {phone && (
                        <a href={`tel:${phone}`} className="flex items-center gap-1 text-[var(--primary)] hover:underline">
                          <Phone className="h-3 w-3" /> {phone}
                        </a>
                      )}
                      {email && (
                        <a href={`mailto:${email}`} className="flex items-center gap-1 text-[var(--primary)] hover:underline">
                          <Mail className="h-3 w-3" /> {email}
                        </a>
                      )}
                      {!phone && !email && (
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> No contact info captured yet
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge tone="neutral">Reached: {stepLabel}</Badge>
                    <span className="text-xs text-[var(--muted-foreground)]">{formatDateTime(d.updatedAt)}</span>
                    {canManage && (
                      <Button variant="ghost" size="sm" loading={isPending} onClick={() => remove(d.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
