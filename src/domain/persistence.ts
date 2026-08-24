// Persistence for the mock store. Two backends, chosen by DATABASE_URL:
//
// - Set (Vercel Postgres / Neon): the whole Database is serialized to JSON
//   and stored as a single row in an `mlh_store` table. This is deliberately
//   NOT a normalized relational schema — the in-memory Map-based domain
//   model (store.ts) doesn't change at all, only where its snapshot lives.
//   That's what makes this safe to land in one pass: every call site still
//   calls getDb()/saveDb() exactly as before.
// - Unset (local dev): JSON snapshot on local disk, as before — survives
//   dev-server restarts, not meant to survive a real deployment.
//
// A real deployment can later swap this module's internals for a properly
// normalized Prisma/Postgres schema (see SPEC.md section 4) — store.ts call
// sites never change either way.

import fs from "node:fs";
import path from "node:path";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { Pool } from "pg";
import { capabilities, env } from "@/lib/env";
import type { Database } from "@/domain/store";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

const MAP_KEYS: (keyof Database)[] = [
  "leads",
  "people",
  "disclosures",
  "suppressions",
  "tasks",
  "cadencePlans",
  "conversations",
  "leadFields",
  "officers",
  "users",
  "signals",
  "referralPartners",
  "sessions",
  "authTokens",
  "voiceAnnouncements",
  "legalPages",
  "intakeDrafts",
  "credentials",
  "leadContextSnapshots",
  "qualificationProgress",
  "qualificationDecisions",
  "transferAttempts",
  "callbackAppointments",
  "redditConnections",
  "redditPublications",
  "integrationHealth",
  "dialingSessions",
  "dialingQueueItems",
];

function toSerializable(db: Database): Record<string, unknown> {
  const serializable: Record<string, unknown> = { ...db };
  for (const key of MAP_KEYS) {
    serializable[key as string] = Array.from((db as unknown as Record<string, Map<string, unknown>>)[key as string].entries());
  }
  return serializable;
}

/**
 * Snapshot persistence is a temporary compatibility layer while normalized
 * repositories are rolled out. A serverless instance must never replace the
 * complete CRM with the stale copy it happened to load. Track the exact
 * snapshot this instance loaded and apply only its changed records onto the
 * newest database row.
 *
 * Durable CRM collections are append/update-only here. An absent item in a
 * stale process is not treated as a deletion. Explicit retention workflows
 * must use normalized, audited operations instead of relying on omission from
 * a JSON snapshot.
 */
let baselineSnapshot: Record<string, unknown> | null = null;

const EPHEMERAL_DELETE_MAP_KEYS = new Set<keyof Database>([
  "sessions",
  "authTokens",
  "intakeDrafts",
  "voiceAnnouncements",
]);

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeSerializedSnapshots(
  baseline: Record<string, unknown> | null,
  current: Record<string, unknown>,
  latest: Record<string, unknown>
): Record<string, unknown> {
  const merged = structuredClone(latest);
  const mapNames = new Set<string>(MAP_KEYS as string[]);
  const arrayNames = new Set<string>(ARRAY_KEYS as string[]);

  for (const key of Object.keys(current)) {
    if (mapNames.has(key)) {
      const baseEntries = new Map((baseline?.[key] as [string, unknown][] | undefined) ?? []);
      const currentEntries = new Map((current[key] as [string, unknown][] | undefined) ?? []);
      const latestEntries = new Map((latest[key] as [string, unknown][] | undefined) ?? []);
      for (const [id, value] of currentEntries) {
        if (!baseEntries.has(id) || !sameValue(baseEntries.get(id), value)) latestEntries.set(id, value);
      }
      if (EPHEMERAL_DELETE_MAP_KEYS.has(key as keyof Database)) {
        for (const id of baseEntries.keys()) if (!currentEntries.has(id)) latestEntries.delete(id);
      }
      merged[key] = Array.from(latestEntries.entries());
      continue;
    }

    if (arrayNames.has(key)) {
      const baseItems = (baseline?.[key] as Array<Record<string, unknown>> | undefined) ?? [];
      const currentItems = (current[key] as Array<Record<string, unknown>> | undefined) ?? [];
      const latestItems = (latest[key] as Array<Record<string, unknown>> | undefined) ?? [];
      const baseById = new Map(baseItems.filter((item) => typeof item?.id === "string").map((item) => [String(item.id), item]));
      const latestById = new Map(latestItems.filter((item) => typeof item?.id === "string").map((item) => [String(item.id), item]));
      const unkeyed = latestItems.filter((item) => typeof item?.id !== "string");
      for (const item of currentItems) {
        if (typeof item?.id !== "string") continue;
        const id = String(item.id);
        if (!baseById.has(id) || !sameValue(baseById.get(id), item)) latestById.set(id, item);
      }
      merged[key] = [...latestById.values(), ...unkeyed];
      continue;
    }

    if (!baseline || !sameValue(baseline[key], current[key])) merged[key] = current[key];
  }
  return merged;
}

