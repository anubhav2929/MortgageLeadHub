"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Ban, Plus, ShieldOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { addSuppressionAction, liftSuppressionAction } from "@/domain/actions";
import { formatDateTime } from "@/lib/utils";
import type { SuppressionWithStatus } from "@/domain/queries";
import type { SuppressionReason } from "@/domain/types";

export function SuppressionPanel({ suppressions, canManage, isAdmin }: { suppressions: SuppressionWithStatus[]; canManage: boolean; isAdmin: boolean }) {
  const [addOpen, setAddOpen] = useState(false);
  const [liftTarget, setLiftTarget] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState<SuppressionReason>("MANUAL");
  const [liftReason, setLiftReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"" | "GLOBAL" | "CHANNEL">("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppressions.filter((s) => {
      if (scopeFilter && s.scope !== scopeFilter) return false;
      if (q && !s.phoneE164.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [suppressions, search, scopeFilter]);

  function submitAdd() {
    startTransition(async () => {
      const result = await addSuppressionAction(phone, reason);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) {
        setAddOpen(false);
        setPhone("");
      }
      router.refresh();
    });
  }

  function submitLift() {
    if (!liftTarget) return;
    startTransition(async () => {
      const result = await liftSuppressionAction(liftTarget, liftReason);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) {
        setLiftTarget(null);
        setLiftReason("");
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] text-[var(--muted-foreground)]">
          Keyed on phone number, not lead — an opt-out on one lead suppresses every future lead for that number.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add suppression
          </Button>
        )}
      </div>

      {suppressions.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search phone number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[220px] flex-1"
          />
          <Select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as "" | "GLOBAL" | "CHANNEL")} className="w-auto min-w-32">
            <option value="">All scopes</option>
            <option value="GLOBAL">Global</option>
            <option value="CHANNEL">Channel</option>
          </Select>
          <p className="text-xs text-[var(--muted-foreground)]">
            {filtered.length} of {suppressions.length}
          </p>
        </div>
      )}

      {suppressions.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldOff} title="No active suppressions" />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldOff} title="No suppressions match these filters" />
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-[var(--border)] p-0">
            {filtered.map((s) => {
              const expired = s.expired;
              return (
                <div key={s.id} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <p className="text-[13px] font-medium tabular-nums text-[var(--foreground)]">{s.phoneE164}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {s.scope}
                      {s.channel ? ` · ${s.channel}` : ""} · since {formatDateTime(s.createdAt)}
                      {s.expiresAt ? ` · ${expired ? "expired" : "expires"} ${formatDateTime(s.expiresAt)}` : " · no expiry"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="danger">{s.reason.replace("_", " ")}</Badge>
                    {isAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => setLiftTarget(s.phoneE164)}>
                        <Ban className="h-3.5 w-3.5" /> Lift
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add manual suppression"
        description="This immediately and permanently blocks outbound contact to this number across every lead."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" loading={isPending} onClick={submitAdd} disabled={!phone.trim()}>
              Suppress number
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label>Phone (E.164)</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15555550142" />
          </div>
          <div>
            <Label>Reason</Label>
            <Select value={reason} onChange={(e) => setReason(e.target.value as SuppressionReason)}>
              <option value="MANUAL">Manual</option>
              <option value="DNC_LIST">DNC list match</option>
              <option value="COMPLAINT">Complaint</option>
              <option value="WRONG_PARTY">Wrong party</option>
              <option value="LITIGATION">Litigation</option>
            </Select>
          </div>
        </div>
      </Modal>

      <Modal
        open={liftTarget !== null}
        onClose={() => setLiftTarget(null)}
        title="Lift suppression"
        description="Requires a written reason. This is logged permanently in the audit trail."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setLiftTarget(null)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={submitLift} disabled={!liftReason.trim()}>
              Lift suppression
            </Button>
          </>
        }
      >
        <Textarea placeholder="Why is this being lifted?" value={liftReason} onChange={(e) => setLiftReason(e.target.value)} rows={3} />
      </Modal>
    </div>
  );
}
