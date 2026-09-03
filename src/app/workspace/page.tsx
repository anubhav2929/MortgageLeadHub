import { AlertTriangle, Clock, ListTodo, MessageSquareReply, PhoneCall, Send, ShieldOff, TimerReset, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarRow } from "@/components/workspace/bar-row";
import { WorkQueueCard } from "@/components/workspace/work-queue-card";
import { BlockedAlertsCard } from "@/components/workspace/blocked-alerts-card";
import { EmptyState } from "@/components/ui/empty-state";
import { getDashboardMetrics, listAllTasks } from "@/domain/queries";
import { getCurrentUser } from "@/domain/session";
import { STATE_LABELS } from "@/core/stateMachine";
import { RULE_DESCRIPTIONS } from "@/core/policyGate";
import type { RuleCode } from "@/domain/types";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const [m, allTasks] = await Promise.all([
    getDashboardMetrics(user.role === "OFFICER" ? user.officerId : undefined),
    listAllTasks(),
  ]);
  const maxStateCount = Math.max(1, ...m.leadsByState.map((s) => s.count));
  const maxReasonCount = Math.max(1, ...m.blockDeferRate.map((r) => r.count));
  const isOfficer = user.role === "OFFICER";
  const queueTasks = isOfficer ? allTasks.filter((t) => t.leadAssignedOfficerId === user.officerId) : allTasks;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Dashboard"
        description="A live operating view of customer response, first-touch work, tasks, calls, and delivery health."
      />

      {/* Blocked-automation band sits above everything: these are the items
          where the system has stopped and only a person can restart it. */}
      <BlockedAlertsCard tasks={queueTasks} dismissedIds={user.dismissedDashboardAlertIds} />

      {/* Hero metrics first. The work queue used to sit above these and,
          with eight near-identical task rows, it pushed every number below
          the fold — so the first thing anyone saw was a wall of red text
          with no sense of how the business was actually doing. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active leads"
          value={String(m.activeLeads)}
          icon={<UserCheck />}
          variant="hero"
          hint={`${m.totalLeads} total records, excluding closed and suppressed from active workload.`}
          index={0}
        />
        <StatCard
          label="Need first contact"
          value={String(m.newLeadsAwaitingFirstContact)}
          icon={<TimerReset />}
          tone={m.newLeadsAwaitingFirstContact > 0 ? "warning" : "success"}
          variant="hero"
          hint={`${m.slaBreaches} currently past the promised response window.`}
          index={1}
        />
        <StatCard
          label="Borrowers waiting"
          value={String(m.borrowersAwaitingReply)}
          icon={<MessageSquareReply />}
          tone={m.borrowersAwaitingReply > 0 ? "warning" : "success"}
          variant="hero"
          hint="Latest customer message is newer than the latest outbound response."
          index={2}
        />
        <StatCard
          label="Overdue tasks"
          value={String(m.overdueTasks)}
          icon={<ListTodo />}
          tone={m.overdueTasks > 0 ? "danger" : "success"}
          variant="hero"
          hint={`${m.openTasks} open tasks across the workspace.`}
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
          <StatCard label="Calls answered today" value={String(m.callsAnsweredToday)} icon={<PhoneCall />} hint="Provider-confirmed answered voice attempts today." index={4} />
          <StatCard label="Texts delivered today" value={String(m.smsDeliveredToday)} icon={<Send />} hint="Carrier-confirmed delivery, not merely queued sends." index={5} />
          <StatCard label="Delivery failures · 24h" value={String(m.deliveryFailuresLast24h)} icon={<AlertTriangle />} tone={m.deliveryFailuresLast24h > 0 ? "danger" : "success"} index={6} />
          <StatCard
            label="Median first response"
            value={m.medianTimeToFirstContactMinutes !== null ? `${Math.round(m.medianTimeToFirstContactMinutes)}m` : "—"}
            icon={<Clock />}
            hint="Time from lead creation to the first real contact attempt."
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
