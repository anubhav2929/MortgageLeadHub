import { ShieldCheck, Lock, BadgeCheck, Users } from "lucide-react";

const ITEMS = [
  { icon: BadgeCheck, label: "NMLS licensed officers" },
  { icon: Lock, label: "Bank-level encryption" },
  { icon: ShieldCheck, label: "TCPA-compliant outreach" },
  { icon: Users, label: "Equal Housing Lender" },
];

export function TrustBar() {
  return (
    <section className="border-y border-[var(--mkt-border)] bg-white">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="grid grid-cols-2 gap-y-4 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
          {ITEMS.map((item) => (
            <div key={item.label} className="flex items-center gap-2.5">
              <item.icon className="h-4 w-4 shrink-0 text-[var(--mkt-primary)]" />
              <span className="text-[13px] font-medium text-[var(--mkt-body)]">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
