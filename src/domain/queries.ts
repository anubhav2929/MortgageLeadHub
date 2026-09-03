import { computeCompleteness, type CompletenessInputs } from "@/core/completeness";
import { computeLeadQualityScore, type LeadScoreResult } from "@/core/leadScoring";
import { buildInsufficientPropertyValuation } from "@/adapters/propertyData";
import { getDb, refreshDb, saveDb, type Database } from "@/domain/store";
import { evaluateGoLive, summariseGoLive } from "@/core/goLive";
import { evaluateStaleCall, staleAttemptOutcome } from "@/core/staleCall";
import { reconcileLiveCalls } from "@/domain/callReconciler";
import { singleFlight } from "@/core/singleFlight";
import { getCapabilities, getConfigValue, getPublicUrlResolution } from "@/lib/runtimeConfig";
import { sameCalendarDay } from "@/core/timezone";
import { isReusablePropertyValuation } from "@/core/propertyValuationQuality";
import { resolveActiveIntakeDisclosures } from "@/core/intakeDisclosures";
import { maskEmail, maskPhone } from "@/core/rbac";
import { findPublicStatusLead } from "@/domain/statusAccess";
import type {
  AuditLog,
  CadencePlan,
  Channel,
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
  Person,
  PolicyDecision,
  PropertyValuationResult,
  Suppression,
  CreditPullResult,
  Task,
  DialingSession,
  DialingQueueItem,
  CallbackAppointment,
  TransferAttempt,
} from "@/domain/types";

/** Reuses supported evidence, but never performs provider I/O while rendering
 *  a lead page. Missing/legacy results become an explicit insufficient state;
 *  the audited Admin action owns external recalculation and its pending UI. */
async function getOrCachePropertyValuation(lead: Lead): Promise<PropertyValuationResult> {
  if (isReusablePropertyValuation(lead.propertyValuation)) return lead.propertyValuation!;
  // Strip a legacy simulated value (or initialize an old lead) immediately.
  const sanitized = buildInsufficientPropertyValuation({
    addressLine1: lead.addressLine1,
    city: lead.city,
    stateCode: lead.stateCode,
    postalCode: lead.postalCode,
    estimatedValue: lead.estimatedValue,
    currentBalance: lead.currentBalance,
  });
  lead.propertyValuation = sanitized;
  await saveDb();
  return sanitized;
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
  const db = await refreshDb();
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
  /** Most recent soft credit pull, if one has run. Absent means nobody has
   *  checked — which is materially different from a borrower saying "unsure". */
  creditPull?: CreditPullResult;
  qualityScore: LeadScoreResult;
  propertyValuation: PropertyValuationResult;
  /** Computed from today's attempt records — not lead.attemptsToday, which
   *  only ever increments and is never reset at a day boundary. */
  attemptsToday: number;
  /** When the cadence engine will next attempt this lead, if it's still in
   *  an automation-eligible state with cadence steps remaining. */
  nextAttemptEta?: string;
}

