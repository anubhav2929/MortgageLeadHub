// Internal audit writer. This intentionally is not a Server Action module:
// other Server Actions call it as a normal server-side helper.

import { getDb, newId, nowIso } from "@/domain/store";
import { hasSqlDatabase, sqlQuery } from "@/domain/sql";
import { getRequestContext } from "@/lib/requestContext";

export async function audit(
  actorId: string,
  actorName: string,
  action: string,
  resourceType: string,
  resourceId: string,
  result: "ALLOW" | "DENY",
  metadata?: Record<string, unknown>
) {
  const context = await getRequestContext();
  const id = newId("audit");
  const at = nowIso();
  const fullMetadata = { correlationId: context.correlationId, ...(metadata ?? {}) };
  if (hasSqlDatabase()) {
    await sqlQuery(
      `INSERT INTO audit_logs (id, actor_id, actor_name, action, resource_type, resource_id, result, ip_address, correlation_id, metadata, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) ON CONFLICT (id) DO NOTHING`,
      [id, actorId, actorName, action, resourceType, resourceId, result, context.ipAddress, context.correlationId, JSON.stringify(fullMetadata), at]
    );
    return;
  }
  const db = await getDb();
  db.auditLogs.push({
    id,
    actorId,
    actorName,
    action,
    resourceType,
    resourceId,
    ipAddress: context.ipAddress,
    result,
    at,
    metadata: fullMetadata,
  });
}
