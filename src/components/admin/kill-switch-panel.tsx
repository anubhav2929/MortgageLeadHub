"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ShieldAlert, ShieldCheck, Ban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { toggleKillSwitchAction } from "@/domain/actions";
import { formatDateTime } from "@/lib/utils";
import type { KillSwitchState } from "@/domain/types";
import type { BlockedItem } from "@/domain/queries";

export function KillSwitchPanel({ state, canToggle, blockedItems }: { state: KillSwitchState; canToggle: boolean; blockedItems: BlockedItem[] }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function submit() {
    startTransition(async () => {
      const result = await toggleKillSwitchAction(reason);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) {
        setOpen(false);
        setReason("");
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
    <Card className={state.isOn ? "border-[var(--danger-border)]" : undefined}>
      <CardContent className="p-6 text-center">
        <div
          className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${
            state.isOn ? "bg-[var(--danger-tint)]" : "bg-[var(--success-tint)]"
          }`}
        >
          {state.isOn ? (
            <ShieldAlert className="h-6 w-6 text-[var(--danger)]" />
          ) : (
            <ShieldCheck className="h-6 w-6 text-[var(--success)]" />
          )}
        </div>
        <h3 className="text-base font-semibold text-[var(--foreground)]">
          {state.isOn ? "All outbound automation is paused" : "Automation is running normally"}
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-[var(--muted-foreground)]">
          {state.isOn
            ? "PolicyGate denies every automated attempt while this is active. Manual officer contact is still gated normally."
            : "The kill switch halts every automated outbound attempt globally the moment it's activated."}
        </p>
        {state.toggledAt && (
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Last changed {formatDateTime(state.toggledAt)}
            {state.reason ? ` — "${state.reason}"` : ""}
          </p>
        )}
        {canToggle && (
          <Button className="mt-5" variant={state.isOn ? "primary" : "danger"} onClick={() => setOpen(true)}>
            {state.isOn ? "Deactivate kill switch" : "Activate kill switch"}
          </Button>
        )}
      </CardContent>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={state.isOn ? "Deactivate kill switch" : "Activate kill switch"}
        description="A reason is required and is written to the audit log."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant={state.isOn ? "primary" : "danger"} size="sm" loading={isPending} onClick={submit} disabled={!reason.trim()}>
              Confirm
            </Button>
          </>
        }
      >
        <Textarea placeholder="Reason for this change..." value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </Modal>
    </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recently blocked by the kill switch</CardTitle>
            <CardDescription>Automated attempts PolicyGate denied while it was active — nothing here means nothing hit the block.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className={blockedItems.length === 0 ? "" : "divide-y divide-[var(--border)] p-0"}>
          {blockedItems.length === 0 ? (
            <EmptyState icon={Ban} title="Nothing blocked recently" />
          ) : (
            blockedItems.map((item, i) => (
              <Link
                key={i}
                href={`/workspace/leads/${item.leadPublicRef}`}
                className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-[var(--background)]"
              >
                <span className="text-[13px] font-medium text-[var(--foreground)]">{item.leadFullName}</span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {item.channel} · {formatDateTime(item.evaluatedAt)}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
