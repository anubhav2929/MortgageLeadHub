import { computeCompleteness, type CompletenessInputs } from "@/core/completeness";
import { computeLeadQualityScore, type LeadScoreResult } from "@/core/leadScoring";
import { getPropertyValuation } from "@/adapters/propertyData";
import { getDb, saveDb } from "@/domain/store";
import type {
  AuditLog,
  CadencePlan,
  ConsentRecord,
  ContactAttempt,
  ConversationSession,
  DiscoveredSignal,
  DisclosureVersion,
  FieldCandidate,
  FieldStatus,
  IntakeDraft,
  Lead,
  LeadEvent,
  LeadField,
  Note,
  Officer,
  PolicyDecision,
  PropertyValuationResult,
  Suppression,
  Task,
} from "@/domain/types";

/** Reuses a lead's cached AVM lookup if one exists, else computes and
 *  caches it. Keeps a metered vendor's free-tier quota to ~1 call per
 *  unique property instead of 1 per lead-detail page view. */
async function getOrCachePropertyValuation(db: Awaited<ReturnType<typeof getDb>>, lead: Lead): Promise<PropertyValuationResult> {
  if (lead.propertyValuation) return lead.propertyValuation;
  const valuation = await getPropertyValuation({
    addressLine1: lead.addressLine1,
    city: lead.city,
    stateCode: lead.stateCode,
    estimatedValue: lead.estimatedValue,
  });
  lead.propertyValuation = valuation;
  saveDb();
  return valuation;
}

const COMPLETENESS_PATHS: Record<keyof CompletenessInputs, string> = {
  contactable: "contact.reachable",
  intent: "loan.intent",
  propertyIdentified: "property.identified",
  occupancy: "property.occupancy",
  loanPurpose: "loan.purpose",
  timeline: "borrower.timeline",
  creditBand: "borrower.creditBand",
  incomeBand: "borrower.incomeBand",
};

export async function computeLeadCompleteness(leadId: string) {
  const db = await getDb();
  const inputs = {} as CompletenessInputs;
  for (const key of Object.keys(COMPLETENESS_PATHS) as (keyof CompletenessInputs)[]) {
    const field = db.leadFields.get(`${leadId}:${COMPLETENESS_PATHS[key]}`);
    inputs[key] = (field?.status ?? "UNKNOWN") as FieldStatus;
  }
  const { score, missing } = computeCompleteness(inputs);
  return { score, missing: missing.map((m) => COMPLETENESS_FIELD_LABEL[m]) };
}

const COMPLETENESS_FIELD_LABEL: Record<keyof CompletenessInputs, string> = {
  contactable: "Contactable",
  intent: "Loan intent",
  propertyIdentified: "Property identified",
  occupancy: "Occupancy",
  loanPurpose: "Loan purpose",
  timeline: "Timeline",
  creditBand: "Credit band",
  incomeBand: "Income band",
};

export interface LeadListItem extends Lead {
  fullName: string;
  officerName?: string;
  slaBreached: boolean;
  minutesToSla: number;
  qualityScore: number;
  qualityTier: LeadScoreResult["tier"];
}

/** `searchQuery`, if given, matches against name, phone, or email — matched
 *  here (server-side, against the raw person record) rather than in the
 *  page component, so raw phone/email never needs to be added to
 *  LeadListItem and shipped to the client just to power a text search. */
