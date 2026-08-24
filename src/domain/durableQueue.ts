import { createHash, randomUUID } from "node:crypto";
import { ensureOperationalSchema, hasSqlDatabase, sqlQuery, withSqlTransaction } from "@/domain/sql";

export type WebhookProvider = "TELNYX" | "VAPI" | "TWILIO" | "RESEND";
export type WebhookStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "RETRY" | "QUARANTINED" | "DEAD";

export interface WebhookEnvelope {
  id: string;
  provider: WebhookProvider;
  providerEventId: string;
  eventType: string;
  source: "primary" | "failover" | "legacy";
  payload: unknown;
  headers?: Record<string, string>;
}

const memoryInbox = new Map<string, WebhookEnvelope & { status: WebhookStatus; attemptCount: number; lastError?: string }>();

export type OutboxStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "RETRY" | "DEAD";
export interface OutboxJob {
  id: string;
  jobType: string;
  idempotencyKey: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  attemptCount: number;
}
const memoryOutbox = new Map<string, OutboxJob & { status: OutboxStatus; nextAttemptAt: string; lastError?: string }>();

export function stableWebhookId(provider: WebhookProvider, rawBody: string, supplied?: string | null): string {
  return supplied?.trim() || createHash("sha256").update(`${provider}:${rawBody}`).digest("hex");
}

export async function enqueueWebhook(input: Omit<WebhookEnvelope, "id">): Promise<{ id: string; duplicate: boolean }> {
  if (!hasSqlDatabase()) {
    const key = `${input.provider}:${input.providerEventId}`;
    const duplicate = memoryInbox.has(key);
    if (!duplicate) memoryInbox.set(key, { ...input, id: randomUUID(), status: "PENDING", attemptCount: 0 });
    return { id: memoryInbox.get(key)!.id, duplicate };
  }
  await ensureOperationalSchema();

  const rows = await sqlQuery<{ id: string }>(
    `INSERT INTO webhook_inbox (provider, provider_event_id, event_type, source, payload, request_headers)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (provider, provider_event_id) DO NOTHING
     RETURNING id::text`,
    [input.provider, input.providerEventId, input.eventType, input.source, JSON.stringify(input.payload), JSON.stringify(input.headers ?? {})]
  );
  if (rows[0]) return { id: rows[0].id, duplicate: false };
  const existing = await sqlQuery<{ id: string }>(
    "SELECT id::text FROM webhook_inbox WHERE provider = $1 AND provider_event_id = $2",
    [input.provider, input.providerEventId]
  );
  return { id: existing[0]!.id, duplicate: true };
}

/** Claims an inbox event for request-local processing. This closes the gap
 * between persistent deduplication and business processing: redeliveries do
 * not run concurrently, while a provider retry can recover a worker that
 * disappeared more than five minutes ago. */
export async function claimInlineWebhook(id: string): Promise<boolean> {
  if (!hasSqlDatabase()) {
    const item = [...memoryInbox.values()].find((candidate) => candidate.id === id);
    if (!item || item.status === "COMPLETED" || item.status === "QUARANTINED" || item.status === "DEAD" || item.status === "PROCESSING") return false;
    item.status = "PROCESSING";
    item.attemptCount += 1;
    return true;
  }
  await ensureOperationalSchema();
  const rows = await sqlQuery<{ id: string }>(
    `UPDATE webhook_inbox SET status='PROCESSING', locked_at=now(), attempt_count=attempt_count+1
     WHERE id=$1::uuid AND (
       status='PENDING'
       OR (status='RETRY' AND next_attempt_at <= now())
       OR (status='PROCESSING' AND locked_at < now() - interval '5 minutes')
     ) RETURNING id::text`,
    [id]
  );
  return rows.length === 1;
}

export async function claimWebhookBatch(limit = 20): Promise<WebhookEnvelope[]> {
  if (!hasSqlDatabase()) {
    const out: WebhookEnvelope[] = [];
    for (const item of memoryInbox.values()) {
      if ((item.status === "PENDING" || item.status === "RETRY") && out.length < limit) {
        item.status = "PROCESSING";
        item.attemptCount += 1;
        out.push(item);
      }
    }
    return out;
  }
  await ensureOperationalSchema();

  return withSqlTransaction(async (client) => {
    const rows = (await client.query<{
      id: string; provider: WebhookProvider; provider_event_id: string; event_type: string;
      source: "primary" | "failover" | "legacy"; payload: unknown; request_headers: Record<string, string>;
    }>(
      `WITH claimed AS (
         SELECT id FROM webhook_inbox
         WHERE provider <> 'VAPI' AND status IN ('PENDING', 'RETRY') AND next_attempt_at <= now()
         ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE webhook_inbox w SET status = 'PROCESSING', locked_at = now(), attempt_count = attempt_count + 1
       FROM claimed WHERE w.id = claimed.id
       RETURNING w.id::text, w.provider, w.provider_event_id, w.event_type, w.source, w.payload, w.request_headers`,
      [limit]
    )).rows;
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      providerEventId: row.provider_event_id,
      eventType: row.event_type,
      source: row.source,
      payload: row.payload,
      headers: row.request_headers,
    }));
  });
}

