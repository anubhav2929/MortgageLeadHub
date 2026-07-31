"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

/** Shared by /accept-invite and /reset-password — both are "pick a password
 *  for this token" forms that differ only in which action they call. */
export function SetPasswordForm({
  action,
  submitLabel,
}: {
  action: (token: string, password: string) => Promise<{ ok: boolean; message: string }>;
  submitLabel: string;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    startTransition(async () => {
      const result = await action(token, password);
      // Success redirects server-side and never returns here.
      if (result && !result.ok) setError(result.message);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="password">New password</Label>
        <Input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
      </div>
      <div>
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
      </div>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <Button type="submit" className="w-full" loading={isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}
