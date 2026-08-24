import { Skeleton } from "@/components/ui/skeleton";

export function RouteLoading({ label = "workspace" }: { label?: string }) {
  return (
    <div className="space-y-5" aria-busy="true" aria-label={`Loading ${label}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2"><Skeleton className="h-8 w-52" /><Skeleton className="h-4 w-80 max-w-full" /></div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <div className="flex gap-2 overflow-hidden border-b border-[var(--border)] pb-2">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-7 w-24 shrink-0 rounded-md" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}
