"use client";

import { motion } from "framer-motion";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon,
  trend,
  trendLabel,
  tone = "neutral",
  index = 0,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  trend?: number;
  trendLabel?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  index?: number;
}) {
  const toneColor = {
    neutral: "text-[var(--primary)] bg-[var(--primary-tint)]",
    success: "text-[var(--success)] bg-[var(--success-tint)]",
    warning: "text-[var(--warning)] bg-[var(--warning-tint)]",
    danger: "text-[var(--danger)] bg-[var(--danger-tint)]",
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-[13px] font-medium text-[var(--muted-foreground)]">{label}</p>
          {icon && (
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] [&>svg]:h-4 [&>svg]:w-4", toneColor)}>
              {icon}
            </div>
          )}
        </div>
        <p className="mt-2 text-[26px] font-semibold tracking-tight text-[var(--foreground)]">{value}</p>
        {trend !== undefined && (
          <div
            className={cn(
              "mt-2 inline-flex items-center gap-1 text-xs font-medium",
              trend >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"
            )}
          >
            {trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(trend)}% {trendLabel}
          </div>
        )}
      </Card>
    </motion.div>
  );
}
