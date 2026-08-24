import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading administration">
      <div className="space-y-2"><Skeleton className="h-8 w-40" /><Skeleton className="h-4 w-72 max-w-full" /></div>
      <Skeleton className="h-10 w-full rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-64 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>
    </div>
  );
}
