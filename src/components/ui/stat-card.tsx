"use client";

import { motion } from "framer-motion";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * `hero` is for the four numbers an officer should read first — larger type,
 * a tinted icon chip, and a coloured hairline along the top edge so the row
 * reads as a group. `compact` is for secondary metrics that should be
 * available without competing for attention.
 *
 * Before this split every metric on the dashboard had identical visual
 * weight, which is the same as having no hierarchy at all: eight equally
 * loud cards tell you nothing about where to look.
 */
export function StatCard({
  label,
  value,
  icon,
  trend,
  trendLabel,
  tone = "neutral",
  index = 0,
  variant = "compact",
  hint,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  trend?: number;
  trendLabel?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  index?: number;
  variant?: "hero" | "compact";
  /** One short line of context under the value — what "good" looks like. */
  hint?: string;
}) {
  const chip = {
    neutral: "text-[var(--primary)] bg-[var(--primary-tint)]",
    success: "text-[var(--success)] bg-[var(--success-tint)]",
    warning: "text-[var(--warning)] bg-[var(--warning-tint)]",
    danger: "text-[var(--danger)] bg-[var(--danger-tint)]",
  }[tone];

  const rule = {
    neutral: "bg-[var(--primary)]",
    success: "bg-[var(--success)]",
    warning: "bg-[var(--warning)]",
    danger: "bg-[var(--danger)]",
  }[tone];

  const isHero = variant === "hero";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card
        className={cn(
          "group relative overflow-hidden transition-shadow duration-200 hover:shadow-[var(--shadow-md)]",
          isHero ? "p-5" : "p-4"
        )}
      >
        {isHero && <span className={cn("absolute inset-x-0 top-0 h-[3px]", rule)} aria-hidden />}

        <div className="flex items-start justify-between gap-3">
          <p
            className={cn(
              "font-medium text-[var(--muted-foreground)]",
              isHero ? "text-[13px]" : "text-xs"
            )}
          >
            {label}
          </p>
          {icon && (
            <div
              className={cn(
                "flex items-center justify-center rounded-[var(--radius-sm)] transition-transform duration-200 group-hover:scale-105",
                isHero ? "h-9 w-9 [&>svg]:h-[18px] [&>svg]:w-[18px]" : "h-7 w-7 [&>svg]:h-3.5 [&>svg]:w-3.5",
                chip
              )}
            >
              {icon}
            </div>
          )}
        </div>

        <p
          className={cn(
            "mt-2 font-semibold tracking-tight tabular-nums text-[var(--foreground)]",
            isHero ? "text-[32px] leading-none" : "text-[22px] leading-none"
          )}
        >
          {value}
        </p>

        {hint && <p className="mt-2 text-xs leading-snug text-[var(--muted-foreground)]">{hint}</p>}

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
