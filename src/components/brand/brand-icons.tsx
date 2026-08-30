import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;
const shared = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function HomeEquityIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props} {...shared}><path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></svg>;
}
export function GrowthIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props} {...shared}><path d="M5 20v-5h3v5M10.5 20v-9h3v9M16 20V6h3v14" /></svg>;
}
export function FlowIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props} {...shared}><path d="M3 9c3-2.6 5.8-2.6 8.5 0s5.6 2.6 9.5 0M3 15c3-2.6 5.8-2.6 8.5 0s5.6 2.6 9.5 0" /></svg>;
}
export function TrustIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props} {...shared}><path d="M12 3 19 6v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>;
}
export function BrandIconBadge({ children }: { children: React.ReactNode }) {
  return <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#22A06B]/20 bg-[var(--primary-tint)] text-[var(--primary)]">{children}</span>;
}
