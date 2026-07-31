"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { approveDisclosureAction, createDisclosureDraftAction } from "@/domain/actions";
import { formatDate } from "@/lib/utils";
import type { DisclosureVersion } from "@/domain/types";

export function DisclosuresPanel({ disclosures, canEdit, canApprove }: { disclosures: DisclosureVersion[]; canEdit: boolean; canApprove: boolean }) {
  const [draftOpen, setDraftOpen] = useState(false);
  const [key, setKey] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const byKey = new Map<string, DisclosureVersion[]>();
  for (const d of disclosures) {
    const list = byKey.get(d.key) ?? [];
    list.push(d);
    byKey.set(d.key, list);
  }
  for (const list of byKey.values()) list.sort((a, b) => b.version - a.version);

  function submitDraft() {
    startTransition(async () => {
      const result = await createDisclosureDraftAction(key, bodyText);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) {
        setDraftOpen(false);
        setKey("");
        setBodyText("");
      }
      router.refresh();
    });
  }

  function approve(id: string) {
    startTransition(async () => {
      const result = await approveDisclosureAction(id);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setDraftOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New disclosure draft
          </Button>
        </div>
      )}

      {Array.from(byKey.entries()).map(([k, versions]) => (
        <Card key={k}>
          <CardHeader>
            <CardTitle>{k}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-[var(--border)] p-0">
            {versions.map((d) => (
              <div key={d.id} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-[var(--foreground)]">v{d.version}</p>
                  <div className="flex items-center gap-2">
                    <Badge tone={d.status === "APPROVED" ? "success" : d.status === "DRAFT" ? "warning" : "neutral"}>{d.status}</Badge>
                    {canApprove && d.status === "DRAFT" && (
                      <Button size="sm" variant="secondary" loading={isPending} onClick={() => approve(d.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve — make live
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {d.status === "APPROVED" || d.status === "RETIRED"
                    ? `Approved by ${d.approvedBy} · effective ${formatDate(d.effectiveFrom)}${d.effectiveTo ? ` – ${formatDate(d.effectiveTo)}` : ""}`
                    : "Not yet approved — has no effect on live consent capture."}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{d.bodyText}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <Modal
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        title="New disclosure draft"
        description="Creates a draft version — it has no effect until approved. Approving retires the current live version for the same key."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDraftOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} disabled={!key.trim() || !bodyText.trim()} onClick={submitDraft}>
              Create draft
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label>Key</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. voice, sms, email" />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Use an existing key to version it, or a new one to start a new disclosure.</p>
          </div>
          <div>
            <Label>Disclosure text</Label>
            <Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={5} placeholder="By checking this box, I consent to..." />
          </div>
        </div>
      </Modal>
    </div>
  );
}
