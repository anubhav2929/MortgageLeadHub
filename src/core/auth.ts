// Password hashing — scrypt (Node's built-in crypto, no new dependency).
// Stored as "saltHex:hashHex" so each password gets a fresh random salt.

import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

/** Sync variant for seed data, where seedDatabase() can't be made async
 *  without threading a Promise through every getDb()/resetDb() call site. */
export function hashPasswordSync(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(plain, salt, KEY_LENGTH);
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derivedKey = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
  const storedKey = Buffer.from(hashHex, "hex");
  if (derivedKey.length !== storedKey.length) return false;
  return timingSafeEqual(derivedKey, storedKey);
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** Constant-time string comparison for webhook/cron shared secrets — a plain
 *  `!==` leaks timing information proportional to the matching prefix
 *  length, which is a real (if narrow) side channel for a bearer secret. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do a comparison (against a same-length dummy) so a length
    // mismatch doesn't short-circuit faster than a real compare would.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
