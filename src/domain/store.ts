// In-memory mock data store standing in for Postgres/Prisma (SPEC.md section 4)
// during the MVP UI build. Shape mirrors the real schema 1:1 so migrating to
// Prisma later is a matter of swapping this module's internals, not the
// call sites. Attached to globalThis so it survives Next.js dev HMR reloads.

import { nanoid } from "nanoid";
import type {
  IntegrationCredential,
  InboundCallTriage,
  AuditLog,
  AuthToken,
  CadencePlan,
  ConsentRecord,
  CreditPullConsent,
  CreditPullResult,
  ContactAttempt,
  ConversationSession,
  DiscoveredSignal,
  DisclosureVersion,
  ExportRecord,
  FieldCandidate,
  IntakeDraft,
  LeadDocument,
  LegalPage,
  VoiceAnnouncement,
  CallbackAppointment,
  LeadContextSnapshot,
  QualificationProgress,
  QualificationDecision,
  TransferAttempt,
  RedditConnection,
  RedditPublication,
  IntegrationHealthCheck,
  DialingSession,
  DialingQueueItem,
  KillSwitchState,
  Lead,
  LeadEvent,
  LeadField,
  Note,
  Officer,
  Person,
  PolicyDecision,
  ReferralPartner,
  Session,
  Suppression,
  SystemConfig,
  Task,
  User,
} from "@/domain/types";
import { seedDatabase } from "@/domain/seed";
import { loadDb, persist, reloadIfStale } from "@/domain/persistence";
import { hasSqlDatabase } from "@/domain/sql";
import { listSqlIdentities } from "@/domain/authRepository";

export interface Database {
  leads: Map<string, Lead>;
  people: Map<string, Person>;
  consents: ConsentRecord[];
  /** FCRA authorisations for soft credit pulls, and the pull results. Kept
   *  separate from `consents` because these are consumer-report
   *  authorisations under a different statute, with their own retention. */
  creditConsents: CreditPullConsent[];
  creditPulls: CreditPullResult[];
  disclosures: Map<string, DisclosureVersion>;
  suppressions: Map<string, Suppression>; // keyed by phoneE164
  events: LeadEvent[];
  attempts: ContactAttempt[];
  policyDecisions: PolicyDecision[];
  tasks: Map<string, Task>;
  cadencePlans: Map<string, CadencePlan>;
  conversations: Map<string, ConversationSession>;
  fieldCandidates: FieldCandidate[];
  leadFields: Map<string, LeadField>; // keyed by `${leadId}:${fieldPath}`
  officers: Map<string, Officer>;
  auditLogs: AuditLog[];
  exportRecords: ExportRecord[];
  notes: Note[];
  credentials: Map<string, IntegrationCredential>; // keyed by env-var name — see core/integrationRegistry.ts
  killSwitch: KillSwitchState;
  /** When the cadence engine last completed a tick. Absence or staleness is
   *  the only way to detect that the scheduler was never wired up — without
   *  it, "nothing is being contacted" looks exactly like "nothing is due". */
  lastCadenceRunAt?: string;
  users: Map<string, User>;
  signals: Map<string, DiscoveredSignal>;
  config: SystemConfig;
  referralPartners: Map<string, ReferralPartner>;
  sessions: Map<string, Session>; // keyed by token
  authTokens: Map<string, AuthToken>; // keyed by token — invite/reset links
  intakeDrafts: Map<string, IntakeDraft>; // keyed by clientDraftId — see IntakeDraft
  /** Short-lived TeXML announcement scripts, keyed by a random id. Telnyx
   *  fetches call instructions from a URL rather than accepting inline XML
   *  (unlike Twilio), so the text has to be retrievable by a second, separate
   *  HTTP request — which on serverless may hit a different instance. Hence
   *  the database rather than a module-level Map. Purged after use/expiry;
   *  see adapters/voice.ts and app/api/texml/announcement. */
  voiceAnnouncements: Map<string, VoiceAnnouncement>;
  /** Files attached to leads — see LeadDocument. */
  leadDocuments: LeadDocument[];
  /** Admin-authored overrides for the public legal pages. */
  legalPages: Map<string, LegalPage>;
  inboundCallTriage: InboundCallTriage[];
  leadContextSnapshots: Map<string, LeadContextSnapshot>;
  qualificationProgress: Map<string, QualificationProgress>; // keyed by conversation id
  qualificationDecisions: Map<string, QualificationDecision>; // keyed by conversation id
  transferAttempts: Map<string, TransferAttempt>;
  callbackAppointments: Map<string, CallbackAppointment>;
  redditConnections: Map<string, RedditConnection>;
  redditPublications: Map<string, RedditPublication>;
  integrationHealth: Map<string, IntegrationHealthCheck>;
  dialingSessions: Map<string, DialingSession>;
  dialingQueueItems: Map<string, DialingQueueItem>;
}

