import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "focus-ring h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] transition-shadow",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

/** A dollar-amount input that displays comma grouping while typing (e.g.
 *  "450,000") but hands the parent a plain digit string ("450000") — plain
 *  `type="number"` inputs can't render thousands separators at all, which
 *  made every home-value/balance field hard to read at a glance. The `$`
 *  prefix is rendered *inside* this component (not by wrapping it at the
 *  call site) so this stays a single element — callers that pass it through
 *  `Field`'s `cloneElement`-based id/aria wiring need the id to land on the
 *  actual `<input>`, not on an outer positioning `<div>`. */
export const CurrencyInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
    value: string;
    onChange: (rawDigits: string) => void;
    prefix?: string;
  }
>(({ className, value, onChange, prefix, ...props }, ref) => {
  const digits = value.replace(/[^\d]/g, "");
  const display = digits ? Number(digits).toLocaleString("en-US") : "";
  const input = (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
      className={cn(
        "focus-ring h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] transition-shadow",
        prefix ? "pl-6 pr-3" : "px-3",
        className
      )}
      {...props}
    />
  );
  if (!prefix) return input;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted-foreground)]">{prefix}</span>
      {input}
    </div>
  );
});
CurrencyInput.displayName = "CurrencyInput";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        "focus-ring w-full rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] transition-shadow",
        className
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-[13px] font-medium text-[var(--foreground)]", className)}
      {...props}
    />
  );
}

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => {
  return (
    <select
      ref={ref}
      className={cn(
        "focus-ring h-9 w-full appearance-none rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 pr-8 text-sm text-[var(--foreground)] bg-[url('data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%226%22%20viewBox%3D%220%200%2010%206%22%3E%3Cpath%20fill%3D%22%2398a2b3%22%20d%3D%22M0%200l5%206%205-6z%22%2F%3E%3C%2Fsvg%3E')] bg-[right_0.75rem_center] bg-no-repeat",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
});
Select.displayName = "Select";
