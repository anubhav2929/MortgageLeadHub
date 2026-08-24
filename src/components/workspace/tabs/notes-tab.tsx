"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { StickyNote, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { addNoteAction } from "@/domain/actions";
import { formatDateTime, initials } from "@/lib/utils";
import { LeadDocuments } from "@/components/workspace/lead-documents";
import type { LeadDocument, Note } from "@/domain/types";

export function NotesTab({
  publicRef,
  notes,
  documents,
  canEdit,
  eSignConfigured,
}: {
  publicRef: string;
  notes: Note[];
  documents: LeadDocument[];
  canEdit: boolean;
  eSignConfigured: boolean;
}) {
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function submit() {
    if (!body.trim()) return;
    startTransition(async () => {
      const result = await addNoteAction(publicRef, body);
      if (result.ok) setBody("");
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <Textarea
            placeholder="Add a note for the team..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            disabled={!canEdit}
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" loading={isPending} disabled={!canEdit || !body.trim()} onClick={submit}>
              <Send className="h-3.5 w-3.5" /> Add note
            </Button>
          </div>
        </CardContent>
      </Card>

      <LeadDocuments
        publicRef={publicRef}
        documents={documents}
        canEdit={canEdit}
        eSignConfigured={eSignConfigured}
      />

      {notes.length === 0 ? (
        <EmptyState icon={StickyNote} title="No notes yet" />
      ) : (
        <div className="space-y-3">
          {notes.map((n) => {
            const [first, ...rest] = n.authorName.split(" ");
            return (
              <div key={n.id} className="flex gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--violet-tint)] text-[11px] font-semibold text-[var(--violet)]">
                  {initials(first ?? "", rest.join(" "))}
                </span>
                <div className="flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[13px] font-medium text-[var(--foreground)]">{n.authorName}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">{formatDateTime(n.createdAt)}</span>
                  </div>
                  <p className="text-[13px] text-[var(--muted)]">{n.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
