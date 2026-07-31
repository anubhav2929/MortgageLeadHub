"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { motion, type HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow-xs)] hover:bg-[var(--primary-hover)]",
        secondary:
          "bg-[var(--surface)] text-[var(--foreground)] border border-[var(--border-strong)] shadow-[var(--shadow-xs)] hover:bg-[var(--background)]",
        ghost: "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]",
        danger:
          "bg-[var(--danger)] text-white shadow-[var(--shadow-xs)] hover:opacity-90",
        outlineDanger:
          "bg-[var(--surface)] text-[var(--danger)] border border-[var(--danger-border)] hover:bg-[var(--danger-tint)]",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-3.5",
        lg: "h-11 px-5 text-[15px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends Omit<HTMLMotionProps<"button">, "ref" | "children">,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  children?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: 0.12 }}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {children}
      </motion.button>
    );
  }
);
Button.displayName = "Button";
