// Domain types mirroring SPEC.md section 4 (Prisma schema highlights).
// This is the mock-data-era shape; a real Prisma schema can be generated
// from these types 1:1 when the project moves off the in-memory store.

export type LeadState =
  | "NEW"
  | "ATTEMPTING_CONTACT"
  | "IN_CONVERSATION"
  | "QUALIFYING"
  | "READY_FOR_HANDOFF"
  | "ASSIGNED"
  | "ACKNOWLEDGED"
  | "NURTURE"
  | "STALE"
  | "SUPPRESSED"
  | "CLOSED_WON"
  | "CLOSED_LOST";

export type Channel = "VOICE" | "SMS" | "EMAIL";

export type ConsentScope = "CONTACT_VOICE" | "CONTACT_SMS" | "CONTACT_EMAIL" | "RECORDING" | "DATA_SHARING";

export type SuppressionReason =
  | "OPT_OUT_STOP"
  | "DNC_LIST"
  | "WRONG_PARTY"
  | "COMPLAINT"
  | "MANUAL"
  | "LITIGATION";

export type AttemptOutcome =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "ANSWERED"
  | "NO_ANSWER"
  | "BUSY"
  | "VOICEMAIL"
  | "FAILED"
  | "BLOCKED"
  | "UNDELIVERED";

export type FieldStatus = "UNKNOWN" | "CANDIDATE" | "CONFIRMED" | "VERIFIED" | "CONFLICTED";

export type LoanIntent = "REFINANCE" | "HOME_EQUITY" | "CASH_OUT" | "UNKNOWN";

export type Occupancy = "PRIMARY" | "SECOND_HOME" | "INVESTMENT" | "UNKNOWN";

export type Role = "ADMIN" | "COMPLIANCE" | "OFFICER" | "READ_ONLY";

export type GoalType = "LOWER_PAYMENT" | "CASH_OUT" | "SHORTEN_TERM" | "DEBT_CONSOLIDATION" | "OTHER";

export type Timeline = "ASAP" | "1_3_MONTHS" | "3_6_MONTHS" | "EXPLORING";

export type CreditRange = "EXCELLENT_740_PLUS" | "GOOD_680_739" | "FAIR_620_679" | "BELOW_620" | "UNSURE";

// Missed mortgage payments in the trailing 12 months, self-reported at
// intake. Drives referral routing, not disqualification — see ReferralType.
export type MissedPayments = "NONE" | "ONE_TO_TWO" | "THREE_PLUS";

// A lead that can't qualify for refi/equity isn't a dead lead — 1-2 missed
// payments routes to a loan-modification partner, 3+ to a foreclosure
// specialist. Computed once at intake from MissedPayments.
export type ReferralType = "NONE" | "LOAN_MODIFICATION" | "FORECLOSURE";

export type ContactWindow = "MORNING" | "AFTERNOON" | "EVENING" | "ANY";

export type TaskType =
  | "FIRST_CONTACT"
  | "FOLLOW_UP"
  | "REVIEW_MISSING_FIELDS"
  | "ACKNOWLEDGE_HANDOFF"
  | "COMPLAINT"
  | "NO_ELIGIBLE_OFFICER"
  | "PRIORITY_CALLBACK_REQUESTED"
  | "HOT_LEAD_ALERT"
  | "BORROWER_MESSAGE";

export type TaskStatus = "OPEN" | "COMPLETED" | "CANCELLED";

export type ActorType = "SYSTEM" | "OFFICER" | "BORROWER" | "PROVIDER" | "ADMIN";

