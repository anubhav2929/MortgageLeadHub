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

/** The single source of truth for task types. TaskType is derived from this
 *  array rather than declared separately, so a new type cannot be added to the
 *  union while the UI's filter list silently keeps the old set — which is
 *  exactly what happened when the delivery-failure types were introduced. */
export const ALL_TASK_TYPES = [
  "FIRST_CONTACT",
  "FOLLOW_UP",
  "REVIEW_MISSING_FIELDS",
  "ACKNOWLEDGE_HANDOFF",
  "COMPLAINT",
  "NO_ELIGIBLE_OFFICER",
  "PRIORITY_CALLBACK_REQUESTED",
  "HOT_LEAD_ALERT",
  "BORROWER_MESSAGE",
  "INBOUND_EMAIL",
  /** A contact address the provider says is permanently undeliverable. */
  "REVIEW_CONTACT_DATA",
  /** A provider credential/registration problem affecting every lead. */
  "INTEGRATION_ALERT",
] as const;

export type TaskType = (typeof ALL_TASK_TYPES)[number];

export type TaskStatus = "OPEN" | "COMPLETED" | "CANCELLED";

export type ActorType = "SYSTEM" | "OFFICER" | "BORROWER" | "PROVIDER" | "ADMIN";

export type LeadEventType =
  | "LEAD_CREATED"
  | "DUPLICATE_INTAKE"
  | "SUPPRESSED_ON_INTAKE"
  | "OUTREACH_ATTEMPTED"
  | "OUTREACH_BLOCKED"
  | "OUTREACH_DEFERRED"
  /** A send was attempted and the provider rejected it. Distinct from
   *  OUTREACH_BLOCKED, which is our own PolicyGate refusing to send. */
  | "OUTREACH_FAILED"
  /** A provider delivery webhook advanced an attempt's outcome. */
  | "DELIVERY_UPDATED"
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
  | "PROPERTY_VALUATION_REFRESHED"
  | "AUTOMATED_CADENCE_STEP"
  /** A soft credit inquiry was permitted and ran. */
  | "CREDIT_PULL_COMPLETED"
  /** The FCRA gate refused an inquiry — no consent, low intent, or duplicate. */
  | "CREDIT_PULL_BLOCKED"
  /** The bureau returned no match, or the provider errored. */
  | "CREDIT_PULL_FAILED"
  | "CALLBACK_BOOKED"
  | "CALLBACK_MESSAGE_QUEUED"
  | "CALLBACK_MESSAGE_SENT"
  | "CALLBACK_MESSAGE_SUPPRESSED"
  | "TRANSFER_STATUS_CHANGED";

export type QualificationQuestionId =
  | "timeline"
  | "property_address"
  | "occupancy"
  | "estimated_value"
  | "mortgage_balance"
  | "cash_goal"
  | "credit_range"
  | "transfer_consent";

export interface LeadContextSnapshot {
  id: string;
  leadId: string;
  conversationId: string;
  createdAt: string;
  promptVersionId: string;
  profileVersionId: string;
  borrower: { firstName: string; timezone: string | "UNKNOWN" };
  intake: {
    intent: LoanIntent;
    goal: GoalType;
    timeline?: Timeline;
    stateCode: string;
    occupancy?: Occupancy;
    addressLine1?: string;
    city?: string;
    postalCode?: string;
    estimatedValue?: number;
    currentBalance?: number;
    creditRange?: CreditRange;
  };
  verifiedFields: Record<string, unknown>;
  conversationBrief?: string;
  excludedSensitiveFields: string[];
}

export interface QualificationAnswer {
  id: string;
  leadId: string;
  conversationId: string;
  questionId: QualificationQuestionId;
  fieldPath: string;
  value: unknown;
  confidence: number;
  source: "FORM" | "VERIFIED_FIELD" | "BORROWER_STATED";
  transcriptTurnRefs: number[];
  conflict: boolean;
  capturedAt: string;
}

export interface QualificationProgress {
  leadId: string;
  conversationId: string;
  snapshotId: string;
  answers: QualificationAnswer[];
  requiredQuestionIds: QualificationQuestionId[];
  nextQuestionId?: QualificationQuestionId;
  completedAt?: string;
  updatedAt: string;
}

export interface QualificationDecision {
  leadId: string;
  conversationId: string;
  outcome: "READY_FOR_TRANSFER" | "NEEDS_REVIEW" | "REFERRAL";
  reasonCodes: string[];
  decidedAt: string;
}

