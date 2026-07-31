"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Settings, ExternalLink, Landmark, Radar, CheckSquare, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useMobileNav } from "@/components/layout/mobile-nav-context";

const NAV = [
  { href: "/workspace", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/workspace/leads", label: "Leads", icon: Users, exact: false },
  { href: "/workspace/tasks", label: "Tasks", icon: CheckSquare, exact: false },
  { href: "/workspace/discovery", label: "Lead Discovery", icon: Radar, exact: false },
  { href: "/workspace/admin", label: "Admin", icon: Settings, exact: false },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <div className="flex items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary)] text-white">
            <Landmark className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[13px] font-semibold leading-tight text-[var(--foreground)]">MortgageLeadHub</p>
            <p className="text-[11px] leading-tight text-[var(--muted-foreground)]">Officer workspace</p>
          </div>
        </div>
        {onNavigate && (
          <button onClick={onNavigate} className="focus-ring rounded-md p-1 text-[var(--muted-foreground)] md:hidden">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "focus-ring relative flex items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "text-[var(--primary)]"
                  : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
              )}
            >
              {active && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-[var(--radius-md)] bg-[var(--primary-tint)]"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <Icon className="relative z-10 h-4 w-4" />
              <span className="relative z-10">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[var(--border)] p-3">
        <Link
          href="/apply"
          target="_blank"
          className="focus-ring flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-[13px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)]"
        >
          <span>View public intake</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </>
  );
}

export function Sidebar() {
  const { open, close } = useMobileNav();

  return (
    <>
      {/* Desktop: static sidebar, always visible */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] md:flex">
        <SidebarContent />
      </aside>

      {/* Mobile: slide-in drawer */}
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-40 md:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/30"
              onClick={close}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 40 }}
              className="relative flex h-full w-72 max-w-[80vw] flex-col border-r border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
            >
              <SidebarContent onNavigate={close} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
