import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | null = null;
let operationalSchemaReady: Promise<void> | null = null;

export function hasSqlDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING);
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!value) throw new Error("DATABASE_URL is required for transactional storage.");
  return value;
}

export function getSqlPool(): Pool {
  if (!pool) {
    const url = new URL(databaseUrl());
    const isSupabase = url.hostname.endsWith(".supabase.com");
    const supabaseCa = process.env.SUPABASE_CA_CERT?.replace(/\\n/g, "\n");
    const databaseCa = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
    if (isSupabase && !supabaseCa) throw new Error("SUPABASE_CA_CERT is required for verified Supabase TLS.");
    url.searchParams.delete("sslmode");
    pool = new Pool({
      connectionString: url.toString(),
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      // Public managed Postgres certificates validate against the system
      // trust store. Private/self-managed CAs can be supplied explicitly.
      // Certificate verification is never disabled in production code.
      ssl: { ...(isSupabase ? { ca: supabaseCa } : databaseCa ? { ca: databaseCa } : {}), rejectUnauthorized: true },
    });
  }
  return pool;
}

export async function sqlQuery<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await getSqlPool().query<T>(text, values)).rows;
}

export async function ensureOperationalSchema(): Promise<void> {
  if (!operationalSchemaReady) {
    operationalSchemaReady = getSqlPool().query(`
      CREATE TABLE IF NOT EXISTS webhook_inbox (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), provider TEXT NOT NULL, provider_event_id TEXT NOT NULL,
        event_type TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'primary', payload JSONB NOT NULL,
        request_headers JSONB NOT NULL DEFAULT '{}'::jsonb, status TEXT NOT NULL DEFAULT 'PENDING',
        attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        locked_at TIMESTAMPTZ, last_error TEXT, received_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ,
        UNIQUE(provider, provider_event_id)
      );
      CREATE INDEX IF NOT EXISTS webhook_inbox_work_idx ON webhook_inbox(status, next_attempt_at, received_at);
      CREATE TABLE IF NOT EXISTS outbox_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_type TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
        aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING', attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), locked_at TIMESTAMPTZ, last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS rate_limits (
        scope TEXT NOT NULL, subject_hash TEXT NOT NULL, window_started_at TIMESTAMPTZ NOT NULL,
        request_count INTEGER NOT NULL, PRIMARY KEY (scope, subject_hash)
      );
      CREATE TABLE IF NOT EXISTS auth_action_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS auth_action_tokens_user_idx ON auth_action_tokens(user_id, purpose, expires_at DESC);
    `).then(() => undefined).catch((error) => {
      operationalSchemaReady = null;
      throw error;
    });
  }
  return operationalSchemaReady;
}

export async function withSqlTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getSqlPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withAdvisoryLease<T>(name: string, fn: () => Promise<T>): Promise<{ acquired: boolean; value?: T }> {
  const client = await getSqlPool().connect();
  try {
    const row = (await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [name])).rows[0];
    if (!row?.acquired) return { acquired: false };
    try {
      return { acquired: true, value: await fn() };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [name]);
    }
  } finally {
    client.release();
  }
}

export async function withLeadTransaction<T>(leadId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withSqlTransaction(async (client) => {
    await client.query("SELECT id FROM leads WHERE id = $1 FOR UPDATE", [leadId]);
    return fn(client);
  });
}
