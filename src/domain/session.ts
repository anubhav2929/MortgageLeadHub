// Real session management — an opaque random token stored server-side in
// db.sessions, with only the token itself (not a user id, not a JWT) in an
// httpOnly cookie. No signing secret needed: validity is checked against the
// DB on every read, so a stolen cookie value is useless once the session row
// is deleted (logout, deactivation, expiry).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createHash } from "node:crypto";
import { generateToken } from "@/core/auth";
import { getDb, saveDb } from "@/domain/store";
import { hasSqlDatabase, sqlQuery } from "@/domain/sql";
import type { User } from "@/domain/types";

const SESSION_COOKIE = "mlh_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_IDLE_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function userFromRow(row: {
  id: string;
  email_normalized: string;
  role: User["role"];
  officer_id: string | null;
  active: boolean;
  data: Partial<User> | null;
  created_at: Date | string;
}): User {
  return {
    ...(row.data ?? {}),
    id: row.id,
    name: row.data?.name || "Equity Flow Group User",
    email: row.email_normalized,
    role: row.role,
    officerId: row.officer_id ?? undefined,
    isActive: row.active,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/** Returns the logged-in user, or null — never redirects. For pages (like
 *  /login) that need to branch on auth state without forcing navigation. */
export async function getOptionalUser(): Promise<User | null> {
  // Login/session state is inherently request-specific. This boundary also
  // prevents Next from opening a production database connection while it
  // prerenders /login during `next build`.
  await connection();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  if (hasSqlDatabase()) {
    try {
      const rows = await sqlQuery<{
        id: string; email_normalized: string; role: User["role"]; officer_id: string | null;
        active: boolean; data: Partial<User> | null; created_at: Date | string;
        expires_at: Date | string; idle_expires_at: Date | string | null; last_seen_at: Date | string | null;
      }>(
        `SELECT u.id, u.email_normalized, u.role, u.officer_id, u.active, u.data, u.created_at,
                s.expires_at, s.idle_expires_at, s.last_seen_at
         FROM auth_sessions s JOIN app_users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL LIMIT 1`,
        [tokenHash(token)]
      );
      const row = rows[0];
      const now = Date.now();
      const expired = !row || new Date(row.expires_at).getTime() < now ||
        (row.idle_expires_at && new Date(row.idle_expires_at).getTime() < now);
      if (expired || !row.active) return null;
      const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
      if (now - lastSeen >= SESSION_TOUCH_INTERVAL_MS) {
        // Session touching is housekeeping, never a reason to fail a page.
        void sqlQuery(
          "UPDATE auth_sessions SET last_seen_at=now(), idle_expires_at=now() + interval '8 hours' WHERE token_hash=$1 AND revoked_at IS NULL",
          [tokenHash(token)]
        ).catch((error) => console.error("[session] touch failed", error));
      }
      return userFromRow(row);
    } catch (error) {
      // A transient database timeout must not turn /login or a workspace page
      // into Next's generic 500 screen. Treat the session as unavailable for
      // this request; the cookie remains intact for a retry.
      console.error("[session] lookup failed", error);
      return null;
    }
  }

  const db = await getDb();
  const session = db.sessions.get(token);
  const now = Date.now();
  if (!session || new Date(session.expiresAt).getTime() < now || (session.idleExpiresAt && new Date(session.idleExpiresAt).getTime() < now)) {
    if (session) {
      db.sessions.delete(token);
      await saveDb();
    }
    return null;
  }

  const user = db.users.get(session.userId);
  if (!user || !user.isActive) return null;
  const lastSeen = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
  if (now - lastSeen >= SESSION_TOUCH_INTERVAL_MS) {
    session.lastSeenAt = new Date(now).toISOString();
    session.idleExpiresAt = new Date(now + SESSION_IDLE_TTL_MS).toISOString();
    await saveDb();
  }
  return user;
}

/** Returns the logged-in user, or redirects to /login. This is the sole
 *  identity source for every server action and workspace page — since
 *  redirect() works from both Server Components and Server Actions, no
 *  call site needs to handle a null user itself. */
export async function getCurrentUser(): Promise<User> {
  const user = await getOptionalUser();
  if (!user) redirect("/login");
  return user;
}

export async function createSession(userId: string) {
  const token = generateToken();
  const now = Date.now();
  if (hasSqlDatabase()) {
    await sqlQuery(
      `INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at, idle_expires_at)
       VALUES ($1,$2,now(),now() + interval '30 days',now(),now() + interval '8 hours')`,
      [tokenHash(token), userId]
    );
  } else {
    const db = await getDb();
    db.sessions.set(token, {
      token,
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      idleExpiresAt: new Date(now + SESSION_IDLE_TTL_MS).toISOString(),
    });
    await saveDb();
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    if (hasSqlDatabase()) {
      await sqlQuery("UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at, now()) WHERE token_hash=$1", [tokenHash(token)]);
    } else {
      const db = await getDb();
      db.sessions.delete(token);
      await saveDb();
    }
  }
  store.delete(SESSION_COOKIE);
}
