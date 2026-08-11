import { Clock, PhoneCall, ShieldOff, Gauge, TimerReset, Ban, MessageSquareWarning, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarRow } from "@/components/workspace/bar-row";
import { WorkQueueCard } from "@/components/workspace/work-queue-card";
import { EmptyState } from "@/components/ui/empty-state";
import { getDashboardMetrics, listAllTasks } from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";
import { STATE_LABELS } from "@/core/stateMachine";
import { RULE_DESCRIPTIONS } from "@/core/policyGate";
import type { RuleCode } from "@/domain/types";

export default async function DashboardPage() {
  const [m, allTasks, user] = await Promise.all([getDashboardMetrics(), listAllTasks(), getCurrentUser()]);
  const maxStateCount = Math.max(1, ...m.leadsByState.map((s) => s.count));
  const maxReasonCount = Math.max(1, ...m.blockDeferRate.map((r) => r.count));
  const isOfficer = user.role === "OFFICER";
  const queueTasks = isOfficer ? allTasks.filter((t) => t.leadAssignedOfficerId === user.officerId) : allTasks;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Dashboard"
        description="Every metric here is computed from LeadEvent — never an ad-hoc counter that can drift from the record."
      />

      {/* Hero metrics first. The work queue used to sit above these and,
          with eight near-identical task rows, it pushed every number below
          the fold — so the first thing anyone saw was a wall of red text
          with no sense of how the business was actually doing. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total leads"
          value={String(m.totalLeads)}
          icon={<UserCheck />}
          variant="hero"
          index={0}
        />
        <StatCard
          label="Median time to first contact"
          value={m.medianTimeToFirstContactMinutes !== null ? `${Math.round(m.medianTimeToFirstContactMinutes)}m` : "—"}
          icon={<Clock />}
          tone="success"
          variant="hero"
          hint="Lower is better — speed is the strongest predictor of contact."
          index={1}
        />
        <StatCard
          label="SLA breaches"
          value={String(m.slaBreaches)}
          icon={<TimerReset />}
          tone={m.slaBreaches > 0 ? "danger" : "success"}
          variant="hero"
          hint={m.slaBreaches > 0 ? "Leads that waited longer than the promise." : "Every lead contacted inside the window."}
          index={2}
        />
        <StatCard
          label="Opt-out rate"
          value={`${m.optOutRate}%`}
          icon={<ShieldOff />}
          tone={m.optOutRate > 5 ? "danger" : "warning"}
          variant="hero"
          hint="A rising number usually means messaging, not targeting."
          index={3}
        />
      </div>

      {/* Work queue beside the secondary metrics: the thing to act on and the
          context for acting on it, side by side instead of stacked. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <WorkQueueCard tasks={queueTasks} scopeLabel={isOfficer ? "across your leads" : "across all leads"} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:content-start">
          <StatCard label="Conversation completion" value={`${m.conversationCompletionRate}%`} icon={<PhoneCall />} index={4} />
          <StatCard label="Escalation rate" value={`${m.escalationRate}%`} icon={<MessageSquareWarning />} tone="warning" index={5} />
          <StatCard label="Median completeness" value={`${Math.round(m.medianCompleteness)}/100`} icon={<Gauge />} index={6} />
          <StatCard
            label="Handoff ack latency"
            value={m.handoffAckLatencyMinutes !== null ? `${Math.round(m.handoffAckLatencyMinutes)}m` : "—"}
            icon={<Ban />}
            index={7}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Leads by state</CardTitle>
              <CardDescription>Current distribution across the lead state machine.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {m.leadsByState.map((s, i) => (
              <BarRow
                key={s.state}
                label={STATE_LABELS[s.state as keyof typeof STATE_LABELS] ?? s.state}
                value={s.count}
                max={maxStateCount}
                index={i}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Contact rate by channel</CardTitle>
              <CardDescription>Connected outcomes over total non-blocked attempts.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {m.contactRateByChannel.map((c, i) => (
              <BarRow
                key={c.channel}
                label={c.channel}
                value={c.rate}
                max={100}
                displayValue={`${c.rate}%`}
                tone={c.rate >= 50 ? "primary" : "warning"}
                index={i}
              />
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Block / defer rate by reason</CardTitle>
              <CardDescription>
                The compliance health signal — a spike here usually means something is misconfigured, not that
                borrowers are unreachable.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {m.blockDeferRate.length === 0 ? (
              <EmptyState icon={ShieldOff} title="No blocks or defers recorded" description="Every attempted outreach passed PolicyGate cleanly." />
            ) : (
              <div className="space-y-3">
                {m.blockDeferRate.map((r, i) => (
                  <div key={r.reason}>
                    <BarRow
                      label={r.reason}
                      value={r.count}
                      max={maxReasonCount}
                      tone={r.reason.includes("SUPPRESS") || r.reason === "KILL_SWITCH" ? "danger" : "warning"}
                      index={i}
                    />
                    <p className="ml-36 mt-0.5 pl-3 text-xs text-[var(--muted-foreground)]">
                      {RULE_DESCRIPTIONS[r.reason as RuleCode] ?? ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
