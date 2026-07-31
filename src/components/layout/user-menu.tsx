"use client";

import { useState, useTransition } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { logoutAction } from "@/domain/authActions";
import type { User } from "@/domain/types";
import { cn } from "@/lib/utils";

const ROLE_TONE: Record<User["role"], string> = {
  ADMIN: "bg-[var(--violet-tint)] text-[var(--violet)]",
  COMPLIANCE: "bg-[var(--info-tint)] text-[var(--info)]",
  OFFICER: "bg-[var(--primary-tint)] text-[var(--primary)]",
  READ_ONLY: "bg-[var(--background)] text-[var(--muted)]",
};

export function UserMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--background)]"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)] text-[11px] font-semibold text-white">
          {user.name.charAt(0)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-[var(--foreground)]">{user.name}</span>
        </span>
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", ROLE_TONE[user.role])}>{user.role}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
            >
              <div className="border-b border-[var(--border)] px-3 py-2">
                <p className="truncate text-[13px] font-medium text-[var(--foreground)]">{user.name}</p>
                <p className="truncate text-xs text-[var(--muted-foreground)]">{user.email}</p>
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  startTransition(async () => {
                    await logoutAction();
                  });
                }}
                disabled={isPending}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--danger-tint)] disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                Log out
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
