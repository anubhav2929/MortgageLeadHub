import Link from "next/link";
import { CheckCircle2, CircleDashed, ExternalLink, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { capabilities } from "@/lib/env";
import { formatDateTime } from "@/lib/utils";
import type { FailedAttemptItem } from "@/domain/queries";

const ROWS = [
  {
    key: "hasTwilio" as const,
    name: "Twilio — SMS & voice",
    envVars: "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER",
    liveNote: "Call now / Text actions send real SMS and place real outbound calls.",
    simNote: "Call now / Text actions are simulated and only write to the timeline.",
  },
  {
    key: "hasAnthropic" as const,
    name: "Anthropic — structured extraction",
    envVars: "ANTHROPIC_API_KEY",
    liveNote: "Conversation → Run AI extraction calls Claude with a schema-constrained tool.",
    simNote: "Run AI extraction uses a deterministic keyword scan of the transcript instead.",
  },
  {
    key: "hasResend" as const,
    name: "Resend — email",
    envVars: "RESEND_API_KEY, RESEND_FROM_EMAIL",
    liveNote: "Email actions send a real message.",
    simNote: "Email actions are simulated and only write to the timeline.",
  },
  {
    key: "hasLiveVoiceAgent" as const,
    name: "Voice AI agent (Vapi)",
    envVars: "VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, VAPI_WEBHOOK_SECRET",
    liveNote: "The \"AI call\" action places a real outbound call; the transcript streams in via /api/webhooks/vapi.",
    simNote: "Not configured, or only the API key is set — all three env vars are needed to go live (see adapters/voiceAgent.ts).",
  },
  {
    key: "hasLeadDiscovery" as const,
    name: "Lead discovery (Reddit search)",
    envVars: "REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET",
    liveNote: "Searches live public posts for refinance/equity intent. Signals still require manual review — see Lead Discovery.",
    simNote: "Returns a fixed set of example posts so the review queue is demoable without a key.",
  },
  {
    key: "hasPropertyData" as const,
    name: "Property valuation / AVM (RentCast)",
    envVars: "PROPERTY_DATA_API_KEY",
    liveNote: "Live AVM lookups for leads that gave a street address (free tier: 50/month, cached per lead).",
    simNote: "Not configured — property valuation uses a deterministic simulated estimate.",
  },
];

export function IntegrationsPanel({ recentFailures }: { recentFailures: FailedAttemptItem[] }) {
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[var(--muted-foreground)]">
        Drop real keys into <code className="rounded bg-[var(--background)] px-1 py-0.5 text-xs">.env.local</code> (see{" "}
        <code className="rounded bg-[var(--background)] px-1 py-0.5 text-xs">.env.example</code>) and restart the
        server — every channel below flips from simulated to live with no code changes.
      </p>
      <Card>
        <CardContent className="divide-y divide-[var(--border)] p-0">
          {ROWS.map((row) => {
            const live = capabilities[row.key];
            return (
              <div key={row.key} className="flex items-start justify-between gap-4 px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-[var(--foreground)]">{row.name}</p>
                    <Badge tone={live ? "success" : "neutral"}>{live ? "Live" : "Simulated"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">{live ? row.liveNote : row.simNote}</p>
                  <p className="mt-1 font-mono text-[11px] text-[var(--muted-foreground)]">{row.envVars}</p>
                </div>
                {live ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />
                ) : (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
      <a
        href="https://console.anthropic.com"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        console.anthropic.com <ExternalLink className="h-3 w-3" />
      </a>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recent delivery failures</CardTitle>
            <CardDescription>Attempts a provider actually rejected — a live integration with recurring failures here needs attention, not just a green &quot;Live&quot; badge above.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className={recentFailures.length === 0 ? "" : "divide-y divide-[var(--border)] p-0"}>
          {recentFailures.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No recent failures" />
          ) : (
            recentFailures.map((f, i) => (
              <Link
                key={i}
                href={`/workspace/leads/${f.leadPublicRef}`}
                className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-[var(--background)]"
              >
                <span className="text-[13px] font-medium text-[var(--foreground)]">{f.leadFullName}</span>
                <span className="flex items-center gap-1.5 text-xs text-[var(--danger)]">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {f.channel} · {formatDateTime(f.scheduledFor)}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
