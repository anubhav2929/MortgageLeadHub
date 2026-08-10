// Property valuation / AVM (automated valuation model) lookup — the "pull
// property value, comps, and ownership history the way Clear Capital does"
// ask from the call, extended with the mortgage-balance/property-type/
// year-built fields the Equity Flow Group business plan's lead-scoring
// engine needs to compute usable equity.
//
// Live provider: RentCast (rentcast.io) — chosen because it's the only AVM
// vendor with a real, no-credit-card free tier (50 requests/month) that
// individual developers can actually sign up for. Zillow's Zestimate API has
// been closed to the public since 2021 (enterprise/MLS-only via Bridge
// Interactive); CoreLogic/ATTOM/HouseCanary are all enterprise-sales-only.
// Set PROPERTY_DATA_API_KEY to a RentCast key to go live — see .env.example.
//
// A street address is required for a real per-property comp search (RentCast
// needs more than "city, state" to find nearby comparables), so this only
// calls the live API when the borrower provided one; otherwise it simulates,
// which also protects the free tier's 50/month cap from being spent on
// low-quality city-centroid lookups. Callers should additionally cache the
// result (see domain/queries.ts's getOrCachePropertyValuation) so a given
// lead is only ever looked up once, not once per page view.

import { getConfigValue } from "@/lib/runtimeConfig";
import type { PropertyType, PropertyValuationResult } from "@/domain/types";

export interface PropertyValuationInput {
  addressLine1?: string;
  city?: string;
  stateCode: string;
  postalCode?: string;
  estimatedValue?: number;
}

