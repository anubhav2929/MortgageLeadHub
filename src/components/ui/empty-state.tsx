import { type LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--background)]">
        <Icon className="h-5 w-5 text-[var(--muted-foreground)]" />
      </div>
      <p className="text-sm font-medium text-[var(--foreground)]">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-[var(--muted-foreground)]">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
