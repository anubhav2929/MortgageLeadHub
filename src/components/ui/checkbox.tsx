"use client";

import { Check } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Checkbox = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, checked, ...props }, ref) => {
    return (
      <span className="relative inline-flex h-4.5 w-4.5 shrink-0">
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
          {...props}
        />
        <span
          className={cn(
            "flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border border-[var(--border-strong)] bg-[var(--surface)] transition-all peer-checked:border-[var(--primary)] peer-checked:bg-[var(--primary)] peer-focus-visible:shadow-[var(--shadow-focus)]",
            className
          )}
        >
          <Check
            className="h-3 w-3 text-white opacity-0 transition-opacity peer-checked:opacity-100"
            strokeWidth={3}
          />
        </span>
      </span>
    );
  }
);
Checkbox.displayName = "Checkbox";
