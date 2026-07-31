"use client";

import { useState } from "react";
import { CheckCircle2, BellOff } from "lucide-react";
import { selfServeOptOutAction } from "@/domain/actions";

export function UnsubscribeForm() {
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await selfServeOptOutAction(phone);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="mt-5 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--success)]/30 bg-[var(--success-tint)] px-3.5 py-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />
        <p className="text-[13px] leading-relaxed text-[var(--foreground)]">
          You&apos;re opted out. We won&apos;t call, text, or email that number again.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-3.5">
      <div>
        <label htmlFor="unsub-phone" className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
          Phone number
        </label>
        <input
          id="unsub-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 555-0142"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-[13.5px] text-[var(--foreground)] focus-ring"
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting || !phone.trim()}
        className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--foreground)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <BellOff className="h-4 w-4" />
        {submitting ? "Opting out…" : "Opt me out"}
      </button>
    </form>
  );
}