export type LeadEventType =
  | "LEAD_CREATED"
  | "DUPLICATE_INTAKE"
  | "SUPPRESSED_ON_INTAKE"
  | "OUTREACH_ATTEMPTED"
  | "OUTREACH_BLOCKED"
  | "OUTREACH_DEFERRED"
  | "CONTACT_ANSWERED"
  | "CONVERSATION_COMPLETED"
  | "FIELDS_EXTRACTED"
  | "PACKAGE_READY"
  | "OFFICER_ASSIGNED"
  | "OFFICER_ACKNOWLEDGED"
  | "OFFICER_TAKEOVER"
  | "MANUAL_REASSIGNMENT"
  | "CADENCE_EXHAUSTED"
  | "OPT_OUT_RECEIVED"
  | "DNC_MATCH"
  | "COMPLAINT"
  | "WRONG_PARTY"
  | "ESCALATED"
  | "NOTE_ADDED"
  | "FIELD_CORRECTED"
  | "MARKED_WON"
  | "MARKED_LOST"
  | "EXPORTED"
  | "SUPPRESSION_LIFTED"
  | "KILL_SWITCH_TOGGLED"
  | "PRIORITY_CALLBACK_REQUESTED"
  | "HOT_LEAD_SCORED"
  | "AUTOMATED_CADENCE_STEP";

export interface Person {
  id: string;
  leadId: string;
  role: "PRIMARY" | "CO_BORROWER";
  firstName: string;
  lastName: string;
  phoneE164: string;
  email: string;
  preferredContactWindow: ContactWindow;
  timezone: string | "UNKNOWN";
}

export interface ConsentRecord {
  id: string;
  leadId: string;
  personId: string;
  scope: ConsentScope;
  granted: boolean;
  disclosureVersionId: string;
  exactTextSnapshot: string;
  capturedAt: string;
  sourceUrl: string;
  ipAddress: string;
  userAgent: string;
  sessionId: string;
  formFingerprint: string;
}

export interface DisclosureVersion {
  id: string;
  key: string;
  version: number;
  bodyText: string;
  effectiveFrom: string;
  effectiveTo?: string;
  approvedBy: string;
  approvedAt: string;
  status: "DRAFT" | "APPROVED" | "RETIRED";
}

export interface Suppression {
  id: string;
  phoneE164: string;
  reason: SuppressionReason;
  scope: "GLOBAL" | "CHANNEL";
  channel?: Channel;
  createdAt: string;
  expiresAt?: string | null;
  evidenceEventId?: string;
}

export interface LeadEvent {
  id: string;
  leadId: string;
  type: LeadEventType;
  actorType: ActorType;
  actorId?: string;
  actorName?: string;
  channel?: Channel;
  payload?: Record<string, unknown>;
  occurredAt: string;
  recordedAt: string;
  correlationId: string;
}

export interface ContactAttempt {
  id: string;
  leadId: string;
  channel: Channel;
  direction: "OUTBOUND" | "INBOUND";
  idempotencyKey: string;
  policyDecisionId?: string;
  providerMessageId?: string;
  outcome: AttemptOutcome;
  attemptNumber: number;
  scheduledFor: string;
  startedAt?: string;
  endedAt?: string;
  recordingUrl?: string;
  transcriptId?: string;
  blockedReason?: string;
  /** What was actually sent — lets the officer review every email/text verbatim later. */
  subject?: string;
  body?: string;
  aiGenerated?: boolean;
  durationSec?: number;
  loggedById?: string;
  loggedByName?: string;
}

export interface SystemConfig {
  firstContactSlaMinutes: number;
  dailyAttemptCap: number;
  minSpacingHours: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  senderName: string;
  senderEmail: string;
  scoringWeights: ScoringWeights;
  hotLeadThreshold: number;
}

// Max points per lead-quality-score component (Equity Flow Group business
// plan, July 2026: S_Equity + S_Margin + S_Compliance + S_Behavior = 100).
// Admin-adjustable so priorities can pivot between a debt-consolidation
// cycle and a rate/term refi boom without a code change.
export interface ScoringWeights {
  equity: number;
  margin: number;
  compliance: number;
  behavior: number;
}

