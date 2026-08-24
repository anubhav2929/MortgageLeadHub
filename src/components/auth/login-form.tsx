"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { loginAction } from "@/domain/authActions";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await loginAction(email, password, mfaCode || undefined);
      // A successful login redirects server-side and never returns here.
      if (result && !result.ok) {
        setMfaRequired(Boolean(result.mfaRequired));
        setError(result.message);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </div>
      {mfaRequired && <div><Label htmlFor="mfaCode">Authenticator or recovery code</Label><Input id="mfaCode" autoComplete="one-time-code" inputMode="numeric" required value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} placeholder="123456" /></div>}
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
      </div>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <Button type="submit" className="w-full" loading={isPending}>
        Sign in
      </Button>
      <p className="text-center text-xs text-[var(--muted-foreground)]">
        <Link href="/forgot-password" className="text-[var(--primary)] hover:underline">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
