// Internal audit writer. This intentionally is not a Server Action module:
// other Server Actions call it as a normal server-side helper.

import { getDb, newId, nowIso } from "@/domain/store";

export async function audit(
  actorId: string,
  actorName: string,
  action: string,
  resourceType: string,
  resourceId: string,
  result: "ALLOW" | "DENY",
  metadata?: Record<string, unknown>
) {
  const db = await getDb();
  db.auditLogs.push({
    id: newId("audit"),
    actorId,
    actorName,
    action,
    resourceType,
    resourceId,
    ipAddress: "127.0.0.1",
    result,
    at: nowIso(),
    metadata,
  });
}
