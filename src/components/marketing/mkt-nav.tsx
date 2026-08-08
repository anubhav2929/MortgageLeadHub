"use client";

import { useState } from "react";
import Link from "next/link";
import { Landmark, Menu, X } from "lucide-react";

const LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/tools", label: "Calculators" },
  { href: "/#faq", label: "FAQ" },
];

export function MktNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--mkt-border)] bg-[var(--mkt-bg)]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--mkt-primary)] text-white">
            <Landmark className="h-4 w-4" />
          </span>
          <span className="whitespace-nowrap text-[15px] font-semibold text-[var(--mkt-ink)]">Equity Flow Group</span>
        </Link>
        <nav className="hidden items-center gap-8 lg:flex">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-[13.5px] text-[var(--mkt-body)] transition-colors hover:text-[var(--mkt-ink)]">
              {link.label}
            </a>
          ))}
          <Link href="/workspace" className="text-[13.5px] text-[var(--mkt-body)] transition-colors hover:text-[var(--mkt-ink)]">
            Officer login
          </Link>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-[var(--mkt-ink)] hover:bg-[var(--mkt-bg-alt)] lg:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-[var(--mkt-border)] px-6 py-3 lg:hidden">
          <div className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-2.5 text-[14px] text-[var(--mkt-body)] transition-colors hover:bg-[var(--mkt-bg-alt)] hover:text-[var(--mkt-ink)]"
              >
                {link.label}
              </a>
            ))}
            <Link
              href="/workspace"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-2.5 text-[14px] text-[var(--mkt-body)] transition-colors hover:bg-[var(--mkt-bg-alt)] hover:text-[var(--mkt-ink)]"
            >
              Officer login
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
