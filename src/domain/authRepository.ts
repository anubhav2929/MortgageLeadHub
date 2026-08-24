import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ensureOperationalSchema, hasSqlDatabase, sqlQuery, withSqlTransaction } from "@/domain/sql";
import type { User } from "@/domain/types";

export type AuthTokenPurpose = "invite" | "reset";

interface IdentityRow {
  id: string;
  email_normalized: string;
  role: User["role"];
  officer_id: string | null;
  active: boolean;
  password_hash: string | null;
  failed_login_attempts: number;
  locked_until: Date | string | null;
  data: Partial<User> | null;
  created_at: Date | string;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function identityFromRow(row: IdentityRow): User {
  return {
    ...(row.data ?? {}),
    id: row.id,
    name: row.data?.name || "Equity Flow Group User",
    email: row.email_normalized,
    role: row.role,
    officerId: row.officer_id ?? undefined,
    isActive: row.active,
    passwordHash: row.password_hash ?? undefined,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until ? new Date(row.locked_until).toISOString() : undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

function identityData(user: User): Partial<User> {
  const data: Partial<User> = { ...user };
  delete data.passwordHash;
  delete data.failedLoginAttempts;
  delete data.lockedUntil;
  return data;
}

async function insertToken(client: PoolClient, userId: string, token: string, purpose: AuthTokenPurpose, expiresAt: string): Promise<void> {
  await client.query(
    `INSERT INTO auth_action_tokens (token_hash, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, $4::timestamptz)
     ON CONFLICT (token_hash) DO NOTHING`,
    [tokenHash(token), userId, purpose, expiresAt]
  );
}

export async function createSqlIdentityWithToken(user: User, token: string, purpose: AuthTokenPurpose, expiresAt: string): Promise<void> {
  if (!hasSqlDatabase()) return;
  await ensureOperationalSchema();
  await withSqlTransaction(async (client) => {
    await client.query(
      `INSERT INTO app_users (id, email_normalized, role, officer_id, active, password_hash, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
      [user.id, user.email.toLowerCase(), user.role, user.officerId ?? null, user.isActive, user.passwordHash ?? null, JSON.stringify(identityData(user)), user.createdAt]
    );
    await insertToken(client, user.id, token, purpose, expiresAt);
  });
}

export async function issueSqlIdentityToken(userId: string, token: string, purpose: AuthTokenPurpose, expiresAt: string): Promise<void> {
  if (!hasSqlDatabase()) return;
  await ensureOperationalSchema();
  await withSqlTransaction(async (client) => insertToken(client, userId, token, purpose, expiresAt));
}

export async function findSqlIdentityByEmail(email: string, activeOnly = false): Promise<User | null> {
  if (!hasSqlDatabase()) return null;
  const rows = await sqlQuery<IdentityRow>(
    `SELECT id, email_normalized, role, officer_id, active, password_hash,
            failed_login_attempts, locked_until, data, created_at
     FROM app_users WHERE email_normalized=$1 ${activeOnly ? "AND active=true" : ""} LIMIT 1`,
    [email.trim().toLowerCase()]
  );
  return rows[0] ? identityFromRow(rows[0]) : null;
}

export async function consumeSqlIdentityToken(token: string, purpose: AuthTokenPurpose, passwordHash: string): Promise<User | null> {
  if (!hasSqlDatabase()) return null;
  await ensureOperationalSchema();
  return withSqlTransaction(async (client) => {
    const rows = (await client.query<IdentityRow>(
      `SELECT u.id, u.email_normalized, u.role, u.officer_id, u.active, u.password_hash,
              u.failed_login_attempts, u.locked_until, u.data, u.created_at
       FROM auth_action_tokens t JOIN app_users u ON u.id=t.user_id
       WHERE t.token_hash=$1 AND t.purpose=$2 AND t.consumed_at IS NULL AND t.expires_at > now()
       FOR UPDATE OF t, u`,
      [tokenHash(token), purpose]
    )).rows;
    const row = rows[0];
    if (!row) return null;
    await client.query(
      "UPDATE app_users SET password_hash=$2, active=true, failed_login_attempts=0, locked_until=NULL WHERE id=$1",
      [row.id, passwordHash]
    );
    await client.query("UPDATE auth_action_tokens SET consumed_at=now() WHERE token_hash=$1", [tokenHash(token)]);
    if (purpose === "reset") await client.query("UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [row.id]);
    return identityFromRow({ ...row, active: true, password_hash: passwordHash, failed_login_attempts: 0, locked_until: null });
  });
}

export async function updateSqlIdentity(user: User, options: { revokeSessions?: boolean } = {}): Promise<void> {
  if (!hasSqlDatabase()) return;
  await withSqlTransaction(async (client) => {
    await client.query(
      `UPDATE app_users SET email_normalized=$2, role=$3, officer_id=$4, active=$5,
         password_hash=$6, failed_login_attempts=$7, locked_until=$8, data=$9::jsonb
       WHERE id=$1`,
      [
        user.id,
        user.email.toLowerCase(),
        user.role,
        user.officerId ?? null,
        user.isActive,
        user.passwordHash ?? null,
        user.failedLoginAttempts ?? 0,
        user.lockedUntil ?? null,
        JSON.stringify(identityData(user)),
      ]
    );
    if (options.revokeSessions) {
      await client.query("UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [user.id]);
    }
  });
}

export async function listSqlIdentities(): Promise<User[]> {
  if (!hasSqlDatabase()) return [];
  const rows = await sqlQuery<IdentityRow>(
    `SELECT id, email_normalized, role, officer_id, active, password_hash,
            failed_login_attempts, locked_until, data, created_at FROM app_users`
  );
  return rows.map(identityFromRow);
}
