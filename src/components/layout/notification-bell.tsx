import Link from "next/link";
import { Bell } from "lucide-react";
import { listAllTasks } from "@/domain/queries";
import type { User } from "@/domain/types";

/** Server Component — no client interactivity needed beyond a link, so no
 *  reason to ship this to the client bundle or poll; it's fresh on every
 *  navigation like the rest of the workspace shell. */
export async function NotificationBell({ user }: { user: User }) {
  const allTasks = await listAllTasks();
  const isOfficer = user.role === "OFFICER";
  const mine = isOfficer ? allTasks.filter((t) => t.leadAssignedOfficerId === user.officerId) : allTasks;
  const openCount = mine.filter((t) => t.status === "OPEN").length;
  const overdueCount = mine.filter((t) => t.status === "OPEN" && t.overdue).length;

  return (
    <Link
      href="/workspace/tasks"
      className="focus-ring relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
      aria-label={`${openCount} open tasks${overdueCount > 0 ? `, ${overdueCount} overdue` : ""}`}
      title={`${openCount} open task${openCount === 1 ? "" : "s"}${overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}`}
    >
      <Bell className="h-4.5 w-4.5" />
      {openCount > 0 && (
        <span
          className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ${
            overdueCount > 0 ? "bg-[var(--danger)]" : "bg-[var(--primary)]"
          }`}
        >
          {openCount > 99 ? "99+" : openCount}
        </span>
      )}
    </Link>
  );
}
