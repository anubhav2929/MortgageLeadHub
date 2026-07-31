// In-memory mock data store standing in for Postgres/Prisma (SPEC.md section 4)
// during the MVP UI build. Shape mirrors the real schema 1:1 so migrating to
// Prisma later is a matter of swapping this module's internals, not the
// call sites. Attached to globalThis so it survives Next.js dev HMR reloads.

import { nanoid } from "nanoid";
import type {
  AuditLog,
  AuthToken,
  CadencePlan,
  ConsentRecord,
  ContactAttempt,
  ConversationSession,
  DiscoveredSignal,
  DisclosureVersion,
  ExportRecord,
  FieldCandidate,
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
import { loadDb, persist } from "@/domain/persistence";

export interface Database {
  leads: Map<string, Lead>;
  people: Map<string, Person>;
  consents: ConsentRecord[];
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
  killSwitch: KillSwitchState;
  users: Map<string, User>;
  signals: Map<string, DiscoveredSignal>;
  config: SystemConfig;
  referralPartners: Map<string, ReferralPartner>;
  sessions: Map<string, Session>; // keyed by token
  authTokens: Map<string, AuthToken>; // keyed by token — invite/reset links
}

declare global {
  var __mlh_db__: Database | undefined;
}

export const DEFAULT_CONFIG: SystemConfig = {
  firstContactSlaMinutes: 5,
  dailyAttemptCap: 3,
  minSpacingHours: 4,
  quietHoursStart: 8,
  quietHoursEnd: 21,
  senderName: "MortgageLeadHub Team",
  senderEmail: "leads@mortgageleadhub.demo",
  scoringWeights: { equity: 40, margin: 25, compliance: 20, behavior: 15 },
  hotLeadThreshold: 80,
};

function createEmptyDb(): Database {
  return {
    leads: new Map(),
    people: new Map(),
    consents: [],
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
    killSwitch: { isOn: false },
    users: new Map(),
    signals: new Map(),
    config: { ...DEFAULT_CONFIG },
    referralPartners: new Map(),
    sessions: new Map(),
    authTokens: new Map(),
  };
}

/** Backfills fields added after some installs already had a db.json on disk. */
function hydrateDefaults(db: Database): Database {
  if (!db.signals) db.signals = new Map();
  if (!db.config) db.config = { ...DEFAULT_CONFIG };
  if (!db.referralPartners) db.referralPartners = new Map();
  if (!db.sessions) db.sessions = new Map();
  if (!db.authTokens) db.authTokens = new Map();
  if (!db.config.senderName) db.config.senderName = DEFAULT_CONFIG.senderName;
  if (!db.config.senderEmail) db.config.senderEmail = DEFAULT_CONFIG.senderEmail;
  if (!db.config.scoringWeights) db.config.scoringWeights = { ...DEFAULT_CONFIG.scoringWeights };
  if (db.config.hotLeadThreshold === undefined) db.config.hotLeadThreshold = DEFAULT_CONFIG.hotLeadThreshold;
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
        persist(global.__mlh_db__);
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
export function saveDb() {
  if (global.__mlh_db__) persist(global.__mlh_db__);
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
