"use client";

import { Menu } from "lucide-react";
import { useMobileNav } from "@/components/layout/mobile-nav-context";

export function MobileMenuButton() {
  const { toggle } = useMobileNav();
  return (
    <button
      onClick={toggle}
      className="focus-ring -ml-1.5 flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)] md:hidden"
      aria-label="Open menu"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