function replaceDatabaseContents(target: Database, serialized: Record<string, unknown>): void {
  const source = fromSerializable(serialized);
  for (const key of Object.keys(source) as (keyof Database)[]) {
    (target as unknown as Record<string, unknown>)[key as string] = source[key] as unknown;
  }
}

// Array-valued collections. Listed explicitly for the same reason MAP_KEYS is:
// a snapshot written before a collection existed has no key for it, and
// `db.newThing.push(...)` on undefined throws at runtime — long after the
// deploy that introduced it. Defaulting them here makes adding a collection
// backward-compatible with every snapshot already in the database.
const ARRAY_KEYS: (keyof Database)[] = [
  "attempts",
  "notes",
  "events",
  "fieldCandidates",
  "policyDecisions",
  "consents",
  "auditLogs",
  "creditConsents",
  "creditPulls",
  "leadDocuments",
  "inboundCallTriage",
  "exportRecords",
];

function fromSerializable(parsed: Record<string, unknown>): Database {
  const db = { ...parsed } as unknown as Database;
  for (const key of MAP_KEYS) {
    const entries = (parsed as Record<string, [string, unknown][]>)[key as string] ?? [];
    (db as unknown as Record<string, Map<string, unknown>>)[key as string] = new Map(entries);
  }
  for (const key of ARRAY_KEYS) {
    const target = db as unknown as Record<string, unknown[]>;
    if (!Array.isArray(target[key as string])) target[key as string] = [];
  }
  return db;
}

// --- Postgres ------------------------------------------------------------
//
// Neon exposes an HTTP query endpoint, so it uses its serverless driver. A
// Supabase connection strings use regular Postgres over its pooler, so they
// use the standard Node Postgres client. Picking the driver from the hostname keeps the single
// DATABASE_URL contract while supporting both hosted databases safely.

let sqlClient: NeonQueryFunction<false, false> | null = null;
let postgresPool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function usesNeonDriver() {
  return new URL(env.DATABASE_URL!).hostname.endsWith(".neon.tech");
}

function getNeonSql() {
  if (!sqlClient) {
    sqlClient = neon(env.DATABASE_URL!);
  }
  return sqlClient;
}

function getPostgresPool() {
  if (!postgresPool) {
    const databaseUrl = new URL(env.DATABASE_URL!);
    const isSupabase = databaseUrl.hostname.endsWith(".supabase.com");
    const supabaseCa = env.SUPABASE_CA_CERT?.replace(/\\n/g, "\n");
    const databaseCa = env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");

    if (isSupabase && !supabaseCa) {
      throw new Error("[persistence] SUPABASE_CA_CERT is required for verified Supabase TLS in production.");
    }

    // node-postgres lets the URL's sslmode override the explicit SSL options.
    // Remove it so the Supabase root CA below is always used for certificate
    // and hostname verification.
    databaseUrl.searchParams.delete("sslmode");
    postgresPool = new Pool({
      connectionString: databaseUrl.toString(),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      max: 1,
      ssl: { ...(isSupabase ? { ca: supabaseCa } : databaseCa ? { ca: databaseCa } : {}), rejectUnauthorized: true },
    });
  }
  return postgresPool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (usesNeonDriver()
      ? Promise.resolve(
          getNeonSql()`
            CREATE TABLE IF NOT EXISTS mlh_store (
              key TEXT PRIMARY KEY,
              value JSONB NOT NULL,
              revision BIGINT NOT NULL DEFAULT 0,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `
        )
      : getPostgresPool().query(`
          CREATE TABLE IF NOT EXISTS mlh_store (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            revision BIGINT NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `))
      .then(async () => {
        if (usesNeonDriver()) {
          await getNeonSql()`ALTER TABLE mlh_store ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0`;
        } else {
          await getPostgresPool().query("ALTER TABLE mlh_store ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0");
        }
      })
      .catch((err) => {
        // Don't cache a rejected promise forever — a transient failure here
        // would otherwise permanently brick every load/save on this warm
        // instance until it's redeployed.
        schemaReady = null;
        throw err;
      });
  }
  await schemaReady;
}