/** Defense-in-depth DTO for roles that may inspect workflow state but not PII. */
export function redactLeadDetail(detail: LeadDetail): LeadDetail {
  return {
    ...detail,
    lead: {
      ...detail.lead,
      addressLine1: undefined,
      city: undefined,
      postalCode: undefined,
      estimatedValue: undefined,
      currentBalance: undefined,
      propertyValuation: undefined,
    },
    person: detail.person ? {
      ...detail.person,
      firstName: "Restricted",
      lastName: "Borrower",
      phoneE164: maskPhone(detail.person.phoneE164),
      email: maskEmail(detail.person.email),
      dataQualityFlags: undefined,
    } : undefined,
    attempts: detail.attempts.map((attempt) => ({ ...attempt, subject: undefined, body: undefined, recordingUrl: undefined })),
    conversations: detail.conversations.map((conversation) => ({
      ...conversation,
      transcript: [], summary: undefined, actionItems: undefined,
      listenUrl: undefined, controlUrl: undefined, contextSnapshot: {},
    })),
    notes: detail.notes.map((note) => ({ ...note, body: "Restricted" })),
    consents: detail.consents.map((consent) => ({ ...consent, exactTextSnapshot: "Restricted", ipAddress: "Restricted", userAgent: "Restricted" })),
    fieldCandidates: [],
    leadFields: [],
    qualityScore: { total: 0, breakdown: { equity: 0, margin: 0, compliance: 0, behavior: 0 }, tier: "STANDARD", ltv: null },
    propertyValuation: {
      estimatedValue: 0,
      confidenceLow: 0,
      confidenceHigh: 0,
      comparableCount: 0,
      estimatedMortgageBalance: 0,
      propertyType: "SINGLE_FAMILY",
      yearBuilt: 0,
      estimatedLTV: 0,
      usableEquity: 0,
      simulated: false,
      provenance: {
        estimatedValue: "MODELED",
        confidenceRange: "MODELED",
        comparableCount: "MODELED",
        lastSale: "MODELED",
        estimatedMortgageBalance: "MODELED",
        estimatedLTV: "MODELED",
        usableEquity: "MODELED",
        propertyType: "MODELED",
        yearBuilt: "MODELED",
      },
      method: "INSUFFICIENT_EVIDENCE",
      confidence: "INSUFFICIENT",
      evidence: [],
      disclaimer: "Restricted",
    },
    creditPull: undefined,
  };
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
  const db = await refreshDb();
  const lead = Array.from(db.leads.values()).find((l) => l.publicRef === publicRef);
  if (!lead) return null;

  const person = await getPrimaryPerson(lead.id);
  const officer = lead.assignedOfficerId ? db.officers.get(lead.assignedOfficerId) : undefined;
  const suppression = person ? db.suppressions.get(person.phoneE164) : undefined;

  const conversationTurns = Array.from(db.conversations.values())
    .filter((c) => c.leadId === lead.id)
    .flatMap((c) => c.transcript ?? []);
  const valuation = await getOrCachePropertyValuation(lead);
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

  // Most recent soft pull, so the UI can distinguish a verified credit band
  // from one nobody has checked. Without it, "Unsure" reads identically
  // whether the borrower said so or we simply never asked.
  const creditPull = db.creditPulls
    .filter((p) => p.leadId === lead.id)
    .sort((a, b) => new Date(b.pulledAt).getTime() - new Date(a.pulledAt).getTime())[0];

  const attempts = db.attempts.filter((a) => a.leadId === lead.id).sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime());
  const attemptsToday = attempts.filter((a) => sameCalendarDay(a.scheduledFor, new Date(), db.config.adminTimezone)).length;
  const leadEvents = db.events.filter((e) => e.leadId === lead.id);

  return {
    lead,
    person,
    officer,
    suppression,
    qualityScore,
    creditPull,
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

export interface PublicStatusDetail {
  lead: Pick<Lead, "id" | "publicRef" | "state" | "createdAt" | "lastAttemptAt" | "attemptsTotal">;
  person?: Pick<Person, "firstName">;
  officer?: Pick<Officer, "name" | "nmlsId" | "phone" | "email">;
  nextAttemptEta?: string;
}

export async function getPublicStatusByAccessKey(accessKey: string): Promise<PublicStatusDetail | null> {
  const db = await refreshDb({ force: true });
  const lead = findPublicStatusLead(db, accessKey);
  if (!lead) return null;
  const person = Array.from(db.people.values()).find((item) => item.leadId === lead.id && item.role === "PRIMARY");
  const officer = lead.assignedOfficerId ? db.officers.get(lead.assignedOfficerId) : undefined;
  return {
    lead: {
      id: lead.id,
      publicRef: lead.publicRef,
      state: lead.state,
      createdAt: lead.createdAt,
      lastAttemptAt: lead.lastAttemptAt,
      attemptsTotal: lead.attemptsTotal,
    },
    person: person ? { firstName: person.firstName } : undefined,
    officer: officer ? { name: officer.name, nmlsId: officer.nmlsId, phone: officer.phone, email: officer.email } : undefined,
    nextAttemptEta: computeNextAttemptEta(
      lead,
      db.cadencePlans.get(lead.cadencePlanVersionId),
      db.events.filter((event) => event.leadId === lead.id)
    ),
  };
}

/** `officer.currentLoad` is a stored counter that's never reset — despite
 *  its name, "daily" capacity was actually being enforced as a lifetime cap.
 *  Computed fresh from today's OFFICER_ASSIGNED events instead, matching
 *  this app's own rule (per the dashboard's own copy: "never an ad-hoc
 *  counter that can drift from the record"). Exported so autoAssignOfficer
 *  (actions.ts) gates on the exact same number the admin UI displays. */
export function computeOfficerLoadToday(events: { type: string; occurredAt: string; payload?: Record<string, unknown> }[], officerId: string, timeZone = "UTC"): number {
  return events.filter(
    (e) => e.type === "OFFICER_ASSIGNED" && e.payload?.officerId === officerId && sameCalendarDay(e.occurredAt, new Date(), timeZone)
  ).length;
}

export async function listOfficers(): Promise<Officer[]> {
  const db = await getDb();
  return Array.from(db.officers.values()).map((o) => ({ ...o, currentLoad: computeOfficerLoadToday(db.events, o.id, db.config.adminTimezone) }));
}

export async function listCadencePlans(): Promise<CadencePlan[]> {
  return Array.from((await getDb()).cadencePlans.values());
}

export async function listDisclosures(): Promise<DisclosureVersion[]> {
  return Array.from((await getDb()).disclosures.values());
}

/** Public-safe disclosure copy for the intake form. No lead or admin data is
 * exposed; these are the exact approved versions the submit action records. */
export async function getActiveIntakeDisclosures() {
  return resolveActiveIntakeDisclosures(await getDb());
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
  if (purged > 0) await saveDb();
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
  failureClass?: string;
  failureMessage?: string;
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
      failureClass: a.failureClass,
      // Provider errors can repeat the sender or borrower number. Admins need
      // the actionable error, not unmasked contact data in a global panel.
      failureMessage: a.failureMessage
        ?.replace(/\+[1-9]\d{7,14}/g, (phone) => `+••••${phone.slice(-4)}`)
        .slice(0, 500),
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
  activeLeads: number;
  newLeadsAwaitingFirstContact: number;
  borrowersAwaitingReply: number;
  openTasks: number;
  overdueTasks: number;
  callsAnsweredToday: number;
  smsDeliveredToday: number;
  deliveryFailuresLast24h: number;
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

export async function getDashboardMetrics(officerId?: string): Promise<DashboardMetrics> {
  const db = await getDb();
  const leads = Array.from(db.leads.values()).filter((lead) => !officerId || lead.assignedOfficerId === officerId);
  const leadIds = new Set(leads.map((lead) => lead.id));
  const attempts = db.attempts.filter((attempt) => leadIds.has(attempt.leadId));
  const tasks = Array.from(db.tasks.values()).filter((task) => leadIds.has(task.leadId));
  const events = db.events.filter((event) => leadIds.has(event.leadId));

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
  const terminalStates = new Set(["SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"]);
  const activeLeads = leads.filter((lead) => !terminalStates.has(lead.state)).length;
  const newLeadsAwaitingFirstContact = leads.filter((lead) => !lead.firstContactAt && !terminalStates.has(lead.state)).length;
  const openTasks = tasks.filter((task) => task.status === "OPEN").length;
  const overdueTasks = tasks.filter((task) => task.status === "OPEN" && Date.parse(task.dueAt) < now).length;
  const adminTimezone = db.config.adminTimezone;
  const callsAnsweredToday = attempts.filter((attempt) => attempt.channel === "VOICE" && attempt.outcome === "ANSWERED" && sameCalendarDay(attempt.endedAt ?? attempt.startedAt ?? attempt.scheduledFor, new Date(), adminTimezone)).length;
  const smsDeliveredToday = attempts.filter((attempt) => attempt.channel === "SMS" && attempt.direction === "OUTBOUND" && attempt.outcome === "DELIVERED" && sameCalendarDay(attempt.endedAt ?? attempt.startedAt ?? attempt.scheduledFor, new Date(), adminTimezone)).length;
  const deliveryFailuresLast24h = attempts.filter((attempt) => attempt.outcome === "FAILED" && Date.parse(attempt.endedAt ?? attempt.startedAt ?? attempt.scheduledFor) >= now - 86_400_000).length;
  let borrowersAwaitingReply = 0;
  for (const lead of leads) {
    if (terminalStates.has(lead.state)) continue;
    const latestInbound = db.notes
      .filter((note) => note.leadId === lead.id && note.conversationDirection === "INBOUND" && note.conversationRole === "BORROWER")
      .reduce((latest, note) => Math.max(latest, Date.parse(note.createdAt)), 0);
    const latestOutbound = attempts
      .filter((attempt) => attempt.leadId === lead.id && attempt.direction === "OUTBOUND" && attempt.outcome !== "FAILED" && attempt.outcome !== "BLOCKED")
      .reduce((latest, attempt) => Math.max(latest, Date.parse(attempt.startedAt ?? attempt.scheduledFor)), 0);
    if (latestInbound > latestOutbound) borrowersAwaitingReply += 1;
  }
  const slaBreaches = leads.filter(
    (l) => !l.firstContactAt && now > new Date(l.slaDueAt).getTime() && !["SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"].includes(l.state)
  ).length;

  const channelStats: Record<string, { attempts: number; connected: number }> = {
    VOICE: { attempts: 0, connected: 0 },
    SMS: { attempts: 0, connected: 0 },
    EMAIL: { attempts: 0, connected: 0 },
  };
  for (const a of attempts) {
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

  const blockedOrDeferred = events.filter((e) => e.type === "OUTREACH_BLOCKED" || e.type === "OUTREACH_DEFERRED");
  const reasonCounts: Record<string, number> = {};
  for (const e of blockedOrDeferred) {
    const reasons = (e.payload?.reasons as string[] | undefined) ?? ["UNKNOWN"];
    for (const r of reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }
  const blockDeferRate = Object.entries(reasonCounts).map(([reason, count]) => ({ reason, count }));

  const convCompleted = events.filter((e) => e.type === "CONVERSATION_COMPLETED").length;
  const convStarted = events.filter((e) => e.type === "CONTACT_ANSWERED").length;
  const conversationCompletionRate = convStarted > 0 ? Math.round((convCompleted / convStarted) * 100) : 0;

  const escalations = events.filter((e) => e.type === "ESCALATED").length;
  const escalationRate = convStarted > 0 ? Math.round((escalations / convStarted) * 100) : 0;

  // Recomputed fresh per lead (not the stale `lead.completenessScore` field,
  // which is only ever set at creation) — see computeLeadCompleteness.
  const completenessScores = (await Promise.all(leads.map((l) => computeLeadCompleteness(l.id)))).map((c) => c.score);

  const ackEvents = events.filter((e) => e.type === "OFFICER_ACKNOWLEDGED");
  const ackLatencies: number[] = [];
  for (const ack of ackEvents) {
    const assigned = events.find((e) => e.leadId === ack.leadId && e.type === "OFFICER_ASSIGNED");
    if (assigned) {
      ackLatencies.push((new Date(ack.occurredAt).getTime() - new Date(assigned.occurredAt).getTime()) / 60000);
    }
  }

  const optOuts = events.filter((e) => e.type === "OPT_OUT_RECEIVED").length;
  const optOutRate = leads.length > 0 ? Math.round((optOuts / leads.length) * 1000) / 10 : 0;

  return {
    totalLeads: leads.length,
    activeLeads,
    newLeadsAwaitingFirstContact,
    borrowersAwaitingReply,
    openTasks,
    overdueTasks,
    callsAnsweredToday,
    smsDeliveredToday,
    deliveryFailuresLast24h,
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

/**
 * Go-live readiness. Answers the one question an operator has before a
 * launch: "if I paste my keys in, will anything still be pretending?"
 *
 * Deliberately reads live capabilities and the cadence heartbeat together —
 * the non-key prerequisites (a scheduler actually running, a reachable public
 * URL) are the ones that a pure API-key checklist reports as green while
 * nothing automatic ever fires.
 */
export async function getGoLiveReadiness() {
  const [caps, db, publicUrl] = await Promise.all([getCapabilities(), getDb(), getPublicUrlResolution()]);
  const has = async (k: string) => Boolean(await getConfigValue(k));

  const items = evaluateGoLive({
    caps,
    hasCronSecret: await has("CRON_SECRET"),
    hasDeliveryWebhookSecret: (await has("TELNYX_PUBLIC_KEY")) || caps.hasTwilio,
    hasInboundSmsSecret: (await has("TELNYX_PUBLIC_KEY")) || caps.hasTwilio,
    hasAppUrl: publicUrl.source !== "localhost",
    appUrlSource: publicUrl.source,
    appUrlWarning: publicUrl.configuredInvalid ? "The saved APP_URL is invalid; the stable Vercel production domain is being used instead." : undefined,
    hasCreditCheck: (await has("ISOFTPULL_API_KEY")) && (await has("ISOFTPULL_API_SECRET")) && (await getConfigValue("CREDIT_LIVE_APPROVED")) === "true",
    lastCadenceRunAt: db.lastCadenceRunAt,
    now: new Date(),
  });

  return { items, verdict: summariseGoLive(items) };
}

/** Documents attached to a lead, newest first. */
export async function listLeadDocuments(leadId: string) {
  const db = await getDb();
  return db.leadDocuments
    .filter((d) => d.leadId === leadId)
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
}

// ---------------------------------------------------------------------------
// Call centre — voice activity across every lead, not one lead at a time.
// ---------------------------------------------------------------------------

/**
 * A conversation as the browser may see it.
 *
 * `controlUrl` and `listenUrl` are stripped and replaced by booleans. Both are
 * pre-authenticated bearer URLs — anyone holding the control URL can speak as
 * the company to a borrower mid-call, or transfer them anywhere. This type
 * crosses into a client component, so the URLs must not be on it; only the
 * server resolves them, from the conversation id.
 */
export type SafeConversation = Omit<ConversationSession, "controlUrl" | "listenUrl"> & {
  hasControl: boolean;
  hasAudioStream: boolean;
};

function toSafeConversation(c: ConversationSession): SafeConversation {
  const { controlUrl, listenUrl, ...rest } = c;
  return { ...rest, hasControl: Boolean(controlUrl), hasAudioStream: Boolean(listenUrl) };
}

export interface CallCentreEntry {
  attempt: ContactAttempt;
  conversation?: SafeConversation;
  leadPublicRef: string;
  borrowerName: string;
  stateCode: string;
  leadAssignedOfficerId?: string;
  officerName?: string;
  /** Destination for a warm transfer, when the assigned officer has a number. */
  officerPhone?: string;
}

export interface DialingSessionView {
  session: DialingSession;
  items: Array<DialingQueueItem & { publicRef: string; borrowerName: string; stateCode: string }>;
}

export interface CallbackAppointmentView {
  appointment: CallbackAppointment;
  leadPublicRef: string;
  borrowerName: string;
  officerName?: string;
  transferStatus?: TransferAttempt["status"];
}

export async function listCallbackAppointments(limit = 50): Promise<CallbackAppointmentView[]> {
  const db = await refreshDb();
  const primaryByLead = new Map(Array.from(db.people.values()).filter((person) => person.role === "PRIMARY").map((person) => [person.leadId, person]));
  return Array.from(db.callbackAppointments.values())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit)
    .map((appointment) => {
      const lead = db.leads.get(appointment.leadId);
      const person = primaryByLead.get(appointment.leadId);
      const transfer = appointment.transferAttemptId ? db.transferAttempts.get(appointment.transferAttemptId) : undefined;
      return {
        appointment,
        leadPublicRef: lead?.publicRef ?? "",
        borrowerName: person ? `${person.firstName} ${person.lastName}`.trim() : "Unknown borrower",
        officerName: appointment.officerId ? db.officers.get(appointment.officerId)?.name : undefined,
        transferStatus: transfer?.status,
      };
    })
    .filter((item) => item.leadPublicRef);
}

export async function listDialingSessions(limit = 20): Promise<DialingSessionView[]> {
  const db = await refreshDb();
  const primaryByLead = new Map(Array.from(db.people.values()).filter((person) => person.role === "PRIMARY").map((person) => [person.leadId, person]));
  return Array.from(db.dialingSessions.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((session) => ({
      session,
      items: Array.from(db.dialingQueueItems.values())
        .filter((item) => item.sessionId === session.id)
        .sort((a, b) => a.position - b.position)
        .map((item) => {
          const lead = db.leads.get(item.leadId);
          const person = primaryByLead.get(item.leadId);
          return {
            ...item,
            publicRef: lead?.publicRef ?? "",
            borrowerName: person ? `${person.firstName} ${person.lastName}`.trim() : "Unknown borrower",
            stateCode: lead?.stateCode ?? "",
          };
        }),
    }));
}

/**
 * Voice activity across all leads, newest first.
 *
 * Joined here rather than in the page because the page needs three different
 * slices of the same data (live, recent, failed) and re-deriving the join per
 * slice would walk every attempt three times.
 */
export async function listCallActivity(limit = 100): Promise<CallCentreEntry[]> {
  // Call state is the most volatile data in the product and the most likely to
  // have been written by a different instance moments ago. One timestamp
  // comparison here is what stops the board oscillating between instances.
  const db = await refreshDb();
  const conversationsByAttempt = new Map<string, ConversationSession>();
  for (const c of db.conversations.values()) {
    if (c.contactAttemptId) conversationsByAttempt.set(c.contactAttemptId, c);
  }

  // Indexed once rather than scanned per attempt. The previous version ran
  // `Array.from(db.people.values()).find(...)` INSIDE the map, making this
  // O(attempts x people) — and it runs on every three-second poll, twice per
  // render. At the volumes this is about to be tested at, that alone made the
  // page slow enough for polls to overlap.
  const primaryByLead = new Map<string, Person>();
  for (const p of db.people.values()) {
    if (p.role === "PRIMARY") primaryByLead.set(p.leadId, p);
  }

  const officers = db.officers;

  return db.attempts
    .filter((a) => a.channel === "VOICE")
    .sort((a, b) => new Date(b.startedAt ?? b.scheduledFor).getTime() - new Date(a.startedAt ?? a.scheduledFor).getTime())
    .slice(0, limit)
    .map((attempt) => {
      const lead = db.leads.get(attempt.leadId);
      const person = primaryByLead.get(attempt.leadId);
      const officer = lead?.assignedOfficerId ? officers.get(lead.assignedOfficerId) : undefined;
      const convo = conversationsByAttempt.get(attempt.id);
      return {
        attempt,
        conversation: convo ? toSafeConversation(convo) : undefined,
        leadPublicRef: lead?.publicRef ?? "",
        borrowerName: person ? `${person.firstName} ${person.lastName}` : "Unknown borrower",
        stateCode: lead?.stateCode ?? "",
        leadAssignedOfficerId: lead?.assignedOfficerId,
        officerName: officer?.name,
        officerPhone: officer?.phone,
      };
    })
    .filter((e) => e.leadPublicRef !== "");
}

/**
 * Calls happening right now.
 *
 * A session is only IN_PROGRESS between the provider's "in-progress" status
 * webhook and its end-of-call report, so this is genuinely live rather than
 * "recently started". Stale sessions are excluded on age: if a provider drops
 * the closing webhook entirely, the session would otherwise sit on the live
 * board forever and the board stops meaning anything.
 */
/**
 * Closes sessions the provider never reported on.
 *
 * Runs on read as well as on the cadence tick. That is deliberate: a
 * deployment whose scheduler is misconfigured is exactly the one most likely
 * to have dropped webhooks, and a board that heals itself the moment someone
 * looks at it beats one that needs a working cron to stop lying.
 *
 * Returns the number settled.
 */
export async function reapStaleCalls(now = new Date(), providerReachable = true): Promise<number> {
  const db = await getDb();
  let settled = 0;

  for (const convo of db.conversations.values()) {
    if (convo.status !== "IN_PROGRESS") continue;

    const verdict = evaluateStaleCall({
      callStatus: convo.callStatus,
      startedAt: convo.startedAt,
      lastSignalAt: convo.lastSignalAt,
      providerReachable,
      now,
    });
    if (!verdict.stale) continue;

    convo.status = "COMPLETED";
    convo.callStatus = "ENDED";
    convo.endedAt = convo.endedAt ?? now.toISOString();
    convo.endedReason = verdict.reason;
    // Flagged so a call log can distinguish "the provider told us it ended"
    // from "we gave up waiting" — they are not the same evidence.
    convo.settledBySystem = true;

    // Only settle an attempt that is still open. One that already resolved
    // from its own webhook is left alone: the report arrived for the attempt
    // and only the session event was missed.
    const attempt = db.attempts.find((a) => a.id === convo.contactAttemptId);
    if (attempt && (attempt.outcome === "QUEUED" || attempt.outcome === "SENT")) {
      attempt.outcome = staleAttemptOutcome(Boolean(verdict.neverConnected));
      attempt.endedAt = now.toISOString();
      attempt.failureMessage = "No end-of-call report was received from the provider.";
    }
    settled += 1;
  }

  if (settled > 0) await saveDb();
  return settled;
}

/**
 * Brings call state up to date. Safe to call from anywhere, any number of
 * times — concurrent callers join one pass rather than racing.
 *
 * Order matters: ask the provider first, THEN reap. Reaping first deletes
 * calls purely because no webhook arrived, which is exactly what happened when
 * webhook auth was misconfigured — every call vanished at the five-minute
 * mark.
 */
export async function syncCallState() {
  return singleFlight("call-sync", async () => {
    // Reconcile and reap decide whether to CLOSE records. Doing that against a
    // stale snapshot is how a call another instance had just opened got
    // settled as unknown — so refresh before judging anything.
    await refreshDb({ force: true });
    const reconciled = await reconcileLiveCalls();
    // Pass reachability through: if the provider could not be reached, nothing
    // is reaped except calls past the absolute ceiling.
    const settled = await reapStaleCalls(new Date(), reconciled.providerReachable);
    return { reconciled, settled };
  });
}

/**
 * Calls currently in flight.
 *
 * Deliberately READ-ONLY. This used to await a reconcile-and-reap pass, which
 * meant every three-second poll performed destructive writes to shared state.
 * Two open tabs produced interleaved passes; the slower write won; calls
 * appeared and vanished at random. A render must not mutate the thing it is
 * rendering.
 *
 * Freshness now comes from the caller invoking syncCallState() explicitly —
 * the board does so through a server action, and the cron does so on a timer.
 */
export async function listLiveCalls(): Promise<CallCentreEntry[]> {
  const all = await listCallActivity(200);
  return all
    .filter((e) => e.conversation?.status === "IN_PROGRESS" && e.conversation.callStatus !== "ENDED")
    .sort((a, b) => new Date(a.conversation!.startedAt).getTime() - new Date(b.conversation!.startedAt).getTime());
}

// ---------------------------------------------------------------------------
// Message centre — SMS activity across every lead.
// ---------------------------------------------------------------------------

export interface MessageThreadSummary {
  leadPublicRef: string;
  leadId: string;
  borrowerName: string;
  stateCode: string;
  leadAssignedOfficerId?: string;
  maskedPhone: string;
  phoneValid: boolean;
  smsConsent: "GRANTED" | "REVOKED" | "MISSING";
  terminal: boolean;
  officerName?: string;
  lastOutboundAt?: string;
  lastOutboundBody?: string;
  lastInboundAt?: string;
  lastInboundBody?: string;
  /** Borrower replied more recently than we sent — someone should answer. */
  awaitingUs: boolean;
  /** We sent and heard nothing back. */
  awaitingBorrower: boolean;
  sentCount: number;
  /** Most recent send the provider refused. */
  lastFailure?: { message: string; failureClass?: string; at: string };
  /** True when this number is suppressed — no further texts may be sent. */
  suppressed: boolean;
  /** Next automated cadence touch, if one is scheduled. */
  nextStepAt?: string;
  nextStepChannel?: Channel;
  history: Array<{
    id: string;
    direction: "INBOUND" | "OUTBOUND";
    body: string;
    at: string;
    sender: string;
    outcome?: ContactAttempt["outcome"];
    aiGenerated?: boolean;
  }>;
}

/**
 * When the cadence will next touch this lead, and on which channel.
 *
 * Derived exactly the way domain/cadenceEngine.ts derives it — step index from
 * the count of OUTREACH_ATTEMPTED events tagged as cadence steps, due time
 * from lead.createdAt plus that step's offset. There is no stored
 * "next action" field, and inventing one here would give the centre a second
 * opinion that drifts from what the engine actually does.
 */
function nextCadenceTouch(
  db: Database,
  lead: Lead
): { nextStepAt?: string; nextStepChannel?: Channel } {
  const plan = db.cadencePlans.get(lead.cadencePlanVersionId);
  if (!plan || plan.steps.length === 0) return {};

  const fired = db.events.filter(
    (e) => e.leadId === lead.id && e.type === "OUTREACH_ATTEMPTED" && e.payload?.reason === "automated_cadence_step"
  ).length;

  const steps = [...plan.steps].sort((a, b) => a.offsetMinutes - b.offsetMinutes);
  const next = steps[fired];
  if (!next) return {}; // cadence exhausted

  return {
    nextStepAt: new Date(new Date(lead.createdAt).getTime() + next.offsetMinutes * 60_000).toISOString(),
    nextStepChannel: next.channel,
  };
}

/**
 * One row per lead, including leads which have not been texted yet. That is
 * important operationally: a message centre that hides an uncontacted lead
 * cannot be used to safely initiate the first conversation.
 *
 * Built as a summary rather than returning whole threads: the centre is a
 * triage surface, and loading every message of every conversation to render a
 * list of last-lines would grow linearly with the life of the account.
 */
export async function listMessageThreads(limit = 60): Promise<MessageThreadSummary[]> {
  const db = await getDb();
  const suppressedNumbers = new Set(Array.from(db.suppressions.values()).map((s) => s.phoneE164));

  const byLead = new Map<string, ContactAttempt[]>();
  for (const a of db.attempts) {
    if (a.channel !== "SMS") continue;
    const list = byLead.get(a.leadId) ?? [];
    list.push(a);
    byLead.set(a.leadId, list);
  }

  const summaries: MessageThreadSummary[] = [];

  for (const lead of db.leads.values()) {
    const leadId = lead.id;
    const attempts = byLead.get(leadId) ?? [];
    const person = Array.from(db.people.values()).find((p) => p.leadId === leadId && p.role === "PRIMARY");

    const sorted = [...attempts].sort(
      (a, b) => new Date(a.startedAt ?? a.scheduledFor).getTime() - new Date(b.startedAt ?? b.scheduledFor).getTime()
    );
    const lastOutbound = [...sorted].reverse().find((a) => a.direction === "OUTBOUND" && a.outcome !== "FAILED" && a.outcome !== "BLOCKED");

    // Borrower replies are stored as borrower-authored notes, not attempts —
    // same source the unified conversation thread reads from, so the centre
    // cannot disagree with the lead page about who spoke last.
    const inbound = db.notes
      .filter((n) => n.leadId === leadId && n.authorId === "borrower" && (n.conversationChannel === "SMS" || (!n.conversationChannel && /text reply/i.test(n.authorName))))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const lastInbound = inbound[inbound.length - 1];

    const failure = [...sorted].reverse().find((a) => a.outcome === "FAILED" && a.failureMessage);

    const lastOutAt = lastOutbound ? (lastOutbound.startedAt ?? lastOutbound.scheduledFor) : undefined;
    const lastInAt = lastInbound?.createdAt;
    const latestConsent = db.consents
      .filter((consent) => consent.leadId === leadId && consent.scope === "CONTACT_SMS")
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
    const history = [
      ...sorted
        .filter((attempt) => attempt.direction === "OUTBOUND" && attempt.outcome !== "BLOCKED" && Boolean(attempt.body))
        .map((attempt) => ({
          id: attempt.id,
          direction: "OUTBOUND" as const,
          body: attempt.body!,
          at: attempt.startedAt ?? attempt.scheduledFor,
          sender: attempt.loggedByName ?? (attempt.aiGenerated ? "AI SMS assistant" : "Equity Flow Group"),
          outcome: attempt.outcome,
          aiGenerated: attempt.aiGenerated,
        })),
      ...inbound.map((note) => ({
        id: note.id,
        direction: "INBOUND" as const,
        body: note.body,
        at: note.createdAt,
        sender: person?.firstName || "Borrower",
      })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-20);
    const phone = person?.phoneE164 ?? "";

    summaries.push({
      leadPublicRef: lead.publicRef,
      leadId,
      borrowerName: person ? `${person.firstName} ${person.lastName}` : "Unknown borrower",
      stateCode: lead.stateCode,
      leadAssignedOfficerId: lead.assignedOfficerId,
      maskedPhone: phone ? maskPhone(phone) : "No phone on file",
      phoneValid: /^\+[1-9]\d{7,14}$/.test(phone),
      smsConsent: latestConsent ? (latestConsent.granted ? "GRANTED" : "REVOKED") : "MISSING",
      terminal: ["SUPPRESSED", "CLOSED_WON", "CLOSED_LOST"].includes(lead.state),
      officerName: lead.assignedOfficerId ? db.officers.get(lead.assignedOfficerId)?.name : undefined,
      lastOutboundAt: lastOutAt,
      lastOutboundBody: lastOutbound?.body,
      lastInboundAt: lastInAt,
      lastInboundBody: lastInbound?.body,
      awaitingUs: Boolean(lastInAt && (!lastOutAt || new Date(lastInAt) > new Date(lastOutAt))),
      awaitingBorrower: Boolean(lastOutAt && (!lastInAt || new Date(lastOutAt) > new Date(lastInAt))),
      sentCount: sorted.filter((a) => a.direction === "OUTBOUND" && a.outcome !== "FAILED" && a.outcome !== "BLOCKED").length,
      lastFailure: failure
        ? {
            message: failure.failureMessage!,
            failureClass: failure.failureClass,
            at: failure.startedAt ?? failure.scheduledFor,
          }
        : undefined,
      suppressed: Boolean(person && suppressedNumbers.has(person.phoneE164)),
      history,
      ...nextCadenceTouch(db, lead),
    });
  }

  return summaries
    .sort((a, b) => {
      // A borrower waiting on us outranks everything: it is the only state in
      // the list where a person is actively expecting a reply.
      if (a.awaitingUs !== b.awaitingUs) return a.awaitingUs ? -1 : 1;
      const at = Math.max(Date.parse(a.lastInboundAt ?? "0") || 0, Date.parse(a.lastOutboundAt ?? "0") || 0);
      const bt = Math.max(Date.parse(b.lastInboundAt ?? "0") || 0, Date.parse(b.lastOutboundAt ?? "0") || 0);
      return bt - at || a.borrowerName.localeCompare(b.borrowerName);
    })
    .slice(0, limit);
}

/** Admin override for a public legal page, or null to use the built-in copy. */
export async function getLegalPage(slug: "privacy" | "terms") {
  const db = await getDb();
  return db.legalPages.get(slug) ?? null;
}
