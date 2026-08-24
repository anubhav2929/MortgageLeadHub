import { createHash } from "node:crypto";

const COMMON = new Set([
  "password123!", "password1234", "qwerty123456", "welcome123!", "letmein123!",
  "admin123456", "mortgage123!", "changeme123!", "equityflow123!",
]);

export async function validateNewPassword(password: string): Promise<string | null> {
  if (password.length < 12) return "Password must be at least 12 characters.";
  if (password.length > 256) return "Password is too long.";
  if (COMMON.has(password.toLowerCase()) || /^(.)\1{11,}$/.test(password)) return "Choose a password that is not commonly used.";
  const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`, {
      headers: { "Add-Padding": "true", "User-Agent": "MortgageLeadHub-password-screen/1.0" },
      signal: AbortSignal.timeout(4_000),
    });
    if (response.ok) {
      const suffix = digest.slice(5);
      if ((await response.text()).split(/\r?\n/).some((line) => line.split(":")[0] === suffix)) return "That password appears in a known breach. Choose a different password.";
    }
  } catch {
    // The local common-password policy still applies. Availability of an
    // external screening service must not make account recovery impossible.
  }
  return null;
}