// Deliberately does NOT catch here. A real connection/query error must not
// be confused with "no row yet" (rows.length === 0, the genuine first-boot
// case) — the two used to be conflated by a blanket try/catch, which meant a
// transient Postgres error looked identical to an empty database and
// getDb() would seed fresh over it, silently discarding every real lead.
// Letting the error propagate means the request fails loudly instead.
/**
 * The `updated_at` of the stored snapshot, without transferring it.
 *
 * The whole database is one JSONB row cached per serverless instance and, until
 * now, never re-read. Two instances therefore served two different pasts: the
 * one that placed a call saw it, the one that booted earlier did not. A board
 * polling every few seconds hit them alternately, so a live call appeared,
 * vanished, and reappeared depending purely on which instance answered.
 *
 * This is the cheap check that lets an instance notice it is behind — a single
 * timestamp, not the document.
 */
export async function fetchStoreVersion(): Promise<string | null> {
  if (!capabilities.hasDatabase) return null;
  try {
    await ensureSchema();
    const rows = usesNeonDriver()
      ? await getNeonSql()`SELECT updated_at FROM mlh_store WHERE key = 'main' LIMIT 1`
      : (await getPostgresPool().query<{ updated_at: Date }>("SELECT updated_at FROM mlh_store WHERE key = 'main' LIMIT 1")).rows;
    if (rows.length === 0) return null;
    const v = (rows[0] as { updated_at: Date | string }).updated_at;
    return v instanceof Date ? v.toISOString() : String(v);
  } catch {
    // Unreachable database: report "unknown" rather than "unchanged", so the
    // caller holds its current copy instead of concluding it is fresh.
    return null;
  }
}

async function loadFromPostgres(): Promise<Database | null> {
  await ensureSchema();
  const rows = usesNeonDriver()
    ? await getNeonSql()`SELECT value, updated_at, revision FROM mlh_store WHERE key = 'main' LIMIT 1`
    : (await getPostgresPool().query<{ value: Record<string, unknown>; updated_at: Date; revision: string }>("SELECT value, updated_at, revision FROM mlh_store WHERE key = 'main' LIMIT 1")).rows;
  if (rows.length === 0) return null;
  const row = rows[0] as { value: Record<string, unknown>; updated_at?: Date | string; revision?: string | number };
  if (row.updated_at) {
    setLastKnownVersion(row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at));
  }
  baselineSnapshot = structuredClone(row.value);
  return fromSerializable(row.value);
}

