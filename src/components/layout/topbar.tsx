import { ShieldAlert } from "lucide-react";
import { UserMenu } from "@/components/layout/user-menu";
import { MobileMenuButton } from "@/components/layout/mobile-menu-button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { getKillSwitch } from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";

export async function Topbar() {
  const [user, killSwitch] = await Promise.all([getCurrentUser(), getKillSwitch()]);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 sm:px-6">
      <MobileMenuButton />
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {killSwitch.isOn && (
          <span className="hidden items-center gap-1.5 rounded-full bg-[var(--danger-tint)] px-2.5 py-1 text-xs font-medium text-[var(--danger)] ring-1 ring-inset ring-[var(--danger-border)] sm:flex">
            <ShieldAlert className="h-3.5 w-3.5" />
            Kill switch active
          </span>
        )}
        <NotificationBell user={user} />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
