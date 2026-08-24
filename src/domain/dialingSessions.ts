import { deliverOutreach } from "@/domain/actions";
import { audit } from "@/domain/audit";
import { callItemHasSettled, nextPendingDialItem } from "@/core/dialingQueue";
import { getDb, nowIso, refreshDb, saveDb } from "@/domain/store";
import type { Database, } from "@/domain/store";
import type { DialingQueueItem, DialingSession } from "@/domain/types";
import { hasSqlDatabase, withAdvisoryLease } from "@/domain/sql";

function sessionItems(db: Database, sessionId: string): DialingQueueItem[] {
  return Array.from(db.dialingQueueItems.values()).filter((item) => item.sessionId === sessionId);
}

export function reconcileDialingSession(db: Database, session: DialingSession): void {
  if (!session.currentItemId) return;
  const item = db.dialingQueueItems.get(session.currentItemId);
  if (!item || item.status !== "CALLING") {
    session.currentItemId = undefined;
    return;
  }
  const attempt = item.attemptId ? db.attempts.find((candidate) => candidate.id === item.attemptId) : undefined;
  const conversation = item.conversationId
    ? db.conversations.get(item.conversationId)
    : attempt ? Array.from(db.conversations.values()).find((candidate) => candidate.contactAttemptId === attempt.id) : undefined;
  if (!callItemHasSettled(attempt?.outcome, conversation?.callStatus)) return;
  item.status = attempt?.outcome === "FAILED" ? "FAILED" : attempt?.outcome === "BLOCKED" ? "BLOCKED" : "COMPLETED";
  item.reason = attempt?.failureMessage ?? attempt?.blockedReason;
  item.completedAt = nowIso();
  session.currentItemId = undefined;
  session.updatedAt = nowIso();
}

async function runAutomatedDialingSessions(limit: number) {
  const db = await refreshDb();
  const summary = { inspected: 0, started: 0, settled: 0, blocked: 0, failed: 0 };
  const sessions = Array.from(db.dialingSessions.values())
    .filter((session) => session.mode === "AUTO_SEQUENTIAL" && session.status === "ACTIVE")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);

  if (db.config.featureFlags?.automatedPowerDialer !== true) return summary;

  for (const session of sessions) {
    summary.inspected += 1;
    const before = session.currentItemId;
    reconcileDialingSession(db, session);
    if (before && !session.currentItemId) summary.settled += 1;
    if (session.currentItemId) continue;

    // Automation is intentionally concurrency-one across all power-dial
    // sessions. Cadence calls may still run independently, but lead-level
    // preflight prevents double dialing the same borrower.
    if (Array.from(db.dialingQueueItems.values()).some((item) => item.status === "CALLING")) break;

    const items = sessionItems(db, session.id);
    const next = nextPendingDialItem(session, items);
    if (!next) {
      session.status = "COMPLETED";
      session.completedAt = nowIso();
      session.updatedAt = nowIso();
      continue;
    }
    const lead = db.leads.get(next.leadId);
    if (!lead) {
      next.status = "FAILED";
      next.reason = "Lead no longer exists";
      next.completedAt = nowIso();
      summary.failed += 1;
      continue;
    }

    const beforeIds = new Set(db.attempts.map((attempt) => attempt.id));
    const result = await deliverOutreach(db, lead, "VOICE", "SYSTEM", `power_dialer:${session.id}`);
    const attempt = [...db.attempts].reverse().find((candidate) => candidate.leadId === lead.id && candidate.channel === "VOICE" && !beforeIds.has(candidate.id));
    next.attemptId = attempt?.id;
    next.conversationId = attempt ? Array.from(db.conversations.values()).find((candidate) => candidate.contactAttemptId === attempt.id)?.id : undefined;
    next.startedAt = nowIso();
    if (result.ok && attempt) {
      next.status = "CALLING";
      session.currentItemId = next.id;
      summary.started += 1;
    } else {
      next.status = result.blocked ? "BLOCKED" : "FAILED";
      next.reason = result.message;
      next.completedAt = nowIso();
      if (result.blocked) summary.blocked += 1;
      else summary.failed += 1;
    }
    session.updatedAt = nowIso();
    await audit("system", "Automated power dialer", "POWER_DIAL_ADVANCED", "DialingSession", session.id, "ALLOW", { itemId: next.id, leadId: lead.id, result: next.status });
    await saveDb();
  }
  await saveDb();
  return summary;
}

export async function processAutomatedDialingSessions(limit = 5) {
  if (!hasSqlDatabase()) return runAutomatedDialingSessions(limit);
  const execution = await withAdvisoryLease(
    "mortgage-lead-hub:automated-dialer",
    () => runAutomatedDialingSessions(limit)
  );
  return execution.value ?? { inspected: 0, started: 0, settled: 0, blocked: 0, failed: 0 };
}

export async function refreshDialingSessions(): Promise<void> {
  const db = await getDb();
  for (const session of db.dialingSessions.values()) reconcileDialingSession(db, session);
  await saveDb();
}
