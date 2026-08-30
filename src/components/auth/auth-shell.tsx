import { LogoLockup } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-[var(--background)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <LogoLockup markClassName="h-11 w-11" />
          <p className="ml-[54px] -mt-1 text-xs text-[var(--muted-foreground)]">{subtitle}</p>
        </div>
        <Card className="p-6">
          <h1 className="mb-5 text-lg font-semibold text-[var(--foreground)]">{title}</h1>
          {children}
        </Card>
      </div>
    </main>
  );
}
