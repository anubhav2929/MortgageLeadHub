// Pure intake helpers. These live in core/ rather than beside the server
// action because they are decisions, not I/O: one determines whether we can
// legally dial a number at all, the other determines which revenue path a
// borrower takes. Both deserve tests that don't need a database.

import type { MissedPayments, ReferralType } from "@/domain/types";

/**
 * Normalize a US phone number to E.164, or null when it isn't one.
 *
 * Returning null rather than a best-effort string matters: a malformed number
 * that reaches the carrier is a failed send and a wasted contact attempt, and
 * a number that silently loses a digit could dial a stranger.
 *
 * src/components/intake/intake-wizard.tsx mirrors this rule client-side so a
 * bad number is caught on the step where the field is still visible.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * A borrower who can't qualify for refi/equity isn't a dead lead — missed
 * payments route them to a specialist partner instead, which is a second real
 * revenue line off the same lead spend rather than a rejection.
 */
export function classifyReferral(missedPayments: MissedPayments): ReferralType {
  if (missedPayments === "THREE_PLUS") return "FORECLOSURE";
  if (missedPayments === "ONE_TO_TWO") return "LOAN_MODIFICATION";
  return "NONE";
}