export type TransferAttemptStatus =
  | "REQUESTED"
  | "DIALING"
  | "OFFICER_ANSWERED"
  | "SUMMARY_DELIVERED"
  | "BRIDGED"
  | "FAILED"
  | "DECLINED"
  | "CALLBACK_OFFERED";

export interface TransferAttempt {
  id: string;
  leadId: string;
  conversationId: string;
  officerId?: string;
  destinationMasked: string;
  status: TransferAttemptStatus;
  requestedAt: string;
  updatedAt: string;
  providerCallId?: string;
  providerTransferId?: string;
  consentTurnRef?: number;
  failureReason?: string;
}

export type CallbackStatus = "BOOKED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "MISSED";

export interface CallbackReminderPolicy {
  slotDurationMinutes: number;
  bufferMinutes: number;
  minimumLeadMinutes: number;
  bookingHorizonDays: number;
  reminderMinutesBefore: number;
  confirmationTemplate: string;
  reminderTemplate: string;
}

export interface CallbackAppointment {
  id: string;
  leadId: string;
  officerId?: string;
  sourceConversationId?: string;
  transferAttemptId?: string;
  startsAt: string;
  endsAt: string;
  borrowerTimezone: string;
  status: CallbackStatus;
  consentRecordId?: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  cancellationReason?: string;
  providerCorrelationIds: string[];
  confirmationAttemptId?: string;
  reminderAttemptId?: string;
}

export type DialingSessionMode = "MANUAL_NEXT" | "AUTO_SEQUENTIAL";
export type DialingSessionStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
export type DialingQueueItemStatus = "PENDING" | "CALLING" | "COMPLETED" | "BLOCKED" | "FAILED" | "SKIPPED";

export interface DialingSession {
  id: string;
  name: string;
  mode: DialingSessionMode;
  status: DialingSessionStatus;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  currentItemId?: string;
  completedAt?: string;
  cancelledAt?: string;
}

export interface DialingQueueItem {
  id: string;
  sessionId: string;
  leadId: string;
  position: number;
  status: DialingQueueItemStatus;
  attemptId?: string;
  conversationId?: string;
  reason?: string;
  startedAt?: string;
  completedAt?: string;
}

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
  /** Set only when non-empty — AI/heuristic identity check flagged the
   *  submitted name as placeholder-like or malformed. Officer should verify
   *  before treating this as a real contact. See adapters/llm.ts validateIdentity. */
  dataQualityFlags?: string[];
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
  /** Why a send failed, when it did. PERMANENT means the destination is bad
   *  and the channel should be suppressed for this lead; CONFIGURATION means
   *  every lead is affected and an administrator must act. See
   *  core/deliveryStatus.ts. */
  failureClass?: "PERMANENT" | "TRANSIENT" | "CONFIGURATION";
  failureMessage?: string;
  /** Set when a transient failure is scheduled to be retried, so the cadence
   *  engine can pick it up without re-deriving the backoff. */
  retryAfter?: string;
  retryCount?: number;
  /** Last provider delivery status applied, for out-of-order webhook rejection. */
  deliveryUpdatedAt?: string;
  /** Set when someone dismissed this failure from the alerts band. The row
   *  stays in the call log forever — acknowledging hides the alert, it does
   *  not delete the record. */
  acknowledgedAt?: string;
  acknowledgedByName?: string;
}

/** A provider credential entered through Admin → Integrations. `value` is
 *  always an encrypted payload (core/secretBox.ts) — never plaintext, even
 *  for non-secret fields, so the storage path has one rule instead of two. */
export interface IntegrationCredential {
  key: string;
  value: string;
  updatedAt: string;
  updatedByName: string;
}

