// Uptime-monitor target. Actually touches the database (not just "did the
// process boot") — the homepage renders fine even when Postgres is down,
// since every page catches its own data errors independently; this is the
// one endpoint whose whole job is to fail when the data layer is broken.

import { NextResponse } from "next/server";
import { getDb } from "@/domain/store";

export async function GET() {
  try {
    const db = await getDb();
    return NextResponse.json({ ok: true, leadCount: db.leads.size }, { status: 200 });
  } catch (err) {
    console.error("[health] database check failed:", err);
    return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });
  }
}