declare global {
  var __mlh_db__: Database | undefined;
}

export const DEFAULT_CONFIG: SystemConfig = {
  adminTimezone: "America/Los_Angeles",
  timezoneConfirmed: false,
  firstContactSlaMinutes: 5,
  dailyAttemptCap: 3,
  engagementWindowMinutes: 5,
  minSpacingHours: 4,
  quietHoursStart: 8,
  quietHoursEnd: 21,
  senderName: "Equity Flow Group Team",
  senderEmail: "leads@equityflowgroup.demo",
  scoringWeights: { equity: 40, margin: 25, compliance: 20, behavior: 15 },
  hotLeadThreshold: 80,
  showEnvironmentBanner: true,
  callbackReminderPolicy: {
    slotDurationMinutes: 30,
    bufferMinutes: 10,
    minimumLeadMinutes: 30,
    bookingHorizonDays: 14,
    reminderMinutesBefore: 15,
    confirmationTemplate: "Your callback with Equity Flow Group is booked for {{localTime}}. Reply STOP to opt out.",
    reminderTemplate: "Reminder: your Equity Flow Group callback starts in 15 minutes at {{localTime}}. Reply STOP to opt out.",
  },
  featureFlags: {
    automaticWarmTransfer: false,
    callbackScheduling: false,
    normalizedReads: false,
    redditPosting: false,
    freePropertyValuation: true,
    metaCapi: false,
    automatedPowerDialer: false,
  },
};

function createEmptyDb(): Database {
  return {
    leads: new Map(),
    people: new Map(),
    consents: [],
    creditConsents: [],
    creditPulls: [],
    disclosures: new Map(),
    suppressions: new Map(),
    events: [],
    attempts: [],
    policyDecisions: [],
    tasks: new Map(),
    cadencePlans: new Map(),
    conversations: new Map(),
    fieldCandidates: [],
    leadFields: new Map(),
    officers: new Map(),
    auditLogs: [],
    exportRecords: [],
    notes: [],
    credentials: new Map(),
    killSwitch: { isOn: false },
    users: new Map(),
    signals: new Map(),
    config: { ...DEFAULT_CONFIG },
    referralPartners: new Map(),
    sessions: new Map(),
    authTokens: new Map(),
    intakeDrafts: new Map(),
    voiceAnnouncements: new Map(),
    leadDocuments: [],
    legalPages: new Map(),
    inboundCallTriage: [],
    leadContextSnapshots: new Map(),
    qualificationProgress: new Map(),
    qualificationDecisions: new Map(),
    transferAttempts: new Map(),
    callbackAppointments: new Map(),
    redditConnections: new Map(),
    redditPublications: new Map(),
    integrationHealth: new Map(),
    dialingSessions: new Map(),
    dialingQueueItems: new Map(),
  };
}

/** Backfills fields added after some installs already had a db.json on disk. */
function hydrateDefaults(db: Database): Database {
  if (!db.signals) db.signals = new Map();
  if (!db.config) db.config = { ...DEFAULT_CONFIG };
  if (!db.referralPartners) db.referralPartners = new Map();
  if (!db.sessions) db.sessions = new Map();
  if (!db.authTokens) db.authTokens = new Map();
  if (!db.intakeDrafts) db.intakeDrafts = new Map();
  if (!db.credentials) db.credentials = new Map();
  if (!db.inboundCallTriage) db.inboundCallTriage = [];
  if (!db.leadContextSnapshots) db.leadContextSnapshots = new Map();
  if (!db.qualificationProgress) db.qualificationProgress = new Map();
  if (!db.qualificationDecisions) db.qualificationDecisions = new Map();
  if (!db.transferAttempts) db.transferAttempts = new Map();
  if (!db.callbackAppointments) db.callbackAppointments = new Map();
  if (!db.redditConnections) db.redditConnections = new Map();
  if (!db.redditPublications) db.redditPublications = new Map();
  if (!db.integrationHealth) db.integrationHealth = new Map();
  if (!db.dialingSessions) db.dialingSessions = new Map();
  if (!db.dialingQueueItems) db.dialingQueueItems = new Map();
  if (!db.config.senderName) db.config.senderName = DEFAULT_CONFIG.senderName;
  if (!db.config.senderEmail) db.config.senderEmail = DEFAULT_CONFIG.senderEmail;
  if (!db.config.scoringWeights) db.config.scoringWeights = { ...DEFAULT_CONFIG.scoringWeights };
  if (!db.config.adminTimezone) db.config.adminTimezone = DEFAULT_CONFIG.adminTimezone;
  if (db.config.timezoneConfirmed === undefined) db.config.timezoneConfirmed = false;
  if (db.config.hotLeadThreshold === undefined) db.config.hotLeadThreshold = DEFAULT_CONFIG.hotLeadThreshold;
  if (!db.config.callbackReminderPolicy) db.config.callbackReminderPolicy = { ...DEFAULT_CONFIG.callbackReminderPolicy! };
  db.config.featureFlags = { ...DEFAULT_CONFIG.featureFlags, ...(db.config.featureFlags ?? {}) };
  return db;
}

