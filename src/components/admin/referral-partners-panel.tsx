"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, ShieldOff, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { createReferralPartnerAction, setReferralPartnerActiveAction, type CreateReferralPartnerInput } from "@/domain/actions";
import { formatDate } from "@/lib/utils";
import type { ReferralPartner, ReferralSpecialty } from "@/domain/types";

const SPECIALTY_LABEL: Record<ReferralSpecialty, string> = {
  FORECLOSURE: "Foreclosure specialist",
  LOAN_MODIFICATION: "Loan modification",
  BANKRUPTCY: "Bankruptcy attorney",
};

const SPECIALTY_TONE: Record<ReferralSpecialty, "danger" | "warning" | "neutral"> = {
  FORECLOSURE: "danger",
  LOAN_MODIFICATION: "warning",
  BANKRUPTCY: "neutral",
};

export function ReferralPartnersPanel({ partners, canManage }: { partners: ReferralPartner[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState<ReferralSpecialty>("LOAN_MODIFICATION");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function reset() {
    setName("");
    setSpecialty("LOAN_MODIFICATION");
    setContactName("");
    setPhone("");
    setEmail("");
    setNotes("");
  }

  function submit() {
    const input: CreateReferralPartnerInput = { name, specialty, contactName: contactName || undefined, phone: phone || undefined, email: email || undefined, notes: notes || undefined };
    startTransition(async () => {
      const result = await createReferralPartnerAction(input);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) {
        setOpen(false);
        reset();
      }
      router.refresh();
    });
  }

  function toggleActive(partnerId: string, isActive: boolean) {
    startTransition(async () => {
      const result = await setReferralPartnerActiveAction(partnerId, !isActive);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] text-[var(--muted-foreground)]">
          Leads that can&apos;t qualify for refi/equity get routed here instead of discarded — {partners.length} partner{partners.length === 1 ? "" : "s"} on file.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New partner
          </Button>
        )}
      </div>

      {partners.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldOff} title="No referral partners yet" description="Add a foreclosure specialist, loan-mod shop, or bankruptcy attorney to start routing unqualified leads for a fee." />
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-[var(--border)] p-0">
            {partners.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-[var(--foreground)]">{p.name}</p>
                    <Badge tone={SPECIALTY_TONE[p.specialty]}>{SPECIALTY_LABEL[p.specialty]}</Badge>
                    {!p.isActive && <Badge tone="neutral">Inactive</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    {[p.contactName, p.phone, p.email].filter(Boolean).join(" · ") || "No contact on file"} · added {formatDate(p.createdAt)}
                  </p>
                  {p.notes && <p className="mt-1 text-xs italic text-[var(--muted-foreground)]">{p.notes}</p>}
                </div>
                {canManage && (
                  <Button variant="ghost" size="sm" loading={isPending} onClick={() => toggleActive(p.id, p.isActive)}>
                    {p.isActive ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {canManage && <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add referral partner"
        description="For leads with missed payments that can't qualify for refi or equity — routed here for a fee instead of dropped."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={submit} disabled={!name.trim()}>
              Add partner
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label>Company / partner name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunrise Loan Modification" />
          </div>
          <div>
            <Label>Specialty</Label>
            <Select value={specialty} onChange={(e) => setSpecialty(e.target.value as ReferralSpecialty)}>
              <option value="LOAN_MODIFICATION">Loan modification (1-2 missed payments)</option>
              <option value="FORECLOSURE">Foreclosure specialist (3+ missed payments)</option>
              <option value="BANKRUPTCY">Bankruptcy attorney</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Contact name (optional)</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Dana Price" />
            </div>
            <div>
              <Label>Phone (optional)</Label>
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-0100" />
            </div>
          </div>
          <div>
            <Label>Email (optional)</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dana@sunriseloanmod.com" />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Fee arrangement, coverage area, etc." />
          </div>
        </div>
      </Modal>}
    </div>
  );
}