export interface SystemConfig {
  /** Operational display/report timezone. Timestamps remain UTC at rest. */
  adminTimezone?: string;
  timezoneConfirmed?: boolean;
  firstContactSlaMinutes: number;
  dailyAttemptCap: number;
  minSpacingHours: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  senderName: string;
  senderEmail: string;
  scoringWeights: ScoringWeights;
  hotLeadThreshold: number;
  /** Minutes to hold automated outreach while the borrower is active in the
   *  post-submit chat. See core/engagementWindow.ts. */
  engagementWindowMinutes?: number;
  /**
   * Show the environment banner in the root layout. Defaults to true.
   * Its *text* is always derived from live capabilities (see
   * core/environmentBanner.ts) — this only controls whether it renders.
   */
  showEnvironmentBanner?: boolean;
  /**
   * Admin escalation for manual outreach. Relaxes pacing rules only — quiet
   * hours, daily caps, spacing. It cannot relax consent, suppression,
   * opt-out, the kill switch, or terminal lead states, and it is ignored
   * entirely for automated cadence steps. See core/policyGate.ts.
   */
  outreachOverrides?: {
    ignoreQuietHours?: boolean;
    ignoreAttemptCaps?: boolean;
    ignoreMinSpacing?: boolean;
  };
  callbackReminderPolicy?: CallbackReminderPolicy;
  featureFlags?: {
    automaticWarmTransfer?: boolean;
    callbackScheduling?: boolean;
    normalizedReads?: boolean;
    redditPosting?: boolean;
    freePropertyValuation?: boolean;
    metaCapi?: boolean;
    automatedPowerDialer?: boolean;
  };
}

// Max points per lead-quality-score component (Equity Flow Group business
// plan, July 2026: S_Equity + S_Margin + S_Compliance + S_Behavior = 100).
// Admin-adjustable so priorities can pivot between a payment-simplification
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
  /** Fallback channel. When autoRoute is on, this is only used if the router
   *  can't pick (nothing permitted, or no signal either way). */
  channel: Channel;
  /** Let core/channelRouter.ts choose the channel at send time from what this
   *  specific borrower has consented to, replied on, and the local hour —
   *  rather than using the channel this plan was authored with. Opt-in per
   *  step so existing plans keep behaving exactly as before. */
  autoRoute?: boolean;
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
  actionItems?: string[];
  profileSnapshot?: Record<string, unknown>;
  contextSnapshot?: Record<string, unknown>;
  providerCallId?: string;
  redactionApplied: boolean;
  /** Live-call handles from the provider, captured when the call is placed.
   *  Per-call and short-lived — they cannot be rebuilt from the call id, so
   *  they are stored rather than fetched on demand. Only meaningful while
   *  status is IN_PROGRESS. */
  listenUrl?: string;
  controlUrl?: string;
  /**
   * The carrier's own view of the call, distinct from `status`.
   *
   * `status` is our workflow state (is a transcript coming, is it settled).
   * This is where the call actually is on the network. They are not the same
   * thing and conflating them is why the live board showed "connected" for a
   * call that was still ringing — or for one that never connected at all.
   *
   * Set optimistically to QUEUED when we place the call, then advanced only
   * by provider webhooks.
   */
  callStatus?: "QUEUED" | "RINGING" | "CONNECTED" | "ENDED";
  /** Set when the provider tells us why the call ended. */
  endedReason?: string;
  /** Last time any provider webhook touched this call. Staleness is measured
   *  from webhook silence rather than from call age, so a genuinely long
   *  conversation that is still emitting transcript events is never reaped. */
  lastSignalAt?: string;
  /** True when this session was closed by the reaper rather than by the
   *  provider — the difference matters when reading a call log later. */
  settledBySystem?: boolean;
}

export interface InboundCallTriage {
  id: string;
  provider: "VAPI";
  providerCallId: string;
  fromPhone?: string;
  reason: "UNKNOWN_CALLER" | "AMBIGUOUS_CALLER";
  candidateLeadIds: string[];
  status: "OPEN" | "LINKED" | "DISMISSED";
  receivedAt: string;
  linkedLeadId?: string;
  resolvedAt?: string;
  resolvedById?: string;
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
  reviewStatus?: "PENDING" | "ACCEPTED" | "REJECTED";
  reviewedById?: string;
  reviewedAt?: string;
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
  /** Only the SHA-256 digest is stored. The raw high-entropy token exists in
   * borrower links and can be revoked by issuing a replacement. */
  statusTokenHash?: string;
  statusTokenIssuedAt?: string;
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
  /** Last borrower interaction in the post-submit chat / status page. While
   *  this is fresh, automated outreach holds off — see core/engagementWindow.ts. */
  lastEngagedAt?: string;
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
  /** Per-field origin. `simulated` alone is too coarse: even on a live
   *  RentCast lookup the balance/LTV/equity trio is modeled, because no AVM
   *  vendor publishes outstanding mortgage balances. Labelling the whole card
   *  "Live estimate" therefore overstated three numbers a loan officer might
   *  quote to a borrower. MEASURED = returned by the vendor;
   *  MODELED = derived by us from an assumption. */
  provenance: Record<PropertyValuationField, "MEASURED" | "MODELED">;
  /** The estimate is informational and must not be represented as an appraisal. */
  disclaimer?: string;
  method?: "OPEN_EVIDENCE" | "RENTCAST" | "INSUFFICIENT_EVIDENCE" | "SIMULATED";
  confidence?: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
  evidence?: PropertyValuationEvidence[];
  freshnessAt?: string;
  providerCostUsd?: number;
}

