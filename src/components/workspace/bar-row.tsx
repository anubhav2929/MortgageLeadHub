"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function BarRow({
  label,
  value,
  max,
  displayValue,
  tone = "primary",
  index = 0,
}: {
  label: string;
  value: number;
  max: number;
  displayValue?: string;
  tone?: "primary" | "danger" | "warning" | "neutral";
  index?: number;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  const color = {
    primary: "bg-[var(--primary)]",
    danger: "bg-[var(--danger)]",
    warning: "bg-[var(--warning)]",
    neutral: "bg-[var(--muted-foreground)]",
  }[tone];

  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 truncate text-[13px] text-[var(--muted)]">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--background)]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, delay: index * 0.03, ease: [0.16, 1, 0.3, 1] }}
          className={cn("h-full rounded-full", color)}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-[13px] font-medium tabular-nums text-[var(--foreground)]">
        {displayValue ?? value}
      </span>
    </div>
  );
}
