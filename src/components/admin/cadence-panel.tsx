"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Phone, MessageSquare, Mail, Plus, Trash2, Pencil, Save, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { createCadencePlanAction, updateCadencePlanAction } from "@/domain/actions";
import type { CadencePlan, CadenceStep, Channel, LoanIntent } from "@/domain/types";

const CHANNEL_ICON = { VOICE: Phone, SMS: MessageSquare, EMAIL: Mail };
const US_STATES = ["AZ", "CA", "CO", "FL", "GA", "IL", "NC", "NY", "OH", "OR", "PA", "TX", "WA"];

function formatOffset(min: number) {
  if (min === 0) return "Immediately";
  if (min < 60) return `+${min}m`;
  if (min < 1440) return `+${Math.round(min / 60)}h`;
  return `+${Math.round(min / 1440)}d`;
}

function StepEditor({ steps, onChange }: { steps: CadenceStep[]; onChange: (steps: CadenceStep[]) => void }) {
  function update<K extends keyof CadenceStep>(i: number, key: K, value: CadenceStep[K]) {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
  }
  function remove(i: number) {
    onChange(steps.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...steps, { offsetMinutes: 0, channel: "SMS", maxAttempts: 1, stopOnOutcomes: [] }]);
  }

  return (
    <div className="space-y-2">
      {steps.map((step, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] p-2.5">
          <Select className="w-28" value={step.channel} onChange={(e) => update(i, "channel", e.target.value as Channel)}>
            <option value="VOICE">Voice</option>
            <option value="SMS">SMS</option>
            <option value="EMAIL">Email</option>
          </Select>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--muted-foreground)]">Offset (min)</span>
            <Input
              type="number"
              min={0}
              className="w-20"
              value={step.offsetMinutes}
              onChange={(e) => update(i, "offsetMinutes", Number(e.target.value))}
            />
            <span className="whitespace-nowrap text-xs text-[var(--muted-foreground)]">({formatOffset(step.offsetMinutes)})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--muted-foreground)]">Max attempts</span>
            <Input
              type="number"
              min={1}
              className="w-16"
              value={step.maxAttempts}
              onChange={(e) => update(i, "maxAttempts", Number(e.target.value))}
            />
          </div>
          <button onClick={() => remove(i)} className="ml-auto text-[var(--muted-foreground)] hover:text-[var(--danger)]">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {steps.some((s, i) => i > 0 && s.offsetMinutes < steps[i - 1].offsetMinutes) && (
        <p className="text-xs font-medium text-[var(--warning)]">
          These steps aren&apos;t in ascending offset order — the cadence engine always runs them earliest-offset-first regardless of the
          order shown here, so reorder them to match what will actually happen.
        </p>
      )}
      <Button variant="ghost" size="sm" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add step
      </Button>
    </div>
  );
}

function PlanCard({ plan }: { plan: CadencePlan }) {
  const [editing, setEditing] = useState(false);
  const [steps, setSteps] = useState<CadenceStep[]>(plan.steps);
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function save() {
    startTransition(async () => {
      const result = await updateCadencePlanAction(plan.id, steps);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) setEditing(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {plan.name}
              {plan.isDefault && <Badge tone="primary">Default</Badge>}
            </CardTitle>
            <CardDescription>
              {plan.stateCode ? `State: ${plan.stateCode}` : "Any state"} · {plan.intent ? plan.intent.replace("_", " ") : "Any intent"}
            </CardDescription>
          </div>
          {editing ? (
            <div className="flex shrink-0 gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSteps(plan.steps);
                  setEditing(false);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" loading={isPending} onClick={save}>
                <Save className="h-3.5 w-3.5" /> Save
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <StepEditor steps={steps} onChange={setSteps} />
        ) : (
          <div className="flex flex-wrap gap-3">
            {plan.steps.map((step, i) => {
              const Icon = CHANNEL_ICON[step.channel];
              return (
                <div key={i} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                  <Icon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                  <div>
                    <p className="text-xs font-medium text-[var(--foreground)]">{formatOffset(step.offsetMinutes)}</p>
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      {step.channel} · max {step.maxAttempts}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          In-flight leads keep their snapshotted plan version — editing here never retroactively re-contacts anyone.
        </p>
      </CardContent>
    </Card>
  );
}

export function CadencePanel({ plans }: { plans: CadencePlan[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [intent, setIntent] = useState<LoanIntent | "">("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function createPlan() {
    startTransition(async () => {
      const result = await createCadencePlanAction({ name, stateCode: stateCode || undefined, intent: intent || undefined });
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) {
        setCreateOpen(false);
        setName("");
        setStateCode("");
        setIntent("");
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] text-[var(--muted-foreground)]">{plans.length} cadence plan{plans.length === 1 ? "" : "s"}.</p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New plan
        </Button>
      </div>
      <div className="space-y-4">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New cadence plan"
        description="Starts with one Voice step — add more and set the schedule after creating."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={createPlan} disabled={!name.trim()}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Texas cash-out" />
          </div>
          <div>
            <Label>State (optional — leave blank for any state)</Label>
            <Select value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
              <option value="">Any state</option>
              {US_STATES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Intent (optional — leave blank for any intent)</Label>
            <Select value={intent} onChange={(e) => setIntent(e.target.value as LoanIntent | "")}>
              <option value="">Any intent</option>
              <option value="REFINANCE">Refinance</option>
              <option value="CASH_OUT">Cash out</option>
              <option value="HOME_EQUITY">Home equity</option>
            </Select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
