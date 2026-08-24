"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { createContext, useContext, useId, useState } from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  layoutId: string;
  pending: boolean;
}
const TabsContext = createContext<TabsContextValue | null>(null);

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
  className,
  pending = false,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  pending?: boolean;
}) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const layoutId = useId();
  const current = value ?? internal;
  const setValue = (v: string) => {
    setInternal(v);
    onValueChange?.(v);
  };
  return (
    <TabsContext.Provider value={{ value: current, setValue, layoutId, pending }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex snap-x snap-mandatory items-center gap-1 overflow-x-auto overscroll-x-contain border-b border-[var(--border)] pb-px [scrollbar-width:thin]",
        className
      )}
      role="tablist"
      aria-label="Page sections"
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("TabsTrigger must be used within Tabs");
  const active = ctx.value === value;
  const baseId = `tabs-${ctx.layoutId.replace(/:/g, "")}-${value}`;
  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const index = tabs.indexOf(event.currentTarget);
    if (index < 0 || tabs.length === 0) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : event.key === "ArrowRight" ? (index + 1) % tabs.length
          : (index - 1 + tabs.length) % tabs.length;
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  }
  return (
    <button
      type="button"
      onClick={() => ctx.setValue(value)}
      onKeyDown={onKeyDown}
      role="tab"
      aria-selected={active}
      aria-controls={`${baseId}-panel`}
      id={`${baseId}-tab`}
      tabIndex={active ? 0 : -1}
      className={cn(
        "focus-ring relative shrink-0 snap-start px-3.5 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap",
        active ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
        className
      )}
    >
      {children}
      {active && ctx.pending && <Loader2 aria-hidden className="ml-1.5 inline h-3 w-3 animate-spin text-[var(--primary)]" />}
      {active && (
        <motion.div
          layoutId={`tab-underline-${ctx.layoutId}`}
          className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--primary)]"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("TabsContent must be used within Tabs");
  if (ctx.value !== value) return null;
  const baseId = `tabs-${ctx.layoutId.replace(/:/g, "")}-${value}`;
  return (
    <motion.div
      key={value}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={className}
      role="tabpanel"
      id={`${baseId}-panel`}
      aria-labelledby={`${baseId}-tab`}
      aria-live="polite"
    >
      {children}
    </motion.div>
  );
}
