"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { beginMfaEnrollmentAction, changeOwnAccountAction, confirmMfaEnrollmentAction } from "@/domain/authActions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function AccountSecurityCard({ currentEmail, mfaEnabled }: { currentEmail: string; mfaEnabled: boolean }) {
  const [email, setEmail] = useState(currentEmail);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();

  function save() {
    if (newPassword && newPassword !== confirm) {
      push({ title: "New passwords do not match.", tone: "danger" });
      return;
    }
    startTransition(async () => {
      const result = await changeOwnAccountAction({ currentPassword, email, newPassword: newPassword || undefined });
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirm("");
      }
    });
  }

  function beginMfa() {
    startTransition(async () => {
      const result = await beginMfaEnrollmentAction(currentPassword);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok && result.secret) setMfaSecret(result.secret);
    });
  }

  function confirmMfa() {
    startTransition(async () => {
      const result = await confirmMfaEnrollmentAction(mfaCode);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.recoveryCodes) setRecoveryCodes(result.recoveryCodes);
    });
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <div>
          <CardTitle><KeyRound className="mr-1.5 inline h-4 w-4" />Your login and password</CardTitle>
          <CardDescription>Change your own login email or password. Saving signs out every other session.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div><Label>Login email</Label><Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
        <div><Label>Current password</Label><Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
        <div><Label>New password (optional)</Label><Input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 12 characters" /></div>
        <div><Label>Confirm new password</Label><Input type="password" autoComplete="new-password" minLength={12} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></div>
        <div className="md:col-span-2"><Button loading={pending} disabled={!currentPassword || !email.trim()} onClick={save}>Update security settings</Button></div>
        <div className="md:col-span-2 border-t border-[var(--border)] pt-4">
          <p className="text-sm font-medium">Authenticator MFA · {mfaEnabled || recoveryCodes.length ? "Enabled" : "Not enabled"}</p>
          {!mfaEnabled && !recoveryCodes.length && !mfaSecret && <Button className="mt-2" variant="secondary" loading={pending} disabled={!currentPassword} onClick={beginMfa}>Set up authenticator</Button>}
          {mfaSecret && !recoveryCodes.length && <div className="mt-3 space-y-2"><p className="text-xs text-[var(--muted-foreground)]">Enter this setup key in your authenticator app:</p><code className="block break-all rounded bg-[var(--muted)] p-2 text-xs">{mfaSecret}</code><Label>Current six-digit code</Label><Input autoComplete="one-time-code" inputMode="numeric" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} /><Button loading={pending} disabled={!/^\d{6}$/.test(mfaCode)} onClick={confirmMfa}>Confirm MFA</Button></div>}
          {recoveryCodes.length > 0 && <div className="mt-3"><p className="text-xs font-medium text-[var(--danger)]">Copy these one-time recovery codes now. They will not be shown again.</p><code className="mt-2 grid grid-cols-2 gap-1 rounded bg-[var(--muted)] p-3 text-xs">{recoveryCodes.map((code) => <span key={code}>{code}</span>)}</code></div>}
        </div>
      </CardContent>
    </Card>
  );
}