export interface PropertyValuationEvidence {
  id: string;
  kind: "BORROWER_ESTIMATE" | "RECORDED_SALE" | "PUBLIC_RECORD" | "CENSUS_MARKET" | "FHFA_HPI" | "ASSESSOR" | "RENTCAST";
  value?: number;
  observedAt?: string;
  retrievedAt: string;
  sourceUrl?: string;
  sourceLabel: string;
  reliability: number;
  notes?: string;
}

export type PropertyValuationField =
  | "estimatedValue"
  | "confidenceRange"
  | "comparableCount"
  | "lastSale"
  | "estimatedMortgageBalance"
  | "estimatedLTV"
  | "usableEquity"
  | "propertyType"
  | "yearBuilt";

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
  mfa?: {
    encryptedSecret: string;
    pendingCreatedAt?: string;
    enabledAt?: string;
    recoveryCodeHashes?: string[];
  };
}

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt?: string;
  idleExpiresAt?: string;
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
  /** Which source the post came from, so a reviewer can weigh it. */
  sourceLabel?: string;
  /** Deterministic keyword/recency score before any model input, kept
   *  alongside the blended `confidence` so a reviewer can see how much of the
   *  ranking was measured and how much was judged. */
  baseScore?: number;
  /** AI assessment (see adapters/llm.ts assessSignal). Absent when no LLM is
   *  configured — the feature degrades to deterministic scoring rather than
   *  disappearing. */
  assessment?: {
    isProspect: boolean;
    urgency: "IMMEDIATE" | "WEEKS" | "RESEARCHING" | "UNKNOWN";
    situation: string;
    suggestedAngle: string;
    concerns: string[];
    qualityScore: number;
  };
  reviewedById?: string;
  reviewedByName?: string;
  reviewNote?: string;
  reviewedAt?: string;
  promotedLeadId?: string;
  redditPublicationId?: string;
}

export interface RedditConnection {
  id: string;
  accountName: string;
  encryptedRefreshToken: string;
  scopes: string[];
  connectedAt: string;
  connectedById: string;
  revokedAt?: string;
}

export interface RedditPublication {
  id: string;
  signalId: string;
  finalText: string;
  approvedById: string;
  approvedByName: string;
  subredditRulesConfirmed: boolean;
  idempotencyKey: string;
  status: "PENDING" | "PUBLISHED" | "FAILED";
  redditCommentId?: string;
  permalink?: string;
  providerResponse?: Record<string, unknown>;
  createdAt: string;
  publishedAt?: string;
}

export interface IntegrationHealthCheck {
  integrationId: string;
  ok: boolean;
  message: string;
  verifiedAt: string;
  verifiedById: string;
  verifiedByName: string;
}

// ---------------------------------------------------------------------------
// Intake drafts — a visitor who started the form and dropped off before
// consenting. Deliberately NOT a Lead for the same reason DiscoveredSignal
// isn't: no consent exists yet, so it must never enter the automated
// PolicyGate/cadence pipeline (that pipeline only ever reads db.leads). A
// human decides whether and how to follow up, same as a discovered signal.
// Purged automatically after DRAFT_RETENTION_DAYS (see the cron route) —
// this is PII sitting outside the consent-gated flow, so it doesn't get to
// live forever just because nobody remembered to clean it up.
// ---------------------------------------------------------------------------
/**
 * A one-shot voice announcement script fetched by Telnyx at call time.
 *
 * Twilio accepts TwiML inline in the same request that places the call, so it
 * needs nothing like this. Telnyx TeXML only accepts a `Url` to fetch, which
 * means the script must survive between "place the call" and "carrier fetches
 * instructions" — two separate HTTP requests, potentially on two different
 * serverless instances.
 *
 * Deliberately not passed as a query parameter: the script would then appear
 * in access logs, and anyone who could reach the endpoint could make our
 * number read out arbitrary text.
 */
