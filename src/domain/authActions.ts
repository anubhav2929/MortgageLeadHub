"use server";

// The auth boundary itself — every action here is callable by an anonymous
// visitor, unlike actions.ts (which assumes an authenticated getCurrentUser()
// throughout). Kept in its own file for that reason: this is the one place
// where "no user yet" is the normal case, not an error.

import { redirect } from "next/navigation";
import { sendEmail } from "@/adapters/email";
import { hashPassword, verifyPassword, generateToken } from "@/core/auth";
import { decryptSecret, encryptSecret, isSecretStorageEnabled } from "@/core/secretBox";
import { createRecoveryCodes, createTotpEnrollment, hashRecoveryCode, verifyTotp } from "@/core/totp";
import { validateNewPassword } from "@/core/passwordPolicy";
import { audit } from "@/domain/audit";
import { createSession, destroySession, getCurrentUser } from "@/domain/session";
import { getDb, newId, saveDb } from "@/domain/store";
import { getAppUrl } from "@/lib/runtimeConfig";
import { consumeRateLimit } from "@/domain/rateLimit";
import { hasSqlDatabase, sqlQuery } from "@/domain/sql";
import { getRequestContext } from "@/lib/requestContext";
import type { User } from "@/domain/types";
import {
  consumeSqlIdentityToken,
  findSqlIdentityByEmail,
  issueSqlIdentityToken,
  updateSqlIdentity,
} from "@/domain/authRepository";

export interface AuthResult {
  ok: boolean;
  message: string;
  mfaRequired?: boolean;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const GENERIC_LOGIN_ERROR: AuthResult = { ok: false, message: "Invalid email or password." };
type LoginAccount = {
  id: string; email_normalized: string; role: User["role"]; active: boolean;
  password_hash: string | null; failed_login_attempts: number; locked_until: Date | string | null;
  data: Partial<User> | null;
};

export async function loginAction(email: string, password: string, mfaCode?: string): Promise<AuthResult> {
  const context = await getRequestContext();
  const throttle = await consumeRateLimit({ scope: "login", subject: `${context.ipAddress}:${email}`, limit: 10, windowSeconds: 15 * 60 });
  if (!throttle.allowed) return { ok: false, message: "Too many login attempts. Try again later." };
  const normalizedEmail = email.trim().toLowerCase();
  const db = hasSqlDatabase() ? null : await getDb();
  let account: LoginAccount | null = null;
  if (hasSqlDatabase()) {
    try {
      account = (await sqlQuery<LoginAccount>(
        `SELECT id, email_normalized, role, active, password_hash, failed_login_attempts, locked_until, data
         FROM app_users WHERE email_normalized=$1 LIMIT 1`,
        [normalizedEmail]
      ))[0] ?? null;
    } catch (error) {
      console.error("[auth] account lookup failed", error);
      return { ok: false, message: "Login service is temporarily busy. Please try again." };
    }
  }
  const user: User | undefined = account ? {
    ...(account.data ?? {}), id: account.id, name: account.data?.name || "Equity Flow Group User",
    email: account.email_normalized, role: account.role, isActive: account.active,
    passwordHash: account.password_hash ?? undefined,
    failedLoginAttempts: account.failed_login_attempts,
    lockedUntil: account.locked_until ? new Date(account.locked_until).toISOString() : undefined,
  } : Array.from(db!.users.values()).find((u) => u.email.toLowerCase() === normalizedEmail);

  if (!user || !user.isActive || !user.passwordHash) return GENERIC_LOGIN_ERROR;

  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    return { ok: false, message: "Too many failed attempts. Try again in a few minutes." };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    if (account) {
      await sqlQuery(
        `UPDATE app_users SET
           locked_until=CASE WHEN failed_login_attempts + 1 >= $2 THEN now() + interval '15 minutes' ELSE locked_until END,
           failed_login_attempts=CASE WHEN failed_login_attempts + 1 >= $2 THEN 0 ELSE failed_login_attempts + 1 END
         WHERE id=$1`,
        [user.id, MAX_FAILED_ATTEMPTS]
      );
    } else {
      user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
      if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        user.lockedUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();
        user.failedLoginAttempts = 0;
      }
      await saveDb();
    }
    await audit(user.id, user.name, "LOGIN_FAILED", "User", user.id, "DENY");
    return GENERIC_LOGIN_ERROR;
  }

  if (user.mfa?.enabledAt) {
    if (!mfaCode) return { ok: false, message: "Enter the six-digit authenticator code or a recovery code.", mfaRequired: true };
    const secret = decryptSecret(user.mfa.encryptedSecret);
    const recoveryHash = hashRecoveryCode(mfaCode);
    const recoveryIndex = user.mfa.recoveryCodeHashes?.indexOf(recoveryHash) ?? -1;
    const validSecondFactor = Boolean(secret && verifyTotp(secret, mfaCode)) || recoveryIndex >= 0;
    if (!validSecondFactor) {
      await audit(user.id, user.name, "MFA_LOGIN_FAILED", "User", user.id, "DENY");
      return { ok: false, message: "Invalid verification code.", mfaRequired: true };
    }
    if (recoveryIndex >= 0) {
      user.mfa.recoveryCodeHashes!.splice(recoveryIndex, 1);
      if (hasSqlDatabase()) await updateSqlIdentity(user);
      const snapshot = await getDb();
      snapshot.users.set(user.id, user);
      await saveDb();
      await audit(user.id, user.name, "MFA_RECOVERY_CODE_USED", "User", user.id, "ALLOW");
    }
  }

  if (account) {
    await sqlQuery("UPDATE app_users SET failed_login_attempts=0, locked_until=NULL WHERE id=$1", [user.id]);
  } else {
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
    await saveDb();
  }
  await createSession(user.id);
  await audit(user.id, user.name, "LOGIN", "User", user.id, "ALLOW");
  redirect("/workspace");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function acceptInviteAction(token: string, password: string): Promise<AuthResult> {
  const passwordError = await validateNewPassword(password);
  if (passwordError) return { ok: false, message: passwordError };

  if (hasSqlDatabase()) {
    const user = await consumeSqlIdentityToken(token, "invite", await hashPassword(password));
    if (!user) return { ok: false, message: "This invite link is invalid or has expired. Ask an admin to resend it." };
    const db = await getDb();
    db.users.set(user.id, user);
    await saveDb();
    await audit(user.id, user.name, "ACCEPT_INVITE", "User", user.id, "ALLOW");
    await createSession(user.id);
    redirect("/workspace");
  }

  const db = await getDb();
  const authToken = db.authTokens.get(token);
  if (!authToken || authToken.purpose !== "invite" || new Date(authToken.expiresAt).getTime() < Date.now()) {
    return { ok: false, message: "This invite link is invalid or has expired. Ask an admin to resend it." };
  }
  const user = db.users.get(authToken.userId);
  if (!user) return { ok: false, message: "This invite link is invalid or has expired." };

  user.passwordHash = await hashPassword(password);
  user.isActive = true;
  db.authTokens.delete(token);
  await saveDb();
  await audit(user.id, user.name, "ACCEPT_INVITE", "User", user.id, "ALLOW");
  await createSession(user.id);
  redirect("/workspace");
}

