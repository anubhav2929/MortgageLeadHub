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
import postgres, { type Sql } from "postgres";
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
];

function toSerializable(db: Database): Record<string, unknown> {
  const serializable: Record<string, unknown> = { ...db };
  for (const key of MAP_KEYS) {
    serializable[key as string] = Array.from((db as unknown as Record<string, Map<string, unknown>>)[key as string].entries());
  }
  return serializable;
}

function fromSerializable(parsed: Record<string, unknown>): Database {
  const db = { ...parsed } as unknown as Database;
  for (const key of MAP_KEYS) {
    const entries = (parsed as Record<string, [string, unknown][]>)[key as string] ?? [];
    (db as unknown as Record<string, Map<string, unknown>>)[key as string] = new Map(entries);
  }
  return db;
}

// --- Postgres ------------------------------------------------------------
//
// Neon exposes an HTTP query endpoint, so it uses its serverless driver. A
// Supabase connection string is regular Postgres over its pooler, so it uses
// postgres.js instead. Picking the driver from the hostname keeps the single
// DATABASE_URL contract while supporting both hosted databases safely.

let sqlClient: import("@neondatabase/serverless").NeonQueryFunction<false, false> | null = null;
let postgresClient: Sql | null = null;
let schemaReady: Promise<void> | null = null;

function usesNeonDriver() {
  return new URL(env.DATABASE_URL!).hostname.endsWith(".neon.tech");
}

async function getNeonSql() {
  if (!sqlClient) {
    const { neon } = await import("@neondatabase/serverless");
    sqlClient = neon(env.DATABASE_URL!);
  }
  return sqlClient;
}

async function getPostgresSql() {
  if (!postgresClient) {
    postgresClient = postgres(env.DATABASE_URL!, {
      connect_timeout: 10,
      idle_timeout: 10,
      max: 1,
      prepare: false,
      ssl: "require",
    });
  }
  return postgresClient;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (usesNeonDriver()
      ? getNeonSql().then(
          (sql) => sql`
            CREATE TABLE IF NOT EXISTS mlh_store (
              key TEXT PRIMARY KEY,
              value JSONB NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `
        )
      : getPostgresSql().then(
          (sql) => sql`
            CREATE TABLE IF NOT EXISTS mlh_store (
              key TEXT PRIMARY KEY,
              value JSONB NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `
        ))
      .then(() => undefined)
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
async function loadFromPostgres(): Promise<Database | null> {
  await ensureSchema();
  const rows = usesNeonDriver()
    ? await (await getNeonSql())`SELECT value FROM mlh_store WHERE key = 'main' LIMIT 1`
    : await (await getPostgresSql())`SELECT value FROM mlh_store WHERE key = 'main' LIMIT 1`;
  if (rows.length === 0) return null;
  return fromSerializable(rows[0].value as Record<string, unknown>);
}

async function saveToPostgres(db: Database) {
  await ensureSchema();
  const value = toSerializable(db);
  if (usesNeonDriver()) {
    await (await getNeonSql())`
      INSERT INTO mlh_store (key, value, updated_at)
      VALUES ('main', ${JSON.stringify(value)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
  } else {
    await (await getPostgresSql())`
      INSERT INTO mlh_store (key, value, updated_at)
      VALUES ('main', ${JSON.stringify(value)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
  }
}

// --- Local file (dev fallback) ------------------------------------------

function loadFromFile(): Database | null {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    if (!raw.trim()) return null;
    return fromSerializable(JSON.parse(raw));
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
  } catch (err) {
    console.error("[persistence] failed to save db.json:", err);
  }
}

// --- Public API ------------------------------------------------------------

export async function loadDb(): Promise<Database | null> {
  return capabilities.hasDatabase ? loadFromPostgres() : loadFromFile();
}

let writeInFlight = false;
let writePending = false;

/** Call after any mutation so the change survives a server restart / cold start. */
export function persist(db: Database) {
  // Fire-and-forget, coalesced: if a write is already in flight when another
  // save comes in, just remember to run once more after — never queue N writes.
  if (writeInFlight) {
    writePending = true;
    return;
  }
  writeInFlight = true;
  const writeNow = capabilities.hasDatabase ? saveToPostgres : saveToFile;
  writeNow(db)
    .catch((err) => {
      // saveToFile already catches internally; this only ever fires for
      // saveToPostgres, which doesn't (unlike loadFromPostgres, a write
      // failure here is never mistaken for "no data" — there's nothing to
      // conflate it with). Must be caught: this call isn't awaited by
      // anything (persist() is fire-and-forget by design), so an uncaught
      // rejection here would otherwise crash the whole process.
      console.error("[persistence] failed to save to Postgres — this mutation was NOT persisted:", err);
    })
    .finally(() => {
      writeInFlight = false;
      if (writePending) {
        writePending = false;
        persist(db);
      }
    });
}
