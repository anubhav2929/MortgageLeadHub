import { AlertTriangle } from "lucide-react";
import { getCapabilities } from "@/lib/runtimeConfig";
import { getSystemConfig } from "@/domain/queries";
import { describeEnvironment, shouldShowBanner } from "@/core/environmentBanner";

// SPEC.md F-15 — environment status banner.
//
// Its claim has to track reality. The previous version hardcoded "synthetic
// data only, not a live service", which was false in two directions: it stayed
// reassuring after real carrier keys were configured, and it was already wrong
// for lead discovery, which reads real public posts by real people regardless
// of credentials.
//
// The wording is now derived from live capabilities in core/environmentBanner.ts
// (pure, unit-tested), and whether it renders at all is an admin setting.
export async function DemoBanner() {
  const [caps, config] = await Promise.all([getCapabilities(), getSystemConfig()]);

  const env = describeEnvironment({
    hasSms: caps.hasSms,
    hasVoice: caps.hasVoice,
    hasVoiceAgent: caps.hasVoiceAgent,
    hasResend: caps.hasResend,
    hasLeadDiscovery: caps.hasLeadDiscovery,
  });

  // Undefined means "never configured", which for an existing deployment
  // should behave the way it always has — visible.
  if (!shouldShowBanner(env.level, config.showEnvironmentBanner !== false)) return null;

  return (
    <div
      role="region"
      aria-label="Environment status"
      className="flex items-center justify-center gap-2 bg-[var(--foreground)] px-4 py-1.5 text-center text-xs font-medium text-white"
    >
      <AlertTriangle
        className={`h-3.5 w-3.5 shrink-0 ${env.level === "DEMO" ? "text-amber-300" : "text-emerald-300"}`}
      />
      <span>{env.message}</span>
    </div>
  );
}
