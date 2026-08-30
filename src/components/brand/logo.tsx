import { cn } from "@/lib/utils";

type LogoTone = "brand" | "inverse" | "mono";

const TONES: Record<LogoTone, { deep: string; bright: string; ink: string }> = {
  brand: { deep: "#0E6B4F", bright: "#22A06B", ink: "#111918" },
  inverse: { deep: "#FFFFFF", bright: "#75D5AC", ink: "#FFFFFF" },
  mono: { deep: "currentColor", bright: "currentColor", ink: "currentColor" },
};

/** Home ownership, rising equity, and a flexible path combined into one mark. */
export function LogoMark({ className, tone = "brand", title }: { className?: string; tone?: LogoTone; title?: string }) {
  const colors = TONES[tone];
  return (
    <svg viewBox="0 0 160 150" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      <path d="M25 83V43L80 4l55 39v38" fill="none" stroke={colors.deep} strokeWidth="13" strokeLinejoin="miter" />
      <path d="M45 102V63h20v39zM72 110V43h20v67zM99 103V25h20v78z" fill={colors.bright} />
      <path d="M7 104c28-12 43 13 68 12 29-1 37-29 78-31-24 11-32 47-70 51-31 3-48-26-76-32Z" fill={colors.bright} />
      <path d="M0 105c29-5 48 31 83 31 27 0 48-19 67-34-18 27-40 45-67 47-35 2-56-36-83-44Z" fill={colors.deep} />
    </svg>
  );
}

/** Responsive lockup with live text for crisp rendering and accessibility. */
export function LogoLockup({ className, markClassName, wordmarkClassName, tone = "brand" }: { className?: string; markClassName?: string; wordmarkClassName?: string; tone?: LogoTone }) {
  const colors = TONES[tone];
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label="Equity Flow Group">
      <LogoMark className={cn("h-10 w-10 shrink-0", markClassName)} tone={tone} />
      <span className={cn("flex min-w-0 flex-col leading-none", wordmarkClassName)} aria-hidden="true">
        <span className="whitespace-nowrap text-[17px] font-bold tracking-[-0.035em]" style={{ color: colors.ink }}>Equity Flow</span>
        <span className="mt-1 whitespace-nowrap text-[7px] font-bold tracking-[0.42em]" style={{ color: colors.bright }}>GROUP</span>
      </span>
    </span>
  );
}

export function LogoBadge({ className, markClassName }: { className?: string; markClassName?: string }) {
  return <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center", className)}><LogoMark className={cn("h-9 w-9", markClassName)} /></span>;
}
