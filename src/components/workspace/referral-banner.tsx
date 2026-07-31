"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { HeartHandshake, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { referLeadToPartnerAction } from "@/domain/actions";
import { formatDateTime } from "@/lib/utils";
import type { ReferralPartner, ReferralType } from "@/domain/types";

const COPY: Record<Exclude<ReferralType, "NONE" | undefined>, { title: string; body: string }> = {
  LOAN_MODIFICATION: {
    title: "Recommended referral: loan modification",
    body: "1–2 missed payments in the last 12 months — this borrower likely won't qualify for refi/equity, but a loan-mod partner can still help them.",
  },
  FORECLOSURE: {
    title: "Recommended referral: foreclosure specialist",
    body: "3+ missed payments in the last 12 months — too much risk for refi/equity underwriting. Route to a foreclosure specialist before the situation worsens.",
  },
};

export function ReferralBanner({
  publicRef,
  referralType,
  referredToPartnerId,
  referredAt,
  partners,
  canRefer,
}: {
  publicRef: string;
  referralType?: ReferralType;
  referredToPartnerId?: string;
  referredAt?: string;
  partners: ReferralPartner[];
  canRefer: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  if (!referralType || referralType === "NONE") return null;

  const copy = COPY[referralType];
  const matchingPartners = partners.filter((p) => p.isActive && (referralType === "FORECLOSURE" ? p.specialty === "FORECLOSURE" : p.specialty === "LOAN_MODIFICATION" || p.specialty === "BANKRUPTCY"));
  const referredPartner = referredToPartnerId ? partners.find((p) => p.id === referredToPartnerId) : undefined;

  function submit() {
    if (!partnerId) return;
    startTransition(async () => {
      const result = await referLeadToPartnerAction(publicRef, partnerId);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) setOpen(false);
      router.refresh();
    });
  }

  return (
    <Card className="border-[var(--warning-border)] bg-[var(--warning-tint)]">
      <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex items-start gap-2.5">
          <HeartHandshake className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
          <div>
            <p className="text-[13px] font-semibold text-[var(--foreground)]">{copy.title}</p>
            <p className="mt-0.5 max-w-md text-xs text-[var(--muted-foreground)]">{copy.body}</p>
            {referredPartner && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--success)]">
                <CheckCircle2 className="h-3.5 w-3.5" /> Referred to {referredPartner.name} {referredAt ? `on ${formatDateTime(referredAt)}` : ""}
              </p>
            )}
          </div>
        </div>
        {canRefer && !referredPartner && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={matchingPartners.length === 0}>
            {matchingPartners.length === 0 ? "No partners on file" : "Refer to partner"}
          </Button>
        )}
      </CardContent>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Refer to partner"
        description="Adds a note to this lead and marks it referred — set up partners in Admin → Referral partners."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={submit} disabled={!partnerId}>
              Confirm referral
            </Button>
          </>
        }
      >
        <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
          <option value="" disabled>
            Select a partner
          </option>
          {matchingPartners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Modal>
    </Card>
  );
}