/**
 * A file attached to a lead — a paystub the borrower emailed over, a signed
 * disclosure, a title document.
 *
 * Content is held inline as a data URI with a hard size cap. That is a
 * deliberate interim choice, not an oversight: the alternative is a blob
 * store, which is one more credential to configure before the product does
 * anything useful. `storageRef` exists so that migration is a background job
 * over existing rows rather than a schema change. See DEPLOY.md before
 * raising MAX_DOCUMENT_BYTES.
 */
export interface LeadDocument {
  id: string;
  leadId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Data URI. Null once the file has been migrated to external storage. */
  inlineContent?: string | null;
  /** External object key, once a blob store is configured. */
  storageRef?: string;
  category: "DISCLOSURE" | "INCOME" | "PROPERTY" | "IDENTITY" | "OTHER";
  uploadedById: string;
  uploadedByName: string;
  uploadedAt: string;
  /** Set when this document was sent for signature. */
  signature?: {
    provider: string;
    envelopeId: string;
    status: "SENT" | "DELIVERED" | "SIGNED" | "DECLINED" | "VOIDED";
    sentAt: string;
    completedAt?: string;
  };
}

/**
 * An admin-editable public page (privacy policy, terms).
 *
 * Content is stored and rendered as PLAIN TEXT split into paragraphs, never
 * as HTML. These pages are edited in the admin panel and served to the public
 * internet, so treating the field as markup would turn any admin account —
 * or anyone who compromises one — into stored XSS against every visitor.
 * The formatting loss is worth it; legal copy is prose.
 *
 * Absent means "use the built-in default", so a deployment that never touches
 * this still serves a complete page.
 */
export interface LegalPage {
  slug: "privacy" | "terms";
  /** Plain text. Blank lines separate paragraphs; a line ending in ':' or
   *  written in Title Case on its own is rendered as a heading. */
  body: string;
  updatedAt: string;
  updatedByName: string;
}

export interface VoiceAnnouncement {
  id: string;
  text: string;
  createdAt: string;
  expiresAt: string;
  /** Hash of the single-use capability carried by the provider URL. */
  accessTokenHash?: string;
  /** Set once Telnyx has fetched it, so a leaked URL can't be replayed. */
  consumedAt?: string;
}

export interface IntakeDraft {
  id: string;
  /** Client-generated, stored in the borrower's localStorage — lets repeat
   *  autosaves update the same row instead of creating a new one per keystroke. */
  clientDraftId: string;
  /** Whatever subset of the intake form was filled in when this was last
   *  saved — no schema validation, since a draft is allowed to be incomplete
   *  by definition. */
  formSnapshot: Record<string, unknown>;
  furthestStep: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Soft credit pull (iSoftpull) — FCRA-gated, see core/creditGate.ts
// ---------------------------------------------------------------------------

/** The borrower's FCRA authorisation, captured at the intent gate. Stored with
 *  the exact text shown, because "what did this consumer actually agree to"
 *  is the question an auditor asks and a version number alone can't answer. */
export interface CreditPullConsent {
  id: string;
  leadId: string;
  granted: boolean;
  /** Verbatim copy of the authorisation shown on screen. */
  exactTextSnapshot: string;
  textVersion: string;
  capturedAt: string;
  /** Which interaction produced the authorisation. */
  trigger: "INTAKE_QUALIFIED" | "CHAT_PREQUAL_REQUEST" | "OFFICER_REQUEST";
  ipAddress: string;
  userAgent: string;
}

export type CreditBand = "EXCELLENT_740_PLUS" | "GOOD_680_739" | "FAIR_620_679" | "BELOW_620" | "UNSURE";

/** Result of a soft inquiry. `simulated` is true when no provider is
 *  configured — the same honesty rule every other adapter follows. */
export interface CreditPullResult {
  id: string;
  leadId: string;
  pulledAt: string;
  /** Numeric score when the bureau returned one. */
  score?: number;
  /** Score mapped onto the band the rest of the app already speaks. */
  band: CreditBand;
  bureau?: string;
  providerReferenceId?: string;
  simulated: boolean;
  /** Set when the pull failed — no score, and a reason a human can act on. */
  failureMessage?: string;
}