// Deterministic per-address jitter so the same lead shows the same
// "estimate" on every page load instead of re-randomizing each render.
function seededFraction(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

const STATE_MEDIAN_VALUE: Record<string, number> = {
  CA: 785000,
  FL: 410000,
  IL: 285000,
  NY: 465000,
  OR: 495000,
  TX: 335000,
  NV: 425000,
  SC: 315000,
  AZ: 435000,
  CO: 545000,
  GA: 365000,
  NC: 375000,
  OH: 235000,
  PA: 285000,
  WA: 605000,
};

const PROPERTY_TYPES: PropertyType[] = ["SINGLE_FAMILY", "SINGLE_FAMILY", "SINGLE_FAMILY", "CONDO", "TOWNHOME", "MULTI_FAMILY"];

function simulateValuation(input: PropertyValuationInput): PropertyValuationResult {
  const seed = `${input.addressLine1 ?? ""}|${input.city ?? ""}|${input.stateCode}|${input.postalCode ?? ""}`;
  const jitter = seededFraction(seed);
  const jitter2 = seededFraction(`${seed}|2`);
  const jitter3 = seededFraction(`${seed}|3`);

  const base = input.estimatedValue ?? STATE_MEDIAN_VALUE[input.stateCode] ?? 400000;
  const estimatedValue = Math.round((base * (0.9 + jitter * 0.25)) / 1000) * 1000;
  return buildAssumedFinancials(input, estimatedValue, jitter, jitter2, jitter3, true);
}

// Shared by both simulated and live paths: no AVM vendor exposes real
// outstanding-mortgage-balance data (that's private lender data, never
// public record), so the balance/LTV/equity trio is always an assumed-LTV
// model layered on top of whichever estimatedValue we have — simulated or
// a real RentCast price.
function buildAssumedFinancials(
  input: PropertyValuationInput,
  estimatedValue: number,
  jitter: number,
  jitter2: number,
  jitter3: number,
  simulated: boolean,
  rentcastFields?: Partial<PropertyValuationResult>
): PropertyValuationResult {
  const spread = Math.round(estimatedValue * 0.06);
  const saleYearsAgo = 2 + Math.floor(jitter * 10);

  // Assumed public-record mortgage balance — typical existing-owner LTV
  // clusters between 45% and 80% rather than uniformly random.
  const assumedLtv = 0.45 + jitter2 * 0.35;
  const estimatedMortgageBalance = Math.round((estimatedValue * assumedLtv) / 1000) * 1000;
  const usableEquity = Math.max(0, estimatedValue - estimatedMortgageBalance);
  const estimatedLTV = Math.round((estimatedMortgageBalance / estimatedValue) * 1000) / 10;

  const propertyType = PROPERTY_TYPES[Math.floor(jitter3 * PROPERTY_TYPES.length)];
  const yearBuilt = 1955 + Math.floor(jitter2 * 68);

  return {
    estimatedValue,
    confidenceLow: estimatedValue - spread,
    confidenceHigh: estimatedValue + spread,
    comparableCount: 3 + Math.floor(jitter * 6),
    lastSaleDate: new Date(Date.now() - saleYearsAgo * 365 * 24 * 60 * 60 * 1000).toISOString(),
    lastSalePrice: Math.round((estimatedValue * (0.65 + jitter * 0.15)) / 1000) * 1000,
    estimatedMortgageBalance,
    propertyType,
    yearBuilt,
    estimatedLTV,
    usableEquity,
    simulated,
    ...rentcastFields,
    // Built last so it reflects what actually came back from the vendor.
    // The balance/LTV/equity trio is MODELED on every path, live included —
    // it is an assumed-LTV calculation, not data anyone reported to us.
    provenance: {
      estimatedValue: simulated ? "MODELED" : "MEASURED",
      confidenceRange: simulated || rentcastFields?.confidenceLow === undefined ? "MODELED" : "MEASURED",
      comparableCount: simulated ? "MODELED" : "MEASURED",
      lastSale: !simulated && rentcastFields?.lastSaleDate ? "MEASURED" : "MODELED",
      estimatedMortgageBalance: "MODELED",
      estimatedLTV: "MODELED",
      usableEquity: "MODELED",
      propertyType: !simulated && rentcastFields?.propertyType ? "MEASURED" : "MODELED",
      yearBuilt: !simulated && rentcastFields?.yearBuilt ? "MEASURED" : "MODELED",
    },
  };
}

const RENTCAST_PROPERTY_TYPE: Record<string, PropertyType> = {
  "Single Family": "SINGLE_FAMILY",
  Condo: "CONDO",
  Condominium: "CONDO",
  Townhouse: "TOWNHOME",
  "Multi-Family": "MULTI_FAMILY",
  Apartment: "MULTI_FAMILY",
};

interface RentCastValueResponse {
  price?: number;
  priceRangeLow?: number;
  priceRangeHigh?: number;
  comparables?: unknown[];
  subjectProperty?: {
    propertyType?: string;
    yearBuilt?: number;
    lastSaleDate?: string;
    lastSalePrice?: number;
  };
}

async function fetchRentCastValuation(input: PropertyValuationInput): Promise<PropertyValuationResult> {
  const address = `${input.addressLine1}, ${input.city ?? ""}, ${input.stateCode}${input.postalCode ? ` ${input.postalCode}` : ""}`;
  const url = `https://api.rentcast.io/v1/avm/value?address=${encodeURIComponent(address)}`;

  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Api-Key": (await getConfigValue("PROPERTY_DATA_API_KEY"))! },
  });
  if (!response.ok) {
    throw new Error(`RentCast AVM request failed: ${response.status} ${await response.text()}`);
  }
  const data: RentCastValueResponse = await response.json();
  if (!data.price) {
    throw new Error("RentCast AVM returned no price estimate (likely insufficient comparables for this address).");
  }

  const seed = address;
  const jitter = seededFraction(seed);
  const jitter2 = seededFraction(`${seed}|2`);

  const subject = data.subjectProperty;
  const propertyType = (subject?.propertyType && RENTCAST_PROPERTY_TYPE[subject.propertyType]) || "SINGLE_FAMILY";

  return buildAssumedFinancials(input, data.price, jitter, jitter2, jitter, false, {
    confidenceLow: data.priceRangeLow ?? Math.round(data.price * 0.94),
    confidenceHigh: data.priceRangeHigh ?? Math.round(data.price * 1.06),
    comparableCount: data.comparables?.length ?? 0,
    lastSaleDate: subject?.lastSaleDate,
    lastSalePrice: subject?.lastSalePrice,
    propertyType,
    yearBuilt: subject?.yearBuilt ?? 1955 + Math.floor(jitter2 * 68),
  });
}

export async function getPropertyValuation(input: PropertyValuationInput): Promise<PropertyValuationResult> {
  if (!(await getConfigValue("PROPERTY_DATA_API_KEY"))) {
    const result = simulateValuation(input);
    console.log(`[SIMULATED AVM] ${input.city ?? "?"}, ${input.stateCode} → $${result.estimatedValue.toLocaleString()} (LTV ${result.estimatedLTV}%)`);
    return result;
  }

  if (!input.addressLine1) {
    const result = simulateValuation(input);
    console.log(`[SIMULATED AVM] no street address on file for ${input.city ?? "?"}, ${input.stateCode} — skipping live RentCast lookup to preserve free-tier quota.`);
    return result;
  }

  try {
    const result = await fetchRentCastValuation(input);
    console.log(`[LIVE AVM/RentCast] ${input.addressLine1}, ${input.city ?? "?"}, ${input.stateCode} → $${result.estimatedValue.toLocaleString()} (${result.comparableCount} comps)`);
    return result;
  } catch (err) {
    console.error(`[LIVE AVM/RentCast] lookup failed, falling back to simulated estimate: ${err instanceof Error ? err.message : String(err)}`);
    return simulateValuation(input);
  }
}
