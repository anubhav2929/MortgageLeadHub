"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { updateOfficerAction, updateOfficerProductTypesAction, type UpdateOfficerInput } from "@/domain/actions";
import type { LoanIntent, Officer } from "@/domain/types";

const ALL_PRODUCT_TYPES: LoanIntent[] = ["REFINANCE", "CASH_OUT", "HOME_EQUITY"];
const PRODUCT_LABEL: Record<LoanIntent, string> = {
  REFINANCE: "Rate & term refi",
  CASH_OUT: "Cash-out refi",
  HOME_EQUITY: "Home equity",
  UNKNOWN: "Unknown",
};
const US_STATES = ["AZ", "CA", "CO", "FL", "GA", "IL", "NC", "NV", "NY", "OH", "OR", "PA", "SC", "TX", "WA"];

export function OfficersPanel({ officers, canEdit }: { officers: Officer[]; canEdit: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {officers.map((o) => (
        <OfficerCard key={o.id} officer={o} canEdit={canEdit} />
      ))}
    </div>
  );
}

function OfficerCard({ officer, canEdit }: { officer: Officer; canEdit: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<UpdateOfficerInput>({
    licensedStates: officer.licensedStates,
    dailyCapacity: officer.dailyCapacity,
    activeHoursStart: officer.activeHoursStart,
    activeHoursEnd: officer.activeHoursEnd,
    isActive: officer.isActive,
  });
  const { push } = useToast();
  const router = useRouter();

  function toggleProduct(product: LoanIntent) {
    const next = officer.productTypes.includes(product) ? officer.productTypes.filter((p) => p !== product) : [...officer.productTypes, product];
    startTransition(async () => {
      const result = await updateOfficerProductTypesAction(officer.id, next);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  function toggleFormState(code: string) {
    setForm((f) => ({
      ...f,
      licensedStates: f.licensedStates.includes(code) ? f.licensedStates.filter((s) => s !== code) : [...f.licensedStates, code],
    }));
  }

  function saveEdit() {
    startTransition(async () => {
      const result = await updateOfficerAction(officer.id, form);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) setEditOpen(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--primary-tint)] text-[13px] font-semibold text-[var(--primary)]">
              {officer.name.charAt(0)}
            </span>
            <div>
              <p className="text-[13px] font-medium text-[var(--foreground)]">{officer.name}</p>
              <p className="text-xs text-[var(--muted-foreground)]">NMLS {officer.nmlsId}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge tone={officer.isActive ? "success" : "neutral"}>{officer.isActive ? "Active" : "Inactive"}</Badge>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {officer.licensedStates.map((s) => (
            <Badge key={s} tone="neutral">
              {s}
            </Badge>
          ))}
        </div>

        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Accepting</p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_PRODUCT_TYPES.map((p) => {
              const accepted = officer.productTypes.includes(p);
              return (
                <button
                  key={p}
                  disabled={!canEdit || isPending}
                  onClick={() => toggleProduct(p)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                    accepted
                      ? "border-[var(--primary)] bg-[var(--primary-tint)] text-[var(--primary)]"
                      : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--muted-foreground)]"
                  }`}
                >
                  {PRODUCT_LABEL[p]}: {accepted ? "ON" : "OFF"}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>Daily load</span>
            <span>
              {officer.currentLoad} / {officer.dailyCapacity}
            </span>
          </div>
          <Progress value={(officer.currentLoad / officer.dailyCapacity) * 100} tone={officer.currentLoad / officer.dailyCapacity > 0.85 ? "warning" : "primary"} />
        </div>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          Active hours: {officer.activeHoursStart}:00–{officer.activeHoursEnd}:00 local
        </p>
      </CardContent>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit ${officer.name}`}
        description="Capacity, licensed states, active hours, and account status."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={saveEdit}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label>Daily capacity</Label>
            <Input
              type="number"
              min={1}
              value={form.dailyCapacity}
              onChange={(e) => setForm((f) => ({ ...f, dailyCapacity: Number(e.target.value) }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Active hours start (local)</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={form.activeHoursStart}
                onChange={(e) => setForm((f) => ({ ...f, activeHoursStart: Number(e.target.value) }))}
              />
            </div>
            <div>
              <Label>Active hours end (local)</Label>
              <Input
                type="number"
                min={1}
                max={24}
                value={form.activeHoursEnd}
                onChange={(e) => setForm((f) => ({ ...f, activeHoursEnd: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div>
            <Label>Licensed states</Label>
            <div className="flex flex-wrap gap-1.5">
              {US_STATES.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleFormState(code)}
                  className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                    form.licensedStates.includes(code)
                      ? "border-[var(--primary)] bg-[var(--primary-tint)] text-[var(--primary)]"
                      : "border-[var(--border-strong)] text-[var(--muted)]"
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px] font-medium text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="h-3.5 w-3.5"
            />
            Active — eligible for new lead assignment
          </label>
        </div>
      </Modal>
    </Card>
  );
}
