"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { lookupStatusAction } from "@/domain/actions";

export function StatusLookupForm() {
  const [phone, setPhone] = useState("");
  const [lastName, setLastName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await lookupStatusAction(phone, lastName);
    setSubmitting(false);
    if (!result.ok || !result.statusToken) {
      setError(result.message);
      return;
    }
    router.push(`/status/${result.statusToken}`);
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-3.5">
      <div>
        <label htmlFor="lookup-phone" className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
          Phone number
        </label>
        <input
          id="lookup-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 555-0142"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-[13.5px] text-[var(--foreground)] focus-ring"
        />
      </div>
      <div>
        <label htmlFor="lookup-lastname" className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
          Last name used on the inquiry
        </label>
        <input
          id="lookup-lastname"
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Reyes"
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
        disabled={submitting || !phone.trim() || !lastName.trim()}
        className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--primary)] px-4 py-2.5 text-[13.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <Search className="h-4 w-4" />
        {submitting ? "Looking up…" : "Find my inquiry"}
      </button>
    </form>
  );
}
