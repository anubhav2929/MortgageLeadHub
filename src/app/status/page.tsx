import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import { StatusLookupForm } from "@/components/status/status-lookup-form";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function StatusLookupPage() {
  return (
    <div className="flex-1 overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto max-w-lg px-6 py-12">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--primary)] text-white">
            <Landmark className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-[var(--foreground)]">MortgageLeadHub</p>
            <p className="text-xs text-[var(--muted-foreground)]">Find your inquiry status</p>
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
          <p className="text-[15px] font-semibold text-[var(--foreground)]">Lost your status link?</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted-foreground)]">
            Enter the phone number and last name you used when you submitted your inquiry, and we&apos;ll take you to your
            status page.
          </p>
          <StatusLookupForm />
        </div>
      </div>
    </div>
  );
}
