"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, ShieldOff, ShieldCheck, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createUserAction, resendInviteAction, setUserActiveAction, type CreateUserInput } from "@/domain/actions";
import { formatDate } from "@/lib/utils";
import type { Role, User } from "@/domain/types";

const ROLE_TONE: Record<Role, "violet" | "info" | "primary" | "neutral"> = {
  ADMIN: "violet",
  COMPLIANCE: "info",
  OFFICER: "primary",
  READ_ONLY: "neutral",
};

const US_STATES = ["AZ", "CA", "CO", "FL", "GA", "IL", "NC", "NY", "OH", "OR", "PA", "TX", "WA"];

export function UsersPanel({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("OFFICER");
  const [nmlsId, setNmlsId] = useState("");
  const [states, setStates] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function toggleState(code: string) {
    setStates((s) => (s.includes(code) ? s.filter((x) => x !== code) : [...s, code]));
  }

  function reset() {
    setName("");
    setEmail("");
    setPhone("");
    setRole("OFFICER");
    setNmlsId("");
    setStates([]);
  }

  function submit() {
    const input: CreateUserInput = { name, email, phone: phone || undefined, role, nmlsId: nmlsId || undefined, licensedStates: states };
    startTransition(async () => {
      const result = await createUserAction(input);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) {
        setOpen(false);
        reset();
      }
      router.refresh();
    });
  }

  function toggleActive(userId: string, isActive: boolean) {
    startTransition(async () => {
      const result = await setUserActiveAction(userId, !isActive);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  function resendInvite(userId: string) {
    startTransition(async () => {
      const result = await resendInviteAction(userId);
      push({ title: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] text-[var(--muted-foreground)]">
          {users.length} user{users.length === 1 ? "" : "s"} with portal access.
        </p>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New user
        </Button>
      </div>

      <Card>
        <CardContent className="divide-y divide-[var(--border)] p-0">
          {users.map((u) => {
            const active = u.isActive !== false;
            const activated = !!u.passwordHash;
            return (
              <div key={u.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary-tint)] text-[12px] font-semibold text-[var(--primary)]">
                    {u.name.charAt(0)}
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-[var(--foreground)]">{u.name}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {u.email}
                      {u.createdAt ? ` · added ${formatDate(u.createdAt)}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={ROLE_TONE[u.role]}>{u.role.replace("_", " ")}</Badge>
                  {!active ? (
                    <Badge tone="danger">Revoked</Badge>
                  ) : activated ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="warning">Invited</Badge>
                  )}
                  {active && !activated && (
                    <Button variant="ghost" size="sm" loading={isPending} onClick={() => resendInvite(u.id)}>
                      <Send className="h-3.5 w-3.5" /> Resend invite
                    </Button>
                  )}
                  {u.id !== currentUserId && (
                    <Button variant="ghost" size="sm" loading={isPending} onClick={() => toggleActive(u.id, active)}>
                      {active ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a new user"
        description="Officers also get an Officer record so they can be routed leads immediately."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={isPending} onClick={submit} disabled={!name.trim() || !email.trim()}>
              Create user
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label>Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Reyes" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@equityflowgroup.com" />
          </div>
          <div>
            <Label>Phone (optional)</Label>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-0142" />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Send a welcome text here too, not just email.</p>
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="OFFICER">Officer</option>
              <option value="COMPLIANCE">Compliance</option>
              <option value="ADMIN">Admin</option>
              <option value="READ_ONLY">Read only</option>
            </Select>
          </div>
          {role === "OFFICER" && (
            <>
              <div>
                <Label>NMLS ID (optional)</Label>
                <Input value={nmlsId} onChange={(e) => setNmlsId(e.target.value)} placeholder="NMLS-000000" />
              </div>
              <div>
                <Label>Licensed states</Label>
                <div className="flex flex-wrap gap-1.5">
                  {US_STATES.map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleState(code)}
                      className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                        states.includes(code)
                          ? "border-[var(--primary)] bg-[var(--primary-tint)] text-[var(--primary)]"
                          : "border-[var(--border-strong)] text-[var(--muted)]"
                      }`}
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
