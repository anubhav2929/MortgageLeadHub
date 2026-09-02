import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { safeCompare } from "@/core/auth";
import type { Database } from "@/domain/store";
import type { Lead } from "@/domain/types";

function hashStatusToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function issueStatusToken(lead: Lead): string {
  const token = nanoid(40);
  lead.statusTokenHash = hashStatusToken(token);
  lead.statusTokenIssuedAt = new Date().toISOString();
  lead.previousStatusTokenHashes = [];
  return token;
}

/** Mint another status link while preserving links that may already be open
 * or present in an earlier email. This is intentionally distinct from
 * issueStatusToken(), whose rotation semantics are used by status recovery. */
export function issueAdditionalStatusToken(lead: Lead): string {
  const previous = [
    ...(lead.previousStatusTokenHashes ?? []),
    ...(lead.statusTokenHash ? [lead.statusTokenHash] : []),
  ];
  // A normal cadence creates only a handful of links. Bounding the list keeps
  // a malformed cadence from accumulating bearer credentials indefinitely.
  lead.previousStatusTokenHashes = Array.from(new Set(previous)).slice(-16);
  const token = nanoid(40);
  lead.statusTokenHash = hashStatusToken(token);
  lead.statusTokenIssuedAt = new Date().toISOString();
  return token;
}

export function matchesStatusToken(lead: Lead, token: string): boolean {
  if (!lead.statusTokenHash || token.length < 32) return false;
  const digest = hashStatusToken(token);
  return [lead.statusTokenHash, ...(lead.previousStatusTokenHashes ?? [])]
    .some((candidate) => safeCompare(digest, candidate));
}

export function findLeadByStatusToken(db: Database, token: string): Lead | undefined {
  return Array.from(db.leads.values()).find((lead) => matchesStatusToken(lead, token));
}

export function findPublicStatusLead(db: Database, accessKey: string): Lead | undefined {
  return findLeadByStatusToken(db, accessKey);
}
