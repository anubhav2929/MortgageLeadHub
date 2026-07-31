"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { requestPasswordResetAction } from "@/domain/authActions";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await requestPasswordResetAction(email);
      setMessage(result.message);
    });
  }

  if (message) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--foreground)]">{message}</p>
        <Link href="/login" className="text-xs text-[var(--primary)] hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-xs text-[var(--muted-foreground)]">Enter your email and we&apos;ll send you a link to reset your password.</p>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </div>
      <Button type="submit" className="w-full" loading={isPending}>
        Send reset link
      </Button>
      <p className="text-center text-xs text-[var(--muted-foreground)]">
        <Link href="/login" className="text-[var(--primary)] hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
