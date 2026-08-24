import { privacyHash } from "@/lib/requestContext";
import { ensureOperationalSchema, hasSqlDatabase, sqlQuery } from "@/domain/sql";

const memory = new Map<string, { count: number; windowStartedAt: number }>();

export async function consumeRateLimit(input: {
  scope: string;
  subject: string;
  limit: number;
  windowSeconds: number;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const subjectHash = privacyHash(input.subject || "unknown");
  if (!hasSqlDatabase()) {
    const key = `${input.scope}:${subjectHash}`;
    const now = Date.now();
    const current = memory.get(key);
    const expired = !current || now - current.windowStartedAt >= input.windowSeconds * 1000;
    const next = expired ? { count: 1, windowStartedAt: now } : { ...current, count: current.count + 1 };
    memory.set(key, next);
    return {
      allowed: next.count <= input.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((next.windowStartedAt + input.windowSeconds * 1000 - now) / 1000)),
    };
  }

  await ensureOperationalSchema();

  const rows = await sqlQuery<{ request_count: number; retry_after: number }>(
    `INSERT INTO rate_limits (scope, subject_hash, window_started_at, request_count)
     VALUES ($1, $2, now(), 1)
     ON CONFLICT (scope, subject_hash) DO UPDATE SET
       window_started_at = CASE WHEN rate_limits.window_started_at <= now() - ($3 * interval '1 second') THEN now() ELSE rate_limits.window_started_at END,
       request_count = CASE WHEN rate_limits.window_started_at <= now() - ($3 * interval '1 second') THEN 1 ELSE rate_limits.request_count + 1 END
     RETURNING request_count,
       GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_started_at + ($3 * interval '1 second') - now()))))::int AS retry_after`,
    [input.scope, subjectHash, input.windowSeconds]
  );
  return {
    allowed: (rows[0]?.request_count ?? 1) <= input.limit,
    retryAfterSeconds: rows[0]?.retry_after ?? input.windowSeconds,
  };
}
