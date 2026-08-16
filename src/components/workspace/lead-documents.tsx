"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Paperclip, PenLine, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { deleteLeadDocumentAction, uploadLeadDocumentAction } from "@/domain/actions";
import { formatDateTime } from "@/lib/utils";
import type { LeadDocument } from "@/domain/types";

const CATEGORIES: { value: LeadDocument["category"]; label: string }[] = [
  { value: "DISCLOSURE", label: "Disclosure" },
  { value: "INCOME", label: "Income / paystub" },
  { value: "PROPERTY", label: "Property / title" },
  { value: "IDENTITY", label: "Identity" },
  { value: "OTHER", label: "Other" },
];

const CATEGORY_TONE: Record<LeadDocument["category"], "neutral" | "primary" | "success" | "warning"> = {
  DISCLOSURE: "primary",
  INCOME: "success",
  PROPERTY: "neutral",
  IDENTITY: "warning",
  OTHER: "neutral",
};

const SIGNATURE_TONE: Record<string, "neutral" | "primary" | "success" | "warning" | "danger"> = {
  SENT: "warning",
  DELIVERED: "warning",
  SIGNED: "success",
  DECLINED: "danger",
  VOIDED: "neutral",
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function LeadDocuments({
  publicRef,
  documents,
  canEdit,
  eSignConfigured,
}: {
  publicRef: string;
  documents: LeadDocument[];
  canEdit: boolean;
  eSignConfigured: boolean;
}) {
  const [category, setCategory] = useState<LeadDocument["category"]>("INCOME");
  const [isPending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const { push } = useToast();
  const router = useRouter();

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onerror = () => push({ title: "Could not read that file.", tone: "danger" });
    reader.onload = () => {
      const dataUri = String(reader.result ?? "");
      startTransition(async () => {
        const result = await uploadLeadDocumentAction(publicRef, {
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          dataUri,
          category,
        });
        push({ title: result.message, tone: result.ok ? "success" : "danger" });
        // Clear the input either way, or picking the same file again after a
        // rejection fires no change event and looks like a dead button.
        if (fileInput.current) fileInput.current.value = "";
        if (result.ok) router.refresh();
      });
    };
    reader.readAsDataURL(file);
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteLeadDocumentAction(publicRef, id);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <Paperclip className="h-3.5 w-3.5" /> Documents
          </CardTitle>
          <CardDescription>
            Paystubs, disclosures, and title paperwork for this borrower. Every upload and removal is written to the
            audit log with your name.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3">
            <div className="min-w-[10rem]">
              <label htmlFor="doc-category" className="mb-1 block text-xs font-medium text-[var(--foreground)]">
                Category
              </label>
              <Select
                id="doc-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as LeadDocument["category"])}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.heic,.txt,.doc,.docx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            <Button size="sm" variant="secondary" loading={isPending} onClick={() => fileInput.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Choose file
            </Button>
            <p className="text-xs text-[var(--muted-foreground)]">PDF, image, or document · up to 5 MB</p>
          </div>
        )}

        {documents.length === 0 ? (
          <p className="py-2 text-[13px] text-[var(--muted-foreground)]">No documents attached yet.</p>
        ) : (
          <div className="space-y-2">
            {documents.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-2.5"
              >
                <FileText className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[var(--foreground)]">{d.filename}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {humanSize(d.sizeBytes)} · {d.uploadedByName} · {formatDateTime(d.uploadedAt)}
                  </p>
                </div>
                <Badge tone={CATEGORY_TONE[d.category]}>{CATEGORIES.find((c) => c.value === d.category)?.label}</Badge>
                {d.signature && (
                  <Badge tone={SIGNATURE_TONE[d.signature.status] ?? "neutral"}>
                    e-sign {d.signature.status.toLowerCase()}
                  </Badge>
                )}
                {d.inlineContent && (
                  <a
                    href={d.inlineContent}
                    download={d.filename}
                    className="focus-ring rounded-[var(--radius-sm)] p-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    aria-label={`Download ${d.filename}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove(d.id)}
                    disabled={isPending}
                    aria-label={`Remove ${d.filename}`}
                    className="focus-ring rounded-[var(--radius-sm)] p-1.5 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Stated rather than hidden. An officer who expects to send a
            disclosure for signature needs to know whether that is possible
            before they promise it to a borrower on a call. */}
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] p-3">
          <PenLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
            {eSignConfigured ? (
              <>
                <span className="font-medium text-[var(--foreground)]">E-signature is connected.</span> Disclosures can
                be sent for signature and their status tracks back onto the document above.
              </>
            ) : (
              <>
                <span className="font-medium text-[var(--foreground)]">E-signature is not connected.</span> Add a
                provider under Admin → Integrations to send disclosures for signature from here. Until then, documents
                can be stored and downloaded but not routed for signing.
              </>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
