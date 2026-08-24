"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { deleteLeadAction, updateLeadDetailsAction, type EditableLeadFields } from "@/domain/actions";
import { STATE_NAMES } from "@/domain/stateTimezone";

const INTENTS = ["REFINANCE", "HOME_EQUITY", "CASH_OUT", "UNKNOWN"] as const;
const GOALS = ["LOWER_PAYMENT", "CASH_OUT", "SHORTEN_TERM", "DEBT_CONSOLIDATION", "OTHER"] as const;
const TIMELINES = ["ASAP", "1_3_MONTHS", "3_6_MONTHS", "EXPLORING"] as const;
const CREDIT = ["EXCELLENT_740_PLUS", "GOOD_680_739", "FAIR_620_679", "BELOW_620", "UNSURE"] as const;
const OCCUPANCY = ["PRIMARY", "SECOND_HOME", "INVESTMENT", "UNKNOWN"] as const;
const WINDOWS = ["MORNING", "AFTERNOON", "EVENING", "ANY"] as const;

const pretty = (v: string) => v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

export function LeadEditModal({
  open,
  onClose,
  publicRef,
  initial,
  canDelete,
}: {
  open: boolean;
  onClose: () => void;
  publicRef: string;
  initial: EditableLeadFields;
  /** Admin-only. Deleting a lead destroys its consent and contact evidence. */
  canDelete: boolean;
}) {
  const [form, setForm] = useState<EditableLeadFields>(initial);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function set<K extends keyof EditableLeadFields>(key: K, value: EditableLeadFields[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      const result = await updateLeadDetailsAction(publicRef, form);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) {
        onClose();
        router.refresh();
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteLeadAction(publicRef);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) router.push("/workspace/leads");
      else setConfirmingDelete(false);
    });
  }

  // --- Delete confirmation is a separate screen, not an inline button. -----
  // Deleting a lead is irreversible and takes the consent record with it, so
  // it should never be one stray click away from the Save button.
  if (confirmingDelete) {
    return (
      <Modal
        open={open}
        onClose={() => setConfirmingDelete(false)}
        title="Delete this lead?"
        description={`${initial.firstName} ${initial.lastName} · ${publicRef}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" loading={isPending} onClick={remove}>
              <Trash2 className="h-3.5 w-3.5" /> Delete permanently
            </Button>
          </div>
        }
      >
        <div className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-tint)] p-3.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--danger)]" />
          <div className="text-[13px] leading-relaxed text-[var(--foreground)]">
            <p className="font-medium">This cannot be undone.</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Every contact attempt, call transcript, note, task, and consent record for this lead is removed with it.
              That consent trail is what proves what you were permitted to do — keep the lead and mark it closed instead
              unless this is a duplicate or test record.
            </p>
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
              The deletion itself stays in the audit log under your name.
            </p>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit lead"
      description={`${publicRef} — corrections are recorded in the timeline and audit log.`}
      className="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          {canDelete ? (
            <Button variant="outlineDanger" size="sm" onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete lead
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={save}>
              Save changes
            </Button>
          </div>
        </div>
      }
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Contact</h3>
          <Row>
            <div>
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
            </div>
          </Row>
          <Row>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={form.phoneE164}
                onChange={(e) => set("phoneE164", e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
          </Row>
          <Row>
            <div>
              <Label htmlFor="window">Best time to reach</Label>
              <Select
                id="window"
                value={form.preferredContactWindow}
                onChange={(e) => set("preferredContactWindow", e.target.value as EditableLeadFields["preferredContactWindow"])}
              >
                {WINDOWS.map((w) => (
                  <option key={w} value={w}>
                    {pretty(w)}
                  </option>
                ))}
              </Select>
            </div>
          </Row>
        </section>

        <section className="space-y-3 border-t border-[var(--border)] pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Property</h3>
          <Row>
            <div>
              <Label htmlFor="addr">Street address</Label>
              <Input
                id="addr"
                value={form.addressLine1 ?? ""}
                onChange={(e) => set("addressLine1", e.target.value)}
                placeholder="Needed for a live valuation"
              />
            </div>
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" value={form.city} onChange={(e) => set("city", e.target.value)} />
            </div>
          </Row>
          <Row>
            <div>
              <Label htmlFor="state">State</Label>
              <Select id="state" value={form.stateCode} onChange={(e) => set("stateCode", e.target.value)}>
                {Object.entries(STATE_NAMES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="postalCode">ZIP code</Label>
              <Input
                id="postalCode"
                inputMode="numeric"
                value={form.postalCode ?? ""}
                onChange={(e) => set("postalCode", e.target.value.replace(/[^\d-]/g, "").slice(0, 10))}
                placeholder="90210"
              />
            </div>
          </Row>
          <Row>
            <div>
              <Label htmlFor="occ">Occupancy</Label>
              <Select
                id="occ"
                value={form.occupancy}
                onChange={(e) => set("occupancy", e.target.value as EditableLeadFields["occupancy"])}
              >
                {OCCUPANCY.map((o) => (
                  <option key={o} value={o}>
                    {pretty(o)}
                  </option>
                ))}
              </Select>
            </div>
          </Row>
          <Row>
            <div>
              <Label htmlFor="value">Estimated value</Label>
              <Input
                id="value"
                type="number"
                value={form.estimatedValue ?? ""}
                onChange={(e) => set("estimatedValue", e.target.value ? Number(e.target.value) : undefined)}
              />
            </div>
            <div>
              <Label htmlFor="balance">Current balance</Label>
              <Input
                id="balance"
                type="number"
                value={form.currentBalance ?? ""}
                onChange={(e) => set("currentBalance", e.target.value ? Number(e.target.value) : undefined)}
              />
            </div>
          </Row>
        </section>

        <section className="space-y-3 border-t border-[var(--border)] pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Loan</h3>
          <Row>
            <div>
              <Label htmlFor="intent">Intent</Label>
              <Select
                id="intent"
                value={form.intent}
                onChange={(e) => set("intent", e.target.value as EditableLeadFields["intent"])}
              >
                {INTENTS.map((i) => (
                  <option key={i} value={i}>
                    {pretty(i)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="goal">Goal</Label>
              <Select
                id="goal"
                value={form.goal}
                onChange={(e) => set("goal", e.target.value as EditableLeadFields["goal"])}
              >
                {GOALS.map((g) => (
                  <option key={g} value={g}>
                    {pretty(g)}
                  </option>
                ))}
              </Select>
            </div>
          </Row>
          <Row>
            <div>
              <Label htmlFor="timeline">Timeline</Label>
              <Select
                id="timeline"
                value={form.timeline}
                onChange={(e) => set("timeline", e.target.value as EditableLeadFields["timeline"])}
              >
                {TIMELINES.map((t) => (
                  <option key={t} value={t}>
                    {pretty(t)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="credit">Credit range</Label>
              <Select
                id="credit"
                value={form.creditRange}
                onChange={(e) => set("creditRange", e.target.value as EditableLeadFields["creditRange"])}
              >
                {CREDIT.map((c) => (
                  <option key={c} value={c}>
                    {pretty(c)}
                  </option>
                ))}
              </Select>
            </div>
          </Row>
        </section>
      </div>
    </Modal>
  );
}