async function saveToPostgres(db: Database) {
  await ensureSchema();
  const currentValue = toSerializable(db);
  // RETURNING the new timestamp keeps this instance's idea of the stored
  // version aligned with what it just wrote. Without it, an instance would
  // immediately consider its own write "someone else's change" and reload the
  // document it had just produced.
  if (usesNeonDriver()) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const latestRows = await getNeonSql()`SELECT value, revision FROM mlh_store WHERE key='main' LIMIT 1`;
      const latest = (latestRows as { value: Record<string, unknown>; revision: string | number }[])[0];
      const merged = latest ? mergeSerializedSnapshots(baselineSnapshot, currentValue, latest.value) : currentValue;
      const rows = latest
        ? await getNeonSql()`
            UPDATE mlh_store SET value=${JSON.stringify(merged)}::jsonb, revision=revision+1, updated_at=now()
            WHERE key='main' AND revision=${Number(latest.revision)} RETURNING updated_at, revision
          `
        : await getNeonSql()`
            INSERT INTO mlh_store (key, value, revision, updated_at)
            VALUES ('main', ${JSON.stringify(merged)}::jsonb, 1, now())
            ON CONFLICT (key) DO NOTHING RETURNING updated_at, revision
          `;
      const row = (rows as { updated_at: Date | string; revision: string | number }[])[0];
      if (!row) continue;
      baselineSnapshot = structuredClone(merged);
      replaceDatabaseContents(db, merged);
      const v = row.updated_at;
      if (v) setLastKnownVersion(v instanceof Date ? v.toISOString() : String(v));
      return;
    }
    throw new Error("[persistence] concurrent snapshot merge could not commit after four attempts");
  } else {
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const latestResult = await client.query<{ value: Record<string, unknown>; revision: string }>(
        "SELECT value, revision FROM mlh_store WHERE key=$1 FOR UPDATE",
        ["main"]
      );
      const latest = latestResult.rows[0];
      const merged = latest ? mergeSerializedSnapshots(baselineSnapshot, currentValue, latest.value) : currentValue;
      const result = latest
        ? await client.query<{ updated_at: Date; revision: string }>(
            "UPDATE mlh_store SET value=$2::jsonb, revision=revision+1, updated_at=now() WHERE key=$1 RETURNING updated_at, revision",
            ["main", JSON.stringify(merged)]
          )
        : await client.query<{ updated_at: Date; revision: string }>(
            "INSERT INTO mlh_store (key, value, revision, updated_at) VALUES ($1, $2::jsonb, 1, now()) RETURNING updated_at, revision",
            ["main", JSON.stringify(merged)]
          );
      await client.query("COMMIT");
      const row = result.rows[0]!;
      baselineSnapshot = structuredClone(merged);
      replaceDatabaseContents(db, merged);
      setLastKnownVersion(row.updated_at.toISOString());
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

// --- Local file (dev fallback) ------------------------------------------

function loadFromFile(): Database | null {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    baselineSnapshot = structuredClone(parsed);
    return fromSerializable(parsed);
  } catch (err) {
    console.error("[persistence] failed to load db.json, starting fresh:", err);
    return null;
  }
}

async function saveToFile(db: Database) {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmpFile = `${DATA_FILE}.tmp-${process.pid}`;
    await fs.promises.writeFile(tmpFile, JSON.stringify(toSerializable(db)), "utf-8");
    await fs.promises.rename(tmpFile, DATA_FILE);
    baselineSnapshot = structuredClone(toSerializable(db));
  } catch (err) {
    console.error("[persistence] failed to save db.json:", err);
  }
}

// --- Public API ------------------------------------------------------------

export async function loadDb(): Promise<Database | null> {
  return capabilities.hasDatabase ? loadFromPostgres() : loadFromFile();
}

let writeChain: Promise<void> = Promise.resolve();

/** Call after any mutation so the change survives a server restart / cold start. */
/**
 * Reloads the in-memory store if another instance has written since we loaded.
 *
 * Costs one `SELECT updated_at` — a timestamp, not the document — so it is
 * cheap enough to run before a volatile read. Returns the fresh Database when
 * a reload happened, or null when the cached copy is already current.
 *
 * Only ever pulls FORWARD. If the version check fails (database unreachable),
 * the caller keeps its existing copy rather than being handed nothing.
 */
let lastCheckedAt = 0;

/**
 * How long a freshness check is trusted before we ask again.
 *
 * A single page render can call this several times (the call board reads call
 * activity twice), and several viewers poll concurrently. Without a short
 * floor each of those becomes its own round trip for an answer that cannot
 * have changed meaningfully in the interim. One second is well below the
 * three-second poll interval, so the board never serves anything older than
 * one tick.
 */
const VERSION_CHECK_TTL_MS = 1000;

export async function reloadIfStale(): Promise<Database | null> {
  if (!capabilities.hasDatabase) return null;

  const now = Date.now();
  if (now - lastCheckedAt < VERSION_CHECK_TTL_MS) return null;
  lastCheckedAt = now;

  const current = await fetchStoreVersion();
  if (!current) return null;               // unknown — hold what we have
  if (current === lastKnownVersion) return null; // already current
  const fresh = await loadFromPostgres();  // also updates lastKnownVersion
  return fresh;
}

/** Set after every successful write and every load, so an instance can tell
 *  whether the stored snapshot has moved on without it. */
let lastKnownVersion: string | null = null;

export function getLastKnownVersion(): string | null {
  return lastKnownVersion;
}

export function setLastKnownVersion(v: string | null): void {
  lastKnownVersion = v;
}

export function persist(db: Database): Promise<void> {
  const writeNow = capabilities.hasDatabase ? saveToPostgres : saveToFile;
  const next = writeChain.catch(() => undefined).then(() => writeNow(db));
  writeChain = next.catch((error) => {
    console.error("[persistence] mutation was not persisted:", error);
  });
  return next;
}
