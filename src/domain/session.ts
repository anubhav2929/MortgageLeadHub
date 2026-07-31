// Real session management — an opaque random token stored server-side in
// db.sessions, with only the token itself (not a user id, not a JWT) in an
// httpOnly cookie. No signing secret needed: validity is checked against the
// DB on every read, so a stolen cookie value is useless once the session row
// is deleted (logout, deactivation, expiry).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { generateToken } from "@/core/auth";
import { getDb, saveDb } from "@/domain/store";
import type { User } from "@/domain/types";

const SESSION_COOKIE = "mlh_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Returns the logged-in user, or null — never redirects. For pages (like
 *  /login) that need to branch on auth state without forcing navigation. */
export async function getOptionalUser(): Promise<User | null> {
  const db = await getDb();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = db.sessions.get(token);
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;

  const user = db.users.get(session.userId);
  if (!user || !user.isActive) return null;
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
  const db = await getDb();
  const token = generateToken();
  const now = Date.now();
  db.sessions.set(token, {
    token,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  });
  saveDb();

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
  const db = await getDb();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    db.sessions.delete(token);
    saveDb();
  }
  store.delete(SESSION_COOKIE);
}
