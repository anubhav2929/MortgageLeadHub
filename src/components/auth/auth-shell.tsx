import { Landmark } from "lucide-react";
import { Card } from "@/components/ui/card";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--background)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--primary)] text-white">
            <Landmark className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">MortgageLeadHub</p>
            <p className="text-xs text-[var(--muted-foreground)]">{subtitle}</p>
          </div>
        </div>
        <Card className="p-6">
          <h1 className="mb-5 text-lg font-semibold text-[var(--foreground)]">{title}</h1>
          {children}
        </Card>
      </div>
    </div>
  );
}
