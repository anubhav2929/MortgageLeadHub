"use server";

// The auth boundary itself — every action here is callable by an anonymous
// visitor, unlike actions.ts (which assumes an authenticated getCurrentUser()
// throughout). Kept in its own file for that reason: this is the one place
// where "no user yet" is the normal case, not an error.

import { redirect } from "next/navigation";
import { sendEmail } from "@/adapters/email";
import { hashPassword, verifyPassword, generateToken } from "@/core/auth";
import { audit } from "@/domain/actions";
import { createSession, destroySession } from "@/domain/session";
import { getDb, newId, saveDb } from "@/domain/store";
import { getAppUrl } from "@/lib/runtimeConfig";

export interface AuthResult {
  ok: boolean;
  message: string;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const GENERIC_LOGIN_ERROR: AuthResult = { ok: false, message: "Invalid email or password." };

export async function loginAction(email: string, password: string): Promise<AuthResult> {
  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();
  const user = Array.from(db.users.values()).find((u) => u.email.toLowerCase() === normalizedEmail);

  if (!user || !user.isActive || !user.passwordHash) return GENERIC_LOGIN_ERROR;

  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    return { ok: false, message: "Too many failed attempts. Try again in a few minutes." };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();
      user.failedLoginAttempts = 0;
    }
    saveDb();
    await audit(user.id, user.name, "LOGIN_FAILED", "User", user.id, "DENY");
    return GENERIC_LOGIN_ERROR;
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  saveDb();
  await createSession(user.id);
  await audit(user.id, user.name, "LOGIN", "User", user.id, "ALLOW");
  redirect("/workspace");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function acceptInviteAction(token: string, password: string): Promise<AuthResult> {
  if (password.length < 8) return { ok: false, message: "Password must be at least 8 characters." };

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
  saveDb();
  await audit(user.id, user.name, "ACCEPT_INVITE", "User", user.id, "ALLOW");
  await createSession(user.id);
  redirect("/workspace");
}

export async function requestPasswordResetAction(email: string): Promise<AuthResult> {
  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();
  const user = Array.from(db.users.values()).find((u) => u.email.toLowerCase() === normalizedEmail && u.isActive);

  // Same response whether or not the account exists — never reveal that.
  const response: AuthResult = { ok: true, message: "If that email has an account, a reset link is on its way." };
  if (!user) return response;

  const token = generateToken();
  db.authTokens.set(token, {
    token,
    userId: user.id,
    purpose: "reset",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  saveDb();

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
  if (password.length < 8) return { ok: false, message: "Password must be at least 8 characters." };

  const db = await getDb();
  const authToken = db.authTokens.get(token);
  if (!authToken || authToken.purpose !== "reset" || new Date(authToken.expiresAt).getTime() < Date.now()) {
    return { ok: false, message: "This reset link is invalid or has expired." };
  }
  const user = db.users.get(authToken.userId);
  if (!user) return { ok: false, message: "This reset link is invalid or has expired." };

  user.passwordHash = await hashPassword(password);
  db.authTokens.delete(token);
  saveDb();
  await audit(user.id, user.name, "RESET_PASSWORD", "User", user.id, "ALLOW");
  await createSession(user.id);
  redirect("/workspace");
}