export type RuleCode =
  | "KILL_SWITCH"
  | "SUPPRESSED_GLOBAL"
  | "SUPPRESSED_CHANNEL"
  | "NO_CONSENT"
  | "CONSENT_REVOKED"
  | "LEAD_TERMINAL"
  | "OFFICER_OWNED"
  | "ATTEMPT_CAP_TOTAL"
  | "UNKNOWN_TIMEZONE"
  | "QUIET_HOURS_LOCAL"
  | "ATTEMPT_CAP_DAILY"
  | "MIN_SPACING"
  | "WEEKEND_RULE"
  | "ALLOW";

export interface PolicyDecision {
  id: string;
  leadId: string;
  channel: Channel;
  decision: "ALLOW" | "DENY" | "DEFER";
  reasons: RuleCode[];
  evaluatedAt: string;
  nextPermittedAt?: string;
  inputSnapshot: Record<string, unknown>;
}

export interface Task {
  id: string;
  leadId: string;
  type: TaskType;
  assigneeId?: string;
  dueAt: string;
  status: TaskStatus;
  completedAt?: string;
  completedById?: string;
  title: string;
}

export interface CadenceStep {
  offsetMinutes: number;
  channel: Channel;
  templateId?: string;
  maxAttempts: number;
  stopOnOutcomes: AttemptOutcome[];
}

export interface CadencePlan {
  id: string;
  name: string;
  sourceId?: string;
  stateCode?: string;
  intent?: LoanIntent;
  steps: CadenceStep[];
  isDefault: boolean;
}

export interface ConversationTurn {
  turn: number;
  role: "AGENT" | "BORROWER";
  text: string;
  at: string;
}

export interface ConversationSession {
  id: string;
  leadId: string;
  contactAttemptId: string;
  promptVersionId: string;
  channel: Channel;
  status: "IN_PROGRESS" | "COMPLETED" | "ESCALATED";
  startedAt: string;
  endedAt?: string;
  escalated: boolean;
  escalationReason?: string;
  transcript: ConversationTurn[];
  summary?: string;
  redactionApplied: boolean;
}

export interface FieldCandidate {
  id: string;
  leadId: string;
  fieldPath: string;
  value: unknown;
  confidence: number;
  sourceType: "BORROWER_STATED" | "OFFICER_ENTERED" | "FORM" | "PROVIDER";
  sessionId?: string;
  transcriptTurnRefs: number[];
  createdAt: string;
  promoted: boolean;
  promotionRuleCode?: string;
}

export interface LeadField {
  id: string;
  leadId: string;
  fieldPath: string;
  value: unknown;
  status: FieldStatus;
  confidence: number;
  sourceType: "BORROWER_STATED" | "OFFICER_ENTERED" | "FORM" | "PROVIDER";
  collectedAt: string;
  lastUpdatedById?: string;
  verificationStatus: "UNVERIFIED" | "VERIFIED";
  supersededCandidateIds: string[];
  conflictingValue?: unknown;
}

export interface Officer {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  nmlsId: string;
  licensedStates: string[];
  productTypes: LoanIntent[];
  dailyCapacity: number;
  currentLoad: number;
  activeHoursStart: number; // local hour 0-23
  activeHoursEnd: number;
  isActive: boolean;
}

// A borrower who can't qualify for refi/equity isn't a dead lead — routing
// them to a specialist partner (foreclosure, loan mod, bankruptcy) is a
// second, real revenue line off the same lead spend.
export type ReferralSpecialty = "FORECLOSURE" | "LOAN_MODIFICATION" | "BANKRUPTCY";

export interface ReferralPartner {
  id: string;
  name: string;
  specialty: ReferralSpecialty;
  contactName?: string;
  phone?: string;
  email?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress: string;
  result: "ALLOW" | "DENY";
  metadata?: Record<string, unknown>;
  at: string;
}

export interface ExportRecord {
  id: string;
  leadId: string;
  destination: string;
  payloadHash: string;
  fieldsIncluded: string[];
  exportedById: string;
  at: string;
  providerResponse?: Record<string, unknown>;
}

