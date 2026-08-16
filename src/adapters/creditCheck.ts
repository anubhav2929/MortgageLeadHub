// iSoftpull — soft credit inquiry.
//
// "Soft" means the borrower's score is returned without a hard inquiry: it
// does not affect their score and is not visible to other lenders. That is
// what makes it usable for pre-qualification at the top of the funnel.
//
// This adapter is deliberately dumb: it makes one request and reports what
// came back. It does NOT decide whether a pull is permitted — that lives in
// core/creditGate.ts, and every caller must clear it first. Keeping the
// authorisation decision out of the adapter means there is exactly one place
// to audit "were we allowed to do this", rather than one per call site.
//
// Credentials resolve per call via lib/runtimeConfig, so a key saved in
// Admin → Integrations works on the very next pull with no redeploy.

import { classifyFailure, type DeliveryFailure } from "@/core/deliveryStatus";
import { getConfigValue } from "@/lib/runtimeConfig";
import type { CreditBand } from "@/domain/types";

export interface SoftPullInput {
  firstName: string;
  lastName: string;
  addressLine1: string;
  city?: string;
  stateCode: string;
  postalCode?: string;
  /** Correlates the inquiry with the lead in iSoftpull's own reporting. */
  referenceId: string;
}

export type SoftPullResult =
  | { ok: true; score?: number; band: CreditBand; bureau?: string; providerReferenceId?: string; simulated: boolean }
  | { ok: false; failure: DeliveryFailure };

/** Map a FICO score onto the band the rest of the app already speaks, so the
 *  scoring model and the UI don't need to learn a second vocabulary. */
export function scoreToBand(score: number): CreditBand {
  if (score >= 740) return "EXCELLENT_740_PLUS";
  if (score >= 680) return "GOOD_680_739";
  if (score >= 620) return "FAIR_620_679";
  return "BELOW_620";
}

/** Deterministic per-person score for the simulated path, so the same test
 *  lead shows the same band on every reload instead of re-rolling. */
function simulatedScore(input: SoftPullInput): number {
  const seed = `${input.firstName}|${input.lastName}|${input.addressLine1}|${input.stateCode}`.toLowerCase();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  // 580–800, the range that actually turns up in this market.
  return 580 + (Math.abs(hash) % 221);
}

export async function runSoftCreditPull(input: SoftPullInput): Promise<SoftPullResult> {
  const apiKey = await getConfigValue("ISOFTPULL_API_KEY");
  const apiSecret = await getConfigValue("ISOFTPULL_API_SECRET");

  if (!apiKey || !apiSecret) {
    const score = simulatedScore(input);
    // Never log the name or address — this is the one adapter where the
    // request payload is unambiguously regulated PII.
    console.log(`[SIMULATED SOFT PULL] ref=${input.referenceId} → band ${scoreToBand(score)}`);
    return { ok: true, score, band: scoreToBand(score), bureau: "SIMULATED", simulated: true };
  }

  try {
    const response = await fetch("https://api.isoftpull.com/v2/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // iSoftpull authenticates with a key/secret pair on the request.
        "api-token": apiKey,
        "api-secret": apiSecret,
      },
      body: JSON.stringify({
        first_name: input.firstName,
        last_name: input.lastName,
        street: input.addressLine1,
        city: input.city,
        state: input.stateCode,
        zip: input.postalCode,
        reference_id: input.referenceId,
        // Explicitly a soft inquiry. If this ever flips to a hard pull the
        // borrower's authorisation no longer covers it.
        inquiry_type: "soft",
      }),
    });

    if (!response.ok) {
      throw new Error(`iSoftpull returned ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      id?: string;
      score?: number;
      credit_score?: number;
      bureau?: string;
      status?: string;
    };

    const score = data.score ?? data.credit_score;
    if (typeof score !== "number") {
      // A response with no score is a miss (no file found, or a mismatch on
      // name/address), not an error. Treat it as such rather than pretending.
      return {
        ok: false,
        failure: {
          class: "PERMANENT",
          message: "No credit file matched this name and address.",
          affectsAllLeads: false,
        },
      };
    }

    return {
      ok: true,
      score,
      band: scoreToBand(score),
      bureau: data.bureau,
      providerReferenceId: data.id,
      simulated: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown iSoftpull error";
    console.error("[iSoftpull] soft pull failed:", message);
    return { ok: false, failure: classifyFailure("isoftpull", undefined, message) };
  }
}
