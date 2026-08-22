"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, RotateCcw, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { updateLegalPageAction } from "@/domain/actions";
import { formatDateTime } from "@/lib/utils";
import type { LegalPage } from "@/domain/types";

const PAGES = [
  {
    slug: "privacy" as const,
    title: "Privacy policy",
    href: "/privacy",
    note: "Carriers fetch this URL during 10DLC review. It must state explicitly that mobile opt-in data is not shared or sold — a general 'we do not sell your information' is not accepted as covering it.",
  },
  {
    slug: "terms" as const,
    title: "Terms and conditions",
    href: "/terms",
    note: "Needs the CTIA disclosures spelled out: message frequency, STOP and HELP, message and data rates, and that carriers are not liable for undelivered messages.",
  },
];

function PageEditor({ page, current }: { page: (typeof PAGES)[number]; current: LegalPage | null }) {
  const [body, setBody] = useState(current?.body ?? "");
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const save = (value: string) =>
    startTransition(async () => {
      const result = await updateLegalPageAction(page.slug, value);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              {page.title}
              {current ? <Badge tone="primary">Customised</Badge> : <Badge tone="neutral">Built-in copy</Badge>}
            </CardTitle>
            <CardDescription>{page.note}</CardDescription>
          </div>
          <Link
            href={page.href}
            target="_blank"
            className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline"
          >
            View live <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <Textarea
          rows={14}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Leave empty to use the built-in ${page.title.toLowerCase()}.\n\nBlank lines separate paragraphs. A short line ending in a colon becomes a heading.`}
          className="font-mono text-xs"
        />
        <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
          {/* Said plainly because someone will paste HTML and wonder why it shows
              as text. The reason is a security property, not a limitation. */}
          Saved and displayed as plain text — HTML and scripts are never rendered, so this page cannot be turned into
          an attack on visitors. Blank lines make paragraphs; a short line ending in “:” becomes a heading.
        </p>
        {current && (
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Last edited by {current.updatedByName} · {formatDateTime(current.updatedAt)}
          </p>
        )}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {current && (
            <Button
              size="sm"
              variant="ghost"
              loading={isPending}
              onClick={() => {
                setBody("");
                save("");
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset to built-in
            </Button>
          )}
          <Button size="sm" loading={isPending} disabled={!body.trim()} onClick={() => save(body)}>
            <Save className="h-3.5 w-3.5" /> Publish
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function LegalPagesPanel({ pages }: { pages: Record<string, LegalPage | null> }) {
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[var(--muted-foreground)]">
        These pages are public and are read by carriers during 10DLC review and by regulators. Every change is written
        to the audit log with your name.
      </p>
      {PAGES.map((p) => (
        <PageEditor key={p.slug} page={p} current={pages[p.slug] ?? null} />
      ))}
    </div>
  );
}
