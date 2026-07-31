"use client";

import { useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { submitBorrowerMessageAction } from "@/domain/actions";

export function StatusMessageForm({ publicRef }: { publicRef: string }) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit() {
    const trimmed = message.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    submitBorrowerMessageAction(publicRef, trimmed).then((result) => {
      setSubmitting(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage("");
      setSent(true);
    });
  }

  return (
    <div className="mt-6 border-t border-[var(--border)] pt-5">
      <label htmlFor="status-message" className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">
        Ask a question or tell us something
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="status-message"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (sent) setSent(false);
          }}
          placeholder="e.g. My phone number changed"
          rows={2}
          className="min-w-0 flex-1 resize-none rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--background)] px-2.5 py-2 text-[13px] text-[var(--foreground)] focus-ring"
        />
        <button
          onClick={onSubmit}
          disabled={submitting || !message.trim()}
          aria-label="Send message"
          className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
      {sent && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--success)]">
          <CheckCircle2 className="h-3.5 w-3.5" /> Sent — your loan officer will see this.
        </p>
      )}
    </div>
  );
}