let loading: Promise<Database> | null = null;

/**
 * Async because the Postgres backend (see persistence.ts) needs a real
 * network round-trip on first access per warm instance — everything after
 * that first load is served from the in-memory globalThis cache, same as
 * the file-backed dev store always has been.
 */
export async function getDb(): Promise<Database> {
  if (global.__mlh_db__) return global.__mlh_db__;
  if (!loading) {
    loading = (async () => {
      const fromDisk = await loadDb();
      if (fromDisk) {
        global.__mlh_db__ = hydrateDefaults(fromDisk);
      } else {
        global.__mlh_db__ = createEmptyDb();
        seedDatabase(global.__mlh_db__);
        await persist(global.__mlh_db__);
      }
      if (hasSqlDatabase()) {
        for (const user of await listSqlIdentities()) global.__mlh_db__.users.set(user.id, user);
      }
      return global.__mlh_db__;
    })().catch((err) => {
      // Don't cache a rejected promise forever — a transient Postgres error
      // (network blip, cold-start race) should be retryable on the very next
      // request, not permanently treated as "this instance can never load
      // the database again" until it's redeployed.
      loading = null;
      throw err;
    });
  }
  return loading;
}

export function resetDb(): Database {
  global.__mlh_db__ = createEmptyDb();
  seedDatabase(global.__mlh_db__);
  persist(global.__mlh_db__);
  return global.__mlh_db__;
}

/** Call after any mutation so the change survives a server restart. */
/**
 * Ensures this instance is not serving a stale snapshot.
 *
 * The whole database is one row cached on globalThis and, until now, never
 * re-read. On a horizontally-scaled host that meant every instance served the
 * past it happened to boot into: the instance that placed a call could see it,
 * one that booted a minute earlier could not. A board polling every few
 * seconds hit them alternately, so a live call appeared, vanished, and
 * reappeared purely according to which instance answered.
 *
 * Call this before reading anything that changes second-to-second. It is a
 * single timestamp comparison, and reloads only when another writer has moved
 * the store on.
 */
export async function refreshDb(options: { force?: boolean } = {}): Promise<Database> {
  const db = await getDb();
  try {
    const fresh = await reloadIfStale(options);
    if (fresh) {
      global.__mlh_db__ = fresh;
      return fresh;
    }
  } catch {
    // A failed freshness check must never take the store away — serving a
    // slightly old copy beats serving none.
  }
  return db;
}

export function saveDb(): Promise<void> {
  return global.__mlh_db__ ? persist(global.__mlh_db__) : Promise.resolve();
}

export function newId(prefix: string) {
  return `${prefix}_${nanoid(10)}`;
}

const leadLocks = new Map<string, Promise<void>>();

/**
 * Serializes access per lead id. PolicyGate's attempt-cap/spacing checks are
 * check-then-act: they count existing attempts, then (after an `await` to
 * the outreach provider) a new attempt record is pushed. Two concurrent
 * calls for the SAME lead — the hourly cadence tick overlapping a borrower
 * clicking "Text me", say — can both read the same stale count and both
 * send, silently blowing through the cap. Only concurrent calls for the
 * SAME lead ever wait on each other; every other lead proceeds immediately.
 *
 * Map entries are never deleted — bounded by the number of distinct leads
 * ever locked in this process's lifetime, which is small for this app's
 * scale, and simpler/safer than getting queue-tail cleanup right.
 */
export async function withLeadLock<T>(leadId: string, fn: () => Promise<T>): Promise<T> {
  const previous = leadLocks.get(leadId) ?? Promise.resolve();
  let releaseNext: () => void;
  const current = new Promise<void>((resolve) => {
    releaseNext = resolve;
  });
  leadLocks.set(leadId, previous.then(() => current));

  await previous;
  try {
    return await fn();
  } finally {
    releaseNext!();
  }
}

export function nowIso() {
  return new Date().toISOString();
}
