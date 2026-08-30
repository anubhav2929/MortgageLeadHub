import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OperationalDiagnostics } from "@/domain/operationalDiagnostics";
import { formatDateTime } from "@/lib/utils";

export function OperationsPanel({ diagnostics }: { diagnostics: OperationalDiagnostics }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Telnyx signed webhooks</CardTitle>
            <CardDescription>Use these values on the messaging profile for inbound and delivery events.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-[13px]">
            <div><Badge tone={diagnostics.telnyxSignedWebhooksReady ? "success" : "warning"}>{diagnostics.telnyxSignedWebhooksReady ? "Signature ready" : "Public key missing"}</Badge></div>
            <div><p className="text-xs text-[var(--muted-foreground)]">Effective production origin ({diagnostics.publicUrlSource})</p><code className="break-all">{diagnostics.publicAppUrl}</code></div>
            {diagnostics.publicUrlWarning && <p className="rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-tint)] px-2.5 py-2 text-xs">{diagnostics.publicUrlWarning}</p>}
            <div><p className="text-xs text-[var(--muted-foreground)]">Primary</p><code className="break-all">{diagnostics.telnyxPrimaryUrl}</code></div>
            <div><p className="text-xs text-[var(--muted-foreground)]">Failover</p><code className="break-all">{diagnostics.telnyxFailoverUrl}</code></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Runtime readiness</CardTitle>
            <CardDescription>Non-billable configuration checks only.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-[13px]">
            <Readiness label="Durable webhook queue" ready={diagnostics.queueAvailable} />
            <Readiness label="Vapi saved assistant" ready={diagnostics.capabilities.hasVoiceAgent} />
            <Readiness label={`Timezone: ${diagnostics.adminTimezone}`} ready={diagnostics.timezoneConfirmed} />
            <Readiness label="Any CRM AI provider" ready={diagnostics.capabilities.hasAnyLlm} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Webhook inbox</CardTitle><CardDescription>Provider events are deduplicated before processing.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.keys(diagnostics.webhookCounts).length === 0 ? <p className="text-[13px] text-[var(--muted-foreground)]">No queued events.</p> :
            Object.entries(diagnostics.webhookCounts).map(([status, count]) => <Badge key={status} tone={status === "DEAD" || status === "QUARANTINED" ? "danger" : status === "COMPLETED" ? "success" : "neutral"}>{status}: {count}</Badge>)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Unmatched inbound calls</CardTitle><CardDescription>Only exact, unique E.164 matches attach automatically.</CardDescription></CardHeader>
        <CardContent>
          {diagnostics.inboundCallTriage.length === 0 ? <p className="text-[13px] text-[var(--muted-foreground)]">No calls need matching.</p> : (
            <ul className="divide-y divide-[var(--border)]">
              {diagnostics.inboundCallTriage.map((item) => <li key={item.id} className="py-2 text-[13px]">{item.fromPhone ?? "Unknown caller"} · {item.reason.replaceAll("_", " ")} · {formatDateTime(item.receivedAt, diagnostics.adminTimezone)}</li>)}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent AI routing</CardTitle><CardDescription>Provider/model selection, latency, and failures for this warm runtime.</CardDescription></CardHeader>
        <CardContent>
          {diagnostics.aiUsage.length === 0 ? <p className="text-[13px] text-[var(--muted-foreground)]">No AI requests recorded on this runtime.</p> : (
            <ul className="divide-y divide-[var(--border)]">
              {diagnostics.aiUsage.map((sample, index) => <li key={`${sample.at}-${index}`} className="flex flex-wrap justify-between gap-2 py-2 text-[13px]"><span>{sample.operation} · {sample.provider}/{sample.model}</span><span className={sample.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}>{sample.ok ? `${sample.durationMs} ms` : sample.error}</span></li>)}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Readiness({ label, ready }: { label: string; ready: boolean }) {
  return <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3"><span>{label}</span><Badge tone={ready ? "success" : "warning"}>{ready ? "Ready" : "Action needed"}</Badge></div>;
}