export async function requestPasswordResetAction(email: string): Promise<AuthResult> {
  const context = await getRequestContext();
  const throttle = await consumeRateLimit({ scope: "password-reset", subject: `${context.ipAddress}:${email}`, limit: 5, windowSeconds: 60 * 60 });
  if (!throttle.allowed) return { ok: true, message: "If that email has an account, a reset link is on its way." };
  const normalizedEmail = email.trim().toLowerCase();
  const db = await getDb();
  const user = hasSqlDatabase()
    ? await findSqlIdentityByEmail(normalizedEmail, true)
    : Array.from(db.users.values()).find((u) => u.email.toLowerCase() === normalizedEmail && u.isActive) ?? null;

  // Same response whether or not the account exists — never reveal that.
  const response: AuthResult = { ok: true, message: "If that email has an account, a reset link is on its way." };
  if (!user) return response;

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  if (hasSqlDatabase()) {
    await issueSqlIdentityToken(user.id, token, "reset", expiresAt);
  } else {
    db.authTokens.set(token, { token, userId: user.id, purpose: "reset", expiresAt });
    await saveDb();
  }

  const resetUrl = `${await getAppUrl()}/reset-password?token=${token}`;
  const emailResult = await sendEmail({
    to: user.email,
    subject: "Reset your Equity Flow Group password",
    text: `Hi ${user.name.split(" ")[0]},\n\nReset your password:\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.\n\n— Equity Flow Group`,
    idempotencyKey: newId("idem"),
    from: `${db.config.senderName} <${db.config.senderEmail}>`,
  });
  // The response stays generic whether or not the send worked — telling the
  // caller "that email failed" would confirm the address exists, which is the
  // user-enumeration leak this endpoint is written to avoid. The operator
  // still needs to know, so the failure goes to the log and the audit trail.
  if (!emailResult.ok) {
    console.error(`[requestPasswordReset] reset email failed for user ${user.id}: ${emailResult.failure.message}`);
  }
  await audit(user.id, user.name, "REQUEST_PASSWORD_RESET", "User", user.id, "ALLOW");
  return response;
}

export async function resetPasswordAction(token: string, password: string): Promise<AuthResult> {
  const passwordError = await validateNewPassword(password);
  if (passwordError) return { ok: false, message: passwordError };

  if (hasSqlDatabase()) {
    const user = await consumeSqlIdentityToken(token, "reset", await hashPassword(password));
    if (!user) return { ok: false, message: "This reset link is invalid or has expired." };
    const db = await getDb();
    db.users.set(user.id, user);
    await saveDb();
    await audit(user.id, user.name, "RESET_PASSWORD", "User", user.id, "ALLOW");
    await createSession(user.id);
    redirect("/workspace");
  }

  const db = await getDb();
  const authToken = db.authTokens.get(token);
  if (!authToken || authToken.purpose !== "reset" || new Date(authToken.expiresAt).getTime() < Date.now()) {
    return { ok: false, message: "This reset link is invalid or has expired." };
  }
  const user = db.users.get(authToken.userId);
  if (!user) return { ok: false, message: "This reset link is invalid or has expired." };

  user.passwordHash = await hashPassword(password);
  db.authTokens.delete(token);
  await saveDb();
  await audit(user.id, user.name, "RESET_PASSWORD", "User", user.id, "ALLOW");
  await createSession(user.id);
  redirect("/workspace");
}