export interface Note {
  id: string;
  leadId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface Lead {
  id: string;
  publicRef: string;
  state: LeadState;
  intent: LoanIntent;
  goal: GoalType;
  timeline: Timeline;
  creditRange: CreditRange;
  sourceId: string;
  stateCode: string;
  city?: string;
  addressLine1?: string;
  postalCode?: string;
  estimatedValue?: number;
  currentBalance?: number;
  occupancy: Occupancy;
  assignedOfficerId?: string;
  cadencePlanVersionId: string;
  slaDueAt: string;
  firstContactAt?: string;
  lastContactAt?: string;
  completenessScore: number;
  createdAt: string;
  updatedAt: string;
  attemptsToday: number;
  attemptsTotal: number;
  lastAttemptAt?: string | null;
  missedPayments?: MissedPayments;
  referralType?: ReferralType;
  referredToPartnerId?: string;
  referredAt?: string;
  hasExistingHomeEquityLoan?: boolean;
  /** Seconds from first intake screen to submit — the "fast completion"
   *  signal in S_Behavior lead scoring. */
  intakeDurationSeconds?: number;
  /** Cached AVM lookup (see src/adapters/propertyData.ts), computed once at
   *  intake and reused on every later read — keeps a metered vendor's
   *  free-tier quota to ~1 call per unique property instead of 1 per page view. */
  propertyValuation?: PropertyValuationResult;
}

export type PropertyType = "SINGLE_FAMILY" | "CONDO" | "TOWNHOME" | "MULTI_FAMILY";

export interface PropertyValuationResult {
  estimatedValue: number;
  confidenceLow: number;
  confidenceHigh: number;
  comparableCount: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
  /** Public-record estimate of the outstanding primary mortgage balance —
   *  a fallback for lead scoring when the borrower didn't self-report one.
   *  No AVM vendor exposes real outstanding-balance data (that's private
   *  lender data), so this is always an assumed-LTV model, live or simulated. */
  estimatedMortgageBalance: number;
  propertyType: PropertyType;
  yearBuilt: number;
  /** Loan-to-value, 0-100, derived from estimatedValue/estimatedMortgageBalance. */
  estimatedLTV: number;
  /** estimatedValue - estimatedMortgageBalance, floored at 0. */
  usableEquity: number;
  simulated: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  officerId?: string;
  isActive?: boolean;
  createdAt?: string;
  createdById?: string;
  /** "salt:hash" (scrypt) — absent until the user completes their invite/reset link. */
  passwordHash?: string;
  failedLoginAttempts?: number;
  /** ISO timestamp; login is refused while now < lockedUntil. */
  lockedUntil?: string;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

/** One-time links for account setup ("invite") and forgot-password ("reset"). */
export interface AuthToken {
  token: string;
  userId: string;
  purpose: "invite" | "reset";
  expiresAt: string;
}

export interface KillSwitchState {
  isOn: boolean;
  toggledAt?: string;
  toggledById?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Lead discovery — public forum/social posts expressing refinance or equity
// intent. Deliberately NOT a Lead: no phone/email consent exists yet, so it
// cannot enter the compliance-gated pipeline. A human reviews and decides
// whether/how to pursue it through a legitimate, consented channel. See
// adapters/leadDiscovery.ts and core/discovery/ for the reasoning.
// ---------------------------------------------------------------------------
export type SignalSource = "REDDIT" | "FORUM";
export type SignalStatus = "NEW" | "REVIEWED" | "DISMISSED" | "ACTIONED";

export interface DiscoveredSignal {
  id: string;
  source: SignalSource;
  sourceUrl: string;
  subreddit?: string;
  authorHandle: string;
  title: string;
  snippet: string;
  postedAt: string;
  detectedIntent: LoanIntent;
  confidence: number;
  matchedKeywords: string[];
  status: SignalStatus;
  discoveredAt: string;
  reviewedById?: string;
  reviewedByName?: string;
  reviewNote?: string;
  reviewedAt?: string;
  promotedLeadId?: string;
}
