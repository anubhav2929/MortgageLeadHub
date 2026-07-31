import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
  {
    variants: {
      tone: {
        neutral: "bg-[var(--background)] text-[var(--muted)] ring-[var(--border-strong)]",
        primary: "bg-[var(--primary-tint)] text-[var(--primary)] ring-[color:var(--primary)]/20",
        success: "bg-[var(--success-tint)] text-[var(--success)] ring-[var(--success-border)]",
        warning: "bg-[var(--warning-tint)] text-[var(--warning)] ring-[var(--warning-border)]",
        danger: "bg-[var(--danger-tint)] text-[var(--danger)] ring-[var(--danger-border)]",
        info: "bg-[var(--info-tint)] text-[var(--info)] ring-[var(--info-border)]",
        violet: "bg-[var(--violet-tint)] text-[var(--violet)] ring-[var(--violet-border)]",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-current"
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}
