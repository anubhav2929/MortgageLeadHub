import { AlertTriangle } from "lucide-react";
import { capabilities } from "@/lib/env";

// SPEC.md F-15 — persistent banner required on every surface, but its claim
// has to track reality: once real Twilio/Resend keys are configured, "no
// real calls, texts, or emails are sent" is simply false.
export function DemoBanner() {
  const anyChannelLive = capabilities.hasTwilio || capabilities.hasResend || capabilities.hasLiveVoiceAgent;

  return (
    <div
      role="region"
      aria-label="Environment status"
      className="flex items-center justify-center gap-2 bg-[#1d1b3a] px-4 py-1.5 text-center text-xs font-medium text-white"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
      <span>
        {anyChannelLive
          ? "LIVE — this deployment sends real calls, texts, and/or emails where configured."
          : "DEMO — synthetic data only, not a live service. No real calls, texts, or emails are sent."}
      </span>
    </div>
  );
}
