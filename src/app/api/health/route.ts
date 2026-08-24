// Uptime-monitor target. Actually touches the database (not just "did the
// process boot") — the homepage renders fine even when Postgres is down,
// since every page catches its own data errors independently; this is the
// one endpoint whose whole job is to fail when the data layer is broken.

import { NextResponse } from "next/server";
import { getDb } from "@/domain/store";
import { hasSqlDatabase, sqlQuery } from "@/domain/sql";

export async function GET() {
  try {
    if (!hasSqlDatabase()) {
      return NextResponse.json({ ok: false, error: "persistent database is not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const [database, queue, migrations] = await Promise.all([
      sqlQuery<{ revision: string }>("SELECT revision::text FROM mlh_store WHERE key='main' LIMIT 1"),
      sqlQuery<{ pending: string }>("SELECT count(*)::text AS pending FROM outbox_jobs WHERE status IN ('PENDING','RETRY','PROCESSING')"),
      sqlQuery<{ version: string }>("SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"),
    ]);
    await getDb();
    if (!database[0] || !migrations[0]) throw new Error("database foundation is incomplete");
    return NextResponse.json(
      { ok: true, database: "reachable", snapshotRevision: Number(database[0].revision), latestMigration: migrations[0].version, pendingJobs: Number(queue[0]?.pending ?? 0) },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[health] database check failed:", err);
    return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });
  }
}
