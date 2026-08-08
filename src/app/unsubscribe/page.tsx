import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import { UnsubscribeForm } from "@/components/status/unsubscribe-form";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function UnsubscribePage() {
  return (
    <main className="flex-1 overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-lg px-6 py-12">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--primary)] text-white">
            <Landmark className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-[var(--foreground)]">Equity Flow Group</h1>
            <p className="text-xs text-[var(--muted-foreground)]">Opt out of communications</p>
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
          <p className="text-[15px] font-semibold text-[var(--foreground)]">Stop calls, texts, and emails</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted-foreground)]">
            Enter the phone number you&apos;d like removed from all future outreach. This takes effect immediately and
            applies across every channel.
          </p>
          <UnsubscribeForm />
        </div>
      </div>
    </main>
  );
}