export async function settleWebhook(id: string, status: Exclude<WebhookStatus, "PENDING" | "PROCESSING">, error?: string): Promise<void> {
  if (!hasSqlDatabase()) {
    const item = [...memoryInbox.values()].find((candidate) => candidate.id === id);
    if (item) {
      item.status = status;
      item.lastError = error;
    }
    return;
  }
  await ensureOperationalSchema();
  const retryDelaySeconds = status === "RETRY" ? 30 : 0;
  await sqlQuery(
    `UPDATE webhook_inbox SET status = $2, last_error = $3,
       next_attempt_at = CASE WHEN $2 = 'RETRY' THEN now() + ($4 * interval '1 second') ELSE next_attempt_at END,
       processed_at = CASE WHEN $2 IN ('COMPLETED', 'QUARANTINED', 'DEAD') THEN now() ELSE processed_at END,
       locked_at = NULL WHERE id = $1::uuid`,
    [id, status, error?.slice(0, 2000) ?? null, retryDelaySeconds]
  );
}

export async function enqueueOutbox(input: {
  jobType: string; idempotencyKey: string; aggregateType: string; aggregateId: string; payload: unknown; nextAttemptAt?: string;
}): Promise<{ id: string; duplicate: boolean }> {
  if (!hasSqlDatabase()) {
    const existing = memoryOutbox.get(input.idempotencyKey);
    if (existing) return { id: existing.id, duplicate: true };
    const id = randomUUID();
    memoryOutbox.set(input.idempotencyKey, {
      ...input, id, attemptCount: 0, status: "PENDING", nextAttemptAt: input.nextAttemptAt ?? new Date().toISOString(),
    });
    return { id, duplicate: false };
  }
  await ensureOperationalSchema();
  const rows = await sqlQuery<{ id: string }>(
    `INSERT INTO outbox_jobs (job_type, idempotency_key, aggregate_type, aggregate_id, payload, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, now()))
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id::text`,
    [input.jobType, input.idempotencyKey, input.aggregateType, input.aggregateId, JSON.stringify(input.payload), input.nextAttemptAt ?? null]
  );
  return rows[0] ? { id: rows[0].id, duplicate: false } : { id: input.idempotencyKey, duplicate: true };
}

export async function enqueueOutboxBatch(inputs: Array<{
  jobType: string; idempotencyKey: string; aggregateType: string; aggregateId: string; payload: unknown; nextAttemptAt?: string;
}>): Promise<Array<{ id: string; duplicate: boolean }>> {
  if (!hasSqlDatabase()) {
    const results: Array<{ id: string; duplicate: boolean }> = [];
    for (const input of inputs) results.push(await enqueueOutbox(input));
    return results;
  }
  await ensureOperationalSchema();
  return withSqlTransaction(async (client) => {
    const results: Array<{ id: string; duplicate: boolean }> = [];
    for (const input of inputs) {
      const rows = (await client.query<{ id: string }>(
        `INSERT INTO outbox_jobs (job_type, idempotency_key, aggregate_type, aggregate_id, payload, next_attempt_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, now()))
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id::text`,
        [input.jobType, input.idempotencyKey, input.aggregateType, input.aggregateId, JSON.stringify(input.payload), input.nextAttemptAt ?? null]
      )).rows;
      results.push(rows[0] ? { id: rows[0].id, duplicate: false } : { id: input.idempotencyKey, duplicate: true });
    }
    return results;
  });
}

export async function claimOutboxBatch(limit = 20): Promise<OutboxJob[]> {
  if (!hasSqlDatabase()) {
    const now = Date.now();
    const jobs: OutboxJob[] = [];
    for (const item of memoryOutbox.values()) {
      if ((item.status === "PENDING" || item.status === "RETRY") && new Date(item.nextAttemptAt).getTime() <= now && jobs.length < limit) {
        item.status = "PROCESSING";
        item.attemptCount += 1;
        jobs.push(item);
      }
    }
    return jobs;
  }
  await ensureOperationalSchema();
  return withSqlTransaction(async (client) => {
    const rows = (await client.query<{
      id: string; job_type: string; idempotency_key: string; aggregate_type: string; aggregate_id: string; payload: unknown; attempt_count: number;
    }>(
      `WITH claimed AS (
         SELECT id FROM outbox_jobs
         WHERE (status IN ('PENDING','RETRY') AND next_attempt_at <= now())
            OR (status='PROCESSING' AND locked_at < now() - interval '10 minutes')
         ORDER BY next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE outbox_jobs o SET status='PROCESSING', locked_at=now(), attempt_count=attempt_count+1
       FROM claimed WHERE o.id=claimed.id
       RETURNING o.id::text, o.job_type, o.idempotency_key, o.aggregate_type, o.aggregate_id, o.payload, o.attempt_count`,
      [limit]
    )).rows;
    return rows.map((row) => ({
      id: row.id, jobType: row.job_type, idempotencyKey: row.idempotency_key,
      aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, payload: row.payload, attemptCount: row.attempt_count,
    }));
  });
}

export async function settleOutbox(id: string, status: "COMPLETED" | "RETRY" | "DEAD", error?: string, retryAt?: string): Promise<void> {
  if (!hasSqlDatabase()) {
    const item = [...memoryOutbox.values()].find((candidate) => candidate.id === id);
    if (item) {
      item.status = status;
      item.lastError = error;
      if (retryAt) item.nextAttemptAt = retryAt;
    }
    return;
  }
  await ensureOperationalSchema();
  await sqlQuery(
    `UPDATE outbox_jobs SET status=$2, last_error=$3, locked_at=NULL,
       next_attempt_at=CASE WHEN $2='RETRY' THEN COALESCE($4::timestamptz, now() + interval '5 minutes') ELSE next_attempt_at END,
       completed_at=CASE WHEN $2='COMPLETED' THEN now() ELSE completed_at END WHERE id=$1::uuid`,
    [id, status, error?.slice(0, 2000) ?? null, retryAt ?? null]
  );
}