export async function listLeads(searchQuery?: string): Promise<LeadListItem[]> {
  const db = await getDb();
  const now = Date.now();
  const q = searchQuery?.trim().toLowerCase();
  const items = await Promise.all(
    Array.from(db.leads.values()).map(async (lead) => {
      const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
      const officer = lead.assignedOfficerId ? db.officers.get(lead.assignedOfficerId) : undefined;
      const slaDue = new Date(lead.slaDueAt).getTime();
      const terminal = ["ACKNOWLEDGED", "SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"].includes(lead.state);
      const { score } = await computeLeadCompleteness(lead.id);
      // List view scores from stored fields only (no AVM refetch per row) —
      // fast for N leads; the single-lead detail view below uses the full,
      // AVM- and conversation-aware computation.
      const quality = computeLeadQualityScore(
        {
          stateCode: lead.stateCode,
          intent: lead.intent,
          goal: lead.goal,
          timeline: lead.timeline,
          missedPayments: lead.missedPayments,
          estimatedValue: lead.estimatedValue,
          mortgageBalance: lead.currentBalance,
          intakeDurationSeconds: lead.intakeDurationSeconds,
        },
        db.config.scoringWeights,
        db.config.hotLeadThreshold
      );
      const fullName = person ? `${person.firstName} ${person.lastName}` : "Unknown";
      if (q) {
        const matches =
          fullName.toLowerCase().includes(q) ||
          (person?.phoneE164 ?? "").toLowerCase().includes(q) ||
          (person?.email ?? "").toLowerCase().includes(q);
        if (!matches) return null;
      }
      return {
        ...lead,
        completenessScore: lead.state === "CLOSED_WON" ? 100 : score,
        fullName,
        officerName: officer?.name,
        slaBreached: !terminal && !lead.firstContactAt && now > slaDue,
        minutesToSla: Math.round((slaDue - now) / 60000),
        qualityScore: quality.total,
        qualityTier: quality.tier,
      };
    })
  );
  return items
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export interface LeadDetail {
  lead: Lead;
  person: Awaited<ReturnType<typeof getPrimaryPerson>>;
  officer?: Officer;
  events: LeadEvent[];
  attempts: ContactAttempt[];
  policyDecisions: PolicyDecision[];
  consents: ConsentRecord[];
  tasks: Task[];
  notes: Note[];
  conversations: ConversationSession[];
  fieldCandidates: FieldCandidate[];
  leadFields: LeadField[];
  cadencePlan?: CadencePlan;
  suppression?: Suppression;
  qualityScore: LeadScoreResult;
  propertyValuation: PropertyValuationResult;
  /** Computed from today's attempt records — not lead.attemptsToday, which
   *  only ever increments and is never reset at a day boundary. */
  attemptsToday: number;
  /** When the cadence engine will next attempt this lead, if it's still in
   *  an automation-eligible state with cadence steps remaining. */
  nextAttemptEta?: string;
}

// Mirrors cadenceEngine.runCadenceTick's own "is this lead due" math, but
// read-only — used to show a borrower/officer an ETA, never to trigger a
// send. Only NEW/ATTEMPTING_CONTACT leads are cadence-automation-eligible;
// see cadenceEngine.ts for why (once a human owns it, automation stands down).
function computeNextAttemptEta(lead: Lead, cadencePlan: CadencePlan | undefined, events: LeadEvent[]): string | undefined {
  if (lead.state !== "NEW" && lead.state !== "ATTEMPTING_CONTACT") return undefined;
  if (!cadencePlan || cadencePlan.steps.length === 0) return undefined;

  const steps = [...cadencePlan.steps].sort((a, b) => a.offsetMinutes - b.offsetMinutes);
  const attemptsSoFar = events.filter((e) => e.type === "OUTREACH_ATTEMPTED" && e.payload?.reason === "automated_cadence_step").length;
  if (attemptsSoFar >= steps.length) return undefined;

  const nextStep = steps[attemptsSoFar];
  return new Date(new Date(lead.createdAt).getTime() + nextStep.offsetMinutes * 60000).toISOString();
}

async function getPrimaryPerson(leadId: string) {
  const db = await getDb();
  return Array.from(db.people.values()).find((p) => p.leadId === leadId && p.role === "PRIMARY");
}

export async function getLeadByRef(publicRef: string): Promise<LeadDetail | null> {
  const db = await getDb();
  const lead = Array.from(db.leads.values()).find((l) => l.publicRef === publicRef);
  if (!lead) return null;

  const person = await getPrimaryPerson(lead.id);
  const officer = lead.assignedOfficerId ? db.officers.get(lead.assignedOfficerId) : undefined;
  const suppression = person ? db.suppressions.get(person.phoneE164) : undefined;

  const conversationTurns = Array.from(db.conversations.values())
    .filter((c) => c.leadId === lead.id)
    .flatMap((c) => c.transcript ?? []);
  const valuation = await getOrCachePropertyValuation(db, lead);
  const qualityScore = computeLeadQualityScore(
    {
      stateCode: lead.stateCode,
      intent: lead.intent,
      goal: lead.goal,
      timeline: lead.timeline,
      missedPayments: lead.missedPayments,
      estimatedValue: lead.estimatedValue ?? valuation.estimatedValue,
      mortgageBalance: lead.currentBalance ?? valuation.estimatedMortgageBalance,
      intakeDurationSeconds: lead.intakeDurationSeconds,
      borrowerUtterances: conversationTurns.filter((t) => t.role === "BORROWER").map((t) => t.text),
    },
    db.config.scoringWeights,
    db.config.hotLeadThreshold
  );

  const attempts = db.attempts.filter((a) => a.leadId === lead.id).sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime());
  const today = new Date().toDateString();
  const attemptsToday = attempts.filter((a) => new Date(a.scheduledFor).toDateString() === today).length;
  const leadEvents = db.events.filter((e) => e.leadId === lead.id);

  return {
    lead,
    person,
    officer,
    suppression,
    qualityScore,
    propertyValuation: valuation,
    attemptsToday,
    nextAttemptEta: computeNextAttemptEta(lead, db.cadencePlans.get(lead.cadencePlanVersionId), leadEvents),
    events: leadEvents.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
    attempts,
    policyDecisions: db.policyDecisions.filter((p) => p.leadId === lead.id).sort((a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime()),
    consents: db.consents.filter((c) => c.leadId === lead.id),
    tasks: Array.from(db.tasks.values()).filter((t) => t.leadId === lead.id),
    notes: db.notes.filter((n) => n.leadId === lead.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    conversations: Array.from(db.conversations.values()).filter((c) => c.leadId === lead.id),
    fieldCandidates: db.fieldCandidates.filter((f) => f.leadId === lead.id),
    leadFields: Array.from(db.leadFields.values()).filter((f) => f.leadId === lead.id),
    cadencePlan: db.cadencePlans.get(lead.cadencePlanVersionId),
  };
}

/** `officer.currentLoad` is a stored counter that's never reset — despite
 *  its name, "daily" capacity was actually being enforced as a lifetime cap.
 *  Computed fresh from today's OFFICER_ASSIGNED events instead, matching
 *  this app's own rule (per the dashboard's own copy: "never an ad-hoc
 *  counter that can drift from the record"). Exported so autoAssignOfficer
 *  (actions.ts) gates on the exact same number the admin UI displays. */
export function computeOfficerLoadToday(events: { type: string; occurredAt: string; payload?: Record<string, unknown> }[], officerId: string): number {
  const today = new Date().toDateString();
  return events.filter(
    (e) => e.type === "OFFICER_ASSIGNED" && e.payload?.officerId === officerId && new Date(e.occurredAt).toDateString() === today
  ).length;
}

export async function listOfficers(): Promise<Officer[]> {
  const db = await getDb();
  return Array.from(db.officers.values()).map((o) => ({ ...o, currentLoad: computeOfficerLoadToday(db.events, o.id) }));
}

export async function listCadencePlans(): Promise<CadencePlan[]> {
  return Array.from((await getDb()).cadencePlans.values());
}

export async function listDisclosures(): Promise<DisclosureVersion[]> {
  return Array.from((await getDb()).disclosures.values());
}

export interface SuppressionWithStatus extends Suppression {
  expired: boolean;
}

export async function listSuppressions(): Promise<SuppressionWithStatus[]> {
  const now = Date.now();
  return Array.from((await getDb()).suppressions.values())
    .map((s) => ({ ...s, expired: !!s.expiresAt && new Date(s.expiresAt).getTime() < now }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function listSignals(): Promise<DiscoveredSignal[]> {
  return Array.from((await getDb()).signals.values()).sort(
    (a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime()
  );
}

export async function listAuditLogs(): Promise<AuditLog[]> {
  const db = await getDb();
  return db.auditLogs.slice().sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export async function listIntakeDrafts(): Promise<IntakeDraft[]> {
  const db = await getDb();
  return Array.from(db.intakeDrafts.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export const DRAFT_RETENTION_DAYS = 30;

/** Called from the cron route (never client-triggerable) — pre-consent PII
 *  sitting in db.intakeDrafts doesn't get to live forever just because
 *  nobody remembered to clean it up. Returns how many were purged. */
export async function purgeStaleIntakeDrafts(): Promise<number> {
  const db = await getDb();
  const cutoff = Date.now() - DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let purged = 0;
  for (const [id, draft] of db.intakeDrafts) {
    if (new Date(draft.updatedAt).getTime() < cutoff) {
      db.intakeDrafts.delete(id);
      purged++;
    }
  }
  if (purged > 0) saveDb();
  return purged;
}

export async function getKillSwitch() {
  return (await getDb()).killSwitch;
}

export interface BlockedItem {
  leadPublicRef: string;
  leadFullName: string;
  channel: string;
  evaluatedAt: string;
}

/** What actually got blocked while the kill switch was active — the panel
 *  previously only showed the on/off state and when it last changed, with
 *  no way to see what automation it actually stopped. */
export interface FailedAttemptItem {
  leadPublicRef: string;
  leadFullName: string;
  channel: string;
  scheduledFor: string;
}

/** Surfaces real provider failures (Twilio/Resend/Vapi errors) that would
 *  otherwise be invisible — the Integrations tab only ever showed static
 *  live/simulated config, never whether a configured integration was
 *  actually failing in practice. */
export async function listRecentFailedAttempts(limit = 10): Promise<FailedAttemptItem[]> {
  const db = await getDb();
  const failed = db.attempts
    .filter((a) => a.outcome === "FAILED")
    .sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime())
    .slice(0, limit);

  return failed.map((a) => {
    const lead = db.leads.get(a.leadId);
    const person = lead ? Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY") : undefined;
    return {
      leadPublicRef: lead?.publicRef ?? "",
      leadFullName: person ? `${person.firstName} ${person.lastName}` : "Unknown",
      channel: a.channel,
      scheduledFor: a.scheduledFor,
    };
  });
}

export async function listRecentKillSwitchBlocks(limit = 10): Promise<BlockedItem[]> {
  const db = await getDb();
  const decisions = db.policyDecisions
    .filter((d) => d.reasons.includes("KILL_SWITCH"))
    .sort((a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime())
    .slice(0, limit);

  return decisions.map((d) => {
    const lead = db.leads.get(d.leadId);
    const person = lead ? Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY") : undefined;
    return {
      leadPublicRef: lead?.publicRef ?? "",
      leadFullName: person ? `${person.firstName} ${person.lastName}` : "Unknown",
      channel: d.channel,
      evaluatedAt: d.evaluatedAt,
    };
  });
}

export async function getSystemConfig() {
  return (await getDb()).config;
}

export async function listUsers() {
  return Array.from((await getDb()).users.values());
}

export interface TaskWithLead extends Task {
  leadPublicRef: string;
  leadFullName: string;
  leadStateCode: string;
  leadAssignedOfficerId?: string;
  overdue: boolean;
}

/** Cross-lead task list — previously tasks only existed inside a single
 *  lead's Tasks tab, with no way to see "everything due across my leads"
 *  without opening each one. `overdue` is computed here (server-side, once)
 *  rather than in the client component, which would otherwise need an
 *  impure `Date.now()` call during render. */
export async function listAllTasks(): Promise<TaskWithLead[]> {
  const db = await getDb();
  const now = Date.now();
  const items: TaskWithLead[] = [];
  for (const task of db.tasks.values()) {
    const lead = db.leads.get(task.leadId);
    if (!lead) continue;
    const person = Array.from(db.people.values()).find((p) => p.leadId === lead.id && p.role === "PRIMARY");
    items.push({
      ...task,
      leadPublicRef: lead.publicRef,
      leadFullName: person ? `${person.firstName} ${person.lastName}` : "Unknown",
      leadStateCode: lead.stateCode,
      leadAssignedOfficerId: lead.assignedOfficerId,
      overdue: task.status === "OPEN" && new Date(task.dueAt).getTime() < now,
    });
  }
  return items.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
}

export async function listReferralPartners() {
  const db = await getDb();
  return Array.from(db.referralPartners.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ---------------------------------------------------------------------------
// Dashboard metrics (F-13) — all computed from LeadEvent, never ad-hoc counters
// ---------------------------------------------------------------------------
export interface DashboardMetrics {
  totalLeads: number;
  leadsByState: { state: string; count: number }[];
  medianTimeToFirstContactMinutes: number | null;
  slaBreaches: number;
  contactRateByChannel: { channel: string; attempts: number; connected: number; rate: number }[];
  blockDeferRate: { reason: string; count: number }[];
  conversationCompletionRate: number;
  escalationRate: number;
  medianCompleteness: number;
  handoffAckLatencyMinutes: number | null;
  optOutRate: number;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const db = await getDb();
  const leads = Array.from(db.leads.values());

  const leadsByState = Object.entries(
    leads.reduce<Record<string, number>>((acc, l) => {
      acc[l.state] = (acc[l.state] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([state, count]) => ({ state, count }));

  const ttfc = leads
    .filter((l) => l.firstContactAt)
    .map((l) => (new Date(l.firstContactAt!).getTime() - new Date(l.createdAt).getTime()) / 60000);

  const now = Date.now();
  const slaBreaches = leads.filter(
    (l) => !l.firstContactAt && now > new Date(l.slaDueAt).getTime() && !["SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"].includes(l.state)
  ).length;

  const channelStats: Record<string, { attempts: number; connected: number }> = {
    VOICE: { attempts: 0, connected: 0 },
    SMS: { attempts: 0, connected: 0 },
    EMAIL: { attempts: 0, connected: 0 },
  };
  for (const a of db.attempts) {
    if (a.outcome === "BLOCKED") continue;
    channelStats[a.channel].attempts += 1;
    if (a.outcome === "ANSWERED" || a.outcome === "DELIVERED") channelStats[a.channel].connected += 1;
  }
  const contactRateByChannel = Object.entries(channelStats).map(([channel, s]) => ({
    channel,
    attempts: s.attempts,
    connected: s.connected,
    rate: s.attempts > 0 ? Math.round((s.connected / s.attempts) * 100) : 0,
  }));

  const blockedOrDeferred = db.events.filter((e) => e.type === "OUTREACH_BLOCKED" || e.type === "OUTREACH_DEFERRED");
  const reasonCounts: Record<string, number> = {};
  for (const e of blockedOrDeferred) {
    const reasons = (e.payload?.reasons as string[] | undefined) ?? ["UNKNOWN"];
    for (const r of reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }
  const blockDeferRate = Object.entries(reasonCounts).map(([reason, count]) => ({ reason, count }));

  const convCompleted = db.events.filter((e) => e.type === "CONVERSATION_COMPLETED").length;
  const convStarted = db.events.filter((e) => e.type === "CONTACT_ANSWERED").length;
  const conversationCompletionRate = convStarted > 0 ? Math.round((convCompleted / convStarted) * 100) : 0;

  const escalations = db.events.filter((e) => e.type === "ESCALATED").length;
  const escalationRate = convStarted > 0 ? Math.round((escalations / convStarted) * 100) : 0;

  // Recomputed fresh per lead (not the stale `lead.completenessScore` field,
  // which is only ever set at creation) — see computeLeadCompleteness.
  const completenessScores = (await Promise.all(leads.map((l) => computeLeadCompleteness(l.id)))).map((c) => c.score);

  const ackEvents = db.events.filter((e) => e.type === "OFFICER_ACKNOWLEDGED");
  const ackLatencies: number[] = [];
  for (const ack of ackEvents) {
    const assigned = db.events.find((e) => e.leadId === ack.leadId && e.type === "OFFICER_ASSIGNED");
    if (assigned) {
      ackLatencies.push((new Date(ack.occurredAt).getTime() - new Date(assigned.occurredAt).getTime()) / 60000);
    }
  }

  const optOuts = db.events.filter((e) => e.type === "OPT_OUT_RECEIVED").length;
  const optOutRate = leads.length > 0 ? Math.round((optOuts / leads.length) * 1000) / 10 : 0;

  return {
    totalLeads: leads.length,
    leadsByState,
    medianTimeToFirstContactMinutes: median(ttfc),
    slaBreaches,
    contactRateByChannel,
    blockDeferRate,
    conversationCompletionRate,
    escalationRate,
    medianCompleteness: median(completenessScores) ?? 0,
    handoffAckLatencyMinutes: median(ackLatencies),
    optOutRate,
  };
}
