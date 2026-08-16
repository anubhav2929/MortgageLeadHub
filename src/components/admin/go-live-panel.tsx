import { AlertOctagon, CheckCircle2, CircleAlert, CircleSlash } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReadinessItem, GoLiveVerdict } from "@/core/goLive";

/**
 * "If I paste my keys in, will anything still be pretending?"
 *
 * That question previously had no answer in the product. A simulated send
 * looks identical to a real one — the attempt is logged, the lead advances,
 * the UI is the same — so the only way to find out was to read server logs or
 * wait for a borrower who never got called.
 */
const STATUS_META = {
  LIVE: { icon: CheckCircle2, tone: "success" as const, label: "Live" },
  DEGRADED: { icon: CircleAlert, tone: "warning" as const, label: "Degraded" },
  OFF: { icon: CircleSlash, tone: "danger" as const, label: "Not live" },
};

export function GoLivePanel({ items, verdict }: { items: ReadinessItem[]; verdict: GoLiveVerdict }) {
  return (
    <div className="space-y-4">
      <Card
        className={
          verdict.automationReady
            ? "border-[var(--success)] bg-[var(--success-tint)]"
            : "border-[var(--danger)] bg-[var(--danger-tint)]"
        }
      >
        <CardContent className="flex items-start gap-3 p-5">
          {verdict.automationReady ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--success)]" />
          ) : (
            <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--danger)]" />
          )}
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-[var(--foreground)]">
              {verdict.automationReady
                ? "A new lead will be contacted automatically, for real."
                : "A new lead would NOT be contacted automatically right now."}
            </p>
            <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
              {verdict.automationReady
                ? `All ${verdict.totalCount} checks pass. Submitting the intake form triggers the cadence, and every outbound message leaves the server.`
                : // Naming the count matters: an operator who has entered every
                  // API key needs to understand that the remaining gap is not a
                  // key at all.
                  `${verdict.blockers.length} of ${verdict.totalCount} checks block automatic outreach. Until they clear, leads sit waiting for someone to act by hand.`}
            </p>
            {!verdict.automationReady && (
              <ul className="mt-2.5 space-y-1">
                {verdict.blockers.map((b) => (
                  <li key={b.id} className="text-[13px] text-[var(--foreground)]">
                    <span className="font-medium">{b.label}</span>
                    {b.missingKeys.length > 0 && (
                      <span className="text-[var(--muted-foreground)]"> — needs {b.missingKeys.join(", ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Every capability, and whether it is real</CardTitle>
            <CardDescription>
              A simulated send is logged and then discarded — it looks identical to a real one in the UI, which is why
              this list exists. &ldquo;Degraded&rdquo; means the feature works but with reduced quality or missing
              feedback; &ldquo;Not live&rdquo; means nothing leaves the server.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.map((item) => {
            const meta = STATUS_META[item.status];
            const Icon = meta.icon;
            return (
              <div key={item.id} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      item.status === "LIVE"
                        ? "text-[var(--success)]"
                        : item.status === "DEGRADED"
                          ? "text-[var(--warning)]"
                          : "text-[var(--danger)]"
                    }`}
                  />
                  <span className="text-[13px] font-medium text-[var(--foreground)]">{item.label}</span>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  {item.blocksAutomation && <Badge tone="danger">Blocks automation</Badge>}
                </div>
                <p className="mt-1.5 pl-6 text-xs leading-relaxed text-[var(--muted-foreground)]">{item.detail}</p>
                {item.missingKeys.length > 0 && (
                  <p className="mt-1 pl-6 font-mono text-xs text-[var(--danger)]">{item.missingKeys.join("  ")}</p>
                )}
                {item.remedy && (
                  <p className="mt-1 pl-6 text-xs text-[var(--foreground)]">{item.remedy}</p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
