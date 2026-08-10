// The Equity Flow Group mark. A roofline over three rising strokes — the
// home, and the equity building underneath it. Deliberately stroke-based and
// geometric so it stays legible at favicon size (16px) as well as on the
// marketing hero.
//
// Drop-in replacement for the lucide icon that used to stand in here, so it
// takes the same `className` sizing (h-4 w-4, etc.) and inherits `currentColor`
// from whatever badge it sits inside.

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* roofline */}
      <path d="M3.25 10.75 L12 4 L20.75 10.75" />
      {/* equity rising beneath */}
      <path d="M7.5 19.25 V16.25" />
      <path d="M12 19.25 V13.75" />
      <path d="M16.5 19.25 V11.5" />
    </svg>
  );
}

/** Mark inside its brand-colored badge — the standard lockup used in nav bars,
 *  the sidebar, and every standalone public page header. */
export function LogoBadge({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span
      className={
        className ??
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--primary)] text-white"
      }
    >
      <LogoMark className={markClassName ?? "h-[18px] w-[18px]"} />
    </span>
  );
}