export async function changeOwnAccountAction(input: {
  currentPassword: string;
  email: string;
  newPassword?: string;
}): Promise<AuthResult> {
  const actor = await getCurrentUser();
  const context = await getRequestContext();
  const throttle = await consumeRateLimit({
    scope: "account-security-change",
    subject: `${context.ipAddress}:${actor.id}`,
    limit: 5,
    windowSeconds: 60 * 60,
  });
  if (!throttle.allowed) return { ok: false, message: "Too many security changes. Try again later." };

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Enter a valid email address." };
  if (input.newPassword && input.newPassword.length < 12) {
    return { ok: false, message: "New passwords must be at least 12 characters." };
  }
  if (input.newPassword) {
    const passwordError = await validateNewPassword(input.newPassword);
    if (passwordError) return { ok: false, message: passwordError };
  }

  const db = await getDb();
  const user = hasSqlDatabase()
    ? await findSqlIdentityByEmail(actor.email)
    : db.users.get(actor.id) ?? null;
  if (!user?.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    await audit(actor.id, actor.name, "ACCOUNT_SECURITY_CHANGE", "User", actor.id, "DENY");
    return { ok: false, message: "Current password is incorrect." };
  }
  const sqlDuplicate = hasSqlDatabase() ? await findSqlIdentityByEmail(email) : null;
  const duplicate = hasSqlDatabase()
    ? Boolean(sqlDuplicate && sqlDuplicate.id !== user.id)
    : Array.from(db.users.values()).some((candidate) => candidate.id !== user.id && candidate.email.toLowerCase() === email);
  if (duplicate) return { ok: false, message: "That email is already assigned to another user." };

  const previousEmail = user.email;
  user.email = email;
  if (input.newPassword) user.passwordHash = await hashPassword(input.newPassword);
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  if (hasSqlDatabase()) {
    await updateSqlIdentity(user, { revokeSessions: true });
    db.users.set(user.id, user);
  } else {
    for (const [token, session] of db.sessions) if (session.userId === user.id) db.sessions.delete(token);
  }
  await saveDb();
  await audit(actor.id, actor.name, "ACCOUNT_SECURITY_CHANGE", "User", actor.id, "ALLOW", {
    previousEmail,
    newEmail: email,
    passwordChanged: Boolean(input.newPassword),
  });
  await createSession(user.id);
  return { ok: true, message: "Login email and password settings updated. Other sessions were signed out." };
}

export async function beginMfaEnrollmentAction(currentPassword: string): Promise<AuthResult & { secret?: string; otpauthUrl?: string }> {
  const actor = await getCurrentUser();
  if (!isSecretStorageEnabled()) return { ok: false, message: "Credential encryption must be configured before MFA can be enabled." };
  const db = await getDb();
  const user = hasSqlDatabase() ? await findSqlIdentityByEmail(actor.email) : db.users.get(actor.id) ?? null;
  if (!user?.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) return { ok: false, message: "Current password is incorrect." };
  const enrollment = createTotpEnrollment(user.email);
  user.mfa = { encryptedSecret: encryptSecret(enrollment.secret), pendingCreatedAt: new Date().toISOString() };
  if (hasSqlDatabase()) await updateSqlIdentity(user);
  db.users.set(user.id, user);
  await saveDb();
  await audit(actor.id, actor.name, "MFA_ENROLLMENT_STARTED", "User", actor.id, "ALLOW");
  return { ok: true, message: "Add the key to your authenticator, then confirm a current code.", ...enrollment };
}

export async function confirmMfaEnrollmentAction(code: string): Promise<AuthResult & { recoveryCodes?: string[] }> {
  const actor = await getCurrentUser();
  const db = await getDb();
  const user = hasSqlDatabase() ? await findSqlIdentityByEmail(actor.email) : db.users.get(actor.id) ?? null;
  const secret = user?.mfa ? decryptSecret(user.mfa.encryptedSecret) : null;
  if (!user?.mfa?.pendingCreatedAt || !secret || Date.now() - new Date(user.mfa.pendingCreatedAt).getTime() > 15 * 60 * 1000 || !verifyTotp(secret, code)) {
    return { ok: false, message: "The enrollment code is invalid or expired. Start again." };
  }
  const recoveryCodes = createRecoveryCodes();
  user.mfa = { encryptedSecret: user.mfa.encryptedSecret, enabledAt: new Date().toISOString(), recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode) };
  if (hasSqlDatabase()) await updateSqlIdentity(user, { revokeSessions: true });
  db.users.set(user.id, user);
  await saveDb();
  await createSession(user.id);
  await audit(actor.id, actor.name, "MFA_ENABLED", "User", actor.id, "ALLOW");
  return { ok: true, message: "Authenticator MFA is enabled. Store the recovery codes securely; they are shown once.", recoveryCodes };
}
