import { createHash } from "node:crypto";
import { getConfigValue } from "@/lib/runtimeConfig";
import type { PropertyType, PropertyValuationEvidence, PropertyValuationResult } from "@/domain/types";

export interface PropertyValuationInput {
  addressLine1?: string;
  city?: string;
  stateCode: string;
  postalCode?: string;
  estimatedValue?: number;
  currentBalance?: number;
  useFreeEvidence?: boolean;
}

const DISCLAIMER = "Informational estimate only — not an appraisal, underwriting decision, approval, rate, or lending advice.";
const RECORD_HOST_ALLOWLIST = new Set(["api.census.gov", "geocoding.geo.census.gov"]);

function evidenceId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function emptyResult(input: PropertyValuationInput, evidence: PropertyValuationEvidence[]): PropertyValuationResult {
  const balance = input.currentBalance && input.currentBalance > 0 ? input.currentBalance : 0;
  return {
    estimatedValue: 0, confidenceLow: 0, confidenceHigh: 0, comparableCount: 0,
    estimatedMortgageBalance: balance, propertyType: "SINGLE_FAMILY", yearBuilt: 0, estimatedLTV: 0, usableEquity: 0,
    simulated: false,
    provenance: {
      estimatedValue: "MODELED", confidenceRange: "MODELED", comparableCount: "MODELED", lastSale: "MODELED",
      estimatedMortgageBalance: input.currentBalance ? "MEASURED" : "MODELED", estimatedLTV: "MODELED", usableEquity: "MODELED",
      propertyType: "MODELED", yearBuilt: "MODELED",
    },
    disclaimer: DISCLAIMER, method: "INSUFFICIENT_EVIDENCE", confidence: "INSUFFICIENT", evidence,
    freshnessAt: new Date().toISOString(), providerCostUsd: 0,
  };
}

interface CensusMatch { matchedAddress?: string; coordinates?: { x?: number; y?: number } }

async function normalizeWithCensus(input: PropertyValuationInput): Promise<PropertyValuationEvidence | undefined> {
  if (!input.addressLine1 || !input.city) return undefined;
  const url = new URL(input.postalCode
    ? "https://geocoding.geo.census.gov/geocoder/geographies/address"
    : "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress");
  if (input.postalCode) {
    url.searchParams.set("street", input.addressLine1);
    url.searchParams.set("city", input.city);
    url.searchParams.set("state", input.stateCode);
    url.searchParams.set("zip", input.postalCode);
  } else {
    url.searchParams.set("address", `${input.addressLine1}, ${input.city}, ${input.stateCode}`);
  }
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return undefined;
  const body = await response.json() as { result?: { addressMatches?: CensusMatch[] } };
  const match = body.result?.addressMatches?.[0];
  if (!match?.matchedAddress) return undefined;
  return {
    id: evidenceId(`census:${match.matchedAddress}`), kind: "PUBLIC_RECORD", retrievedAt: new Date().toISOString(),
    sourceUrl: "https://geocoding.geo.census.gov/geocoder/", sourceLabel: "US Census Geocoder", reliability: 0.95,
    notes: `Normalized address: ${match.matchedAddress}${match.coordinates ? ` (${match.coordinates.y}, ${match.coordinates.x})` : ""}`,
  };
}

interface PublicRecordResponse {
  assessedValue?: number; estimatedValue?: number; lastSalePrice?: number; lastSaleDate?: string;
  propertyType?: string; yearBuilt?: number; sourceUrl?: string; sourceLabel?: string;
}

async function collectConfiguredPublicRecord(input: PropertyValuationInput): Promise<{ record: PublicRecordResponse; evidence: PropertyValuationEvidence[] } | undefined> {
  const endpoint = await getConfigValue("PROPERTY_PUBLIC_RECORD_ENDPOINT");
  if (!endpoint || !input.addressLine1) return undefined;
  const url = new URL(endpoint);
  const configuredHosts = ((await getConfigValue("PROPERTY_RECORD_ALLOWLIST")) ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!RECORD_HOST_ALLOWLIST.has(url.hostname) && !configuredHosts.includes(url.hostname.toLowerCase())) {
    throw new Error(`Public-record host ${url.hostname} is not allowlisted.`);
  }
  url.searchParams.set("address", `${input.addressLine1}, ${input.city ?? ""}, ${input.stateCode} ${input.postalCode ?? ""}`.trim());
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Public-record source returned ${response.status}.`);
  const record = await response.json() as PublicRecordResponse;
  const evidence: PropertyValuationEvidence[] = [];
  const retrievedAt = new Date().toISOString();
  if (record.assessedValue && record.assessedValue > 0) evidence.push({
    id: evidenceId(`assessor:${url.hostname}:${record.assessedValue}`), kind: "ASSESSOR", value: record.assessedValue,
    retrievedAt, sourceUrl: record.sourceUrl ?? url.origin, sourceLabel: record.sourceLabel ?? `Configured assessor (${url.hostname})`, reliability: 0.72,
  });
  if (record.lastSalePrice && record.lastSalePrice > 0) evidence.push({
    id: evidenceId(`sale:${url.hostname}:${record.lastSalePrice}:${record.lastSaleDate ?? ""}`), kind: "RECORDED_SALE", value: record.lastSalePrice,
    observedAt: record.lastSaleDate, retrievedAt, sourceUrl: record.sourceUrl ?? url.origin,
    sourceLabel: record.sourceLabel ?? `Configured public records (${url.hostname})`, reliability: 0.82,
  });
  if (record.estimatedValue && record.estimatedValue > 0) evidence.push({
    id: evidenceId(`public:${url.hostname}:${record.estimatedValue}`), kind: "PUBLIC_RECORD", value: record.estimatedValue,
    retrievedAt, sourceUrl: record.sourceUrl ?? url.origin, sourceLabel: record.sourceLabel ?? `Configured open-data source (${url.hostname})`, reliability: 0.68,
  });
  return { record, evidence };
}

async function addFhfaAdjustment(input: PropertyValuationInput, record: PublicRecordResponse, evidence: PropertyValuationEvidence[]) {
  if (!record.lastSalePrice || !record.lastSaleDate) return;
  const raw = await getConfigValue("FHFA_HPI_INDEX_JSON");
  if (!raw) return;
  try {
    const series = JSON.parse(raw) as Record<string, Record<string, number>>;
    const state = series[input.stateCode];
    const saleYear = String(new Date(record.lastSaleDate).getUTCFullYear());
    const currentYear = String(new Date().getUTCFullYear());
    const start = state?.[saleYear];
    const end = state?.[currentYear];
    if (!start || !end || start <= 0 || end <= 0) return;
    const adjusted = Math.round(record.lastSalePrice * end / start / 1000) * 1000;
    evidence.push({
      id: evidenceId(`fhfa:${input.stateCode}:${saleYear}:${currentYear}:${adjusted}`), kind: "FHFA_HPI", value: adjusted,
      observedAt: record.lastSaleDate, retrievedAt: new Date().toISOString(), sourceUrl: "https://www.fhfa.gov/data/hpi/datasets",
      sourceLabel: "FHFA House Price Index", reliability: 0.88,
      notes: `Recorded sale time-adjusted from ${saleYear} to ${currentYear}; state-level index is contextual evidence, not a comparable sale.`,
    });
  } catch {
    console.error("[property-evidence] FHFA_HPI_INDEX_JSON is invalid JSON; sale adjustment skipped.");
  }
}

function propertyType(value?: string): PropertyType {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("condo")) return "CONDO";
  if (normalized.includes("town")) return "TOWNHOME";
  if (normalized.includes("multi") || normalized.includes("duplex")) return "MULTI_FAMILY";
  return "SINGLE_FAMILY";
}

export function buildOpenEvidenceValuation(input: PropertyValuationInput, evidence: PropertyValuationEvidence[], record?: PublicRecordResponse): PropertyValuationResult | undefined {
  const hasAdjustedSale = evidence.some((item) => item.kind === "FHFA_HPI");
  const values = evidence.filter((item) => item.value && item.value > 0 && !(hasAdjustedSale && item.kind === "RECORDED_SALE"));
  const independent = values.filter((item) => item.kind !== "BORROWER_ESTIMATE");
  if (independent.length < 2) return undefined;
  const weight = values.reduce((sum, item) => sum + item.reliability, 0);
  const estimate = Math.round(values.reduce((sum, item) => sum + item.value! * item.reliability, 0) / weight / 1000) * 1000;
  const dispersion = Math.max(...values.map((item) => Math.abs(item.value! - estimate) / estimate));
  const confidence = independent.length >= 3 && dispersion <= 0.12 ? "HIGH" : dispersion <= 0.22 ? "MEDIUM" : "LOW";
  const spread = Math.round(estimate * (confidence === "HIGH" ? 0.06 : confidence === "MEDIUM" ? 0.1 : 0.16));
  const balance = input.currentBalance && input.currentBalance > 0 ? input.currentBalance : 0;
  return {
    estimatedValue: estimate, confidenceLow: Math.max(0, estimate - spread), confidenceHigh: estimate + spread,
    comparableCount: independent.length, lastSaleDate: record?.lastSaleDate, lastSalePrice: record?.lastSalePrice,
    estimatedMortgageBalance: balance, propertyType: propertyType(record?.propertyType), yearBuilt: record?.yearBuilt ?? 0,
    estimatedLTV: balance ? Math.round(balance / estimate * 1000) / 10 : 0, usableEquity: balance ? Math.max(0, estimate - balance) : 0,
    simulated: false,
    provenance: {
      estimatedValue: "MEASURED", confidenceRange: "MODELED", comparableCount: "MEASURED", lastSale: record?.lastSalePrice ? "MEASURED" : "MODELED",
      estimatedMortgageBalance: input.currentBalance ? "MEASURED" : "MODELED", estimatedLTV: "MODELED", usableEquity: "MODELED",
      propertyType: record?.propertyType ? "MEASURED" : "MODELED", yearBuilt: record?.yearBuilt ? "MEASURED" : "MODELED",
    },
    disclaimer: DISCLAIMER, method: "OPEN_EVIDENCE", confidence, evidence, freshnessAt: new Date().toISOString(), providerCostUsd: 0,
  };
}

interface RentCastValueResponse {
  price?: number; priceRangeLow?: number; priceRangeHigh?: number; comparables?: unknown[];
  subjectProperty?: { propertyType?: string; yearBuilt?: number; lastSaleDate?: string; lastSalePrice?: number };
}

async function fetchRentCast(input: PropertyValuationInput, existingEvidence: PropertyValuationEvidence[]): Promise<PropertyValuationResult> {
  const key = await getConfigValue("PROPERTY_DATA_API_KEY");
  if (!key || !input.addressLine1) return emptyResult(input, existingEvidence);
  const address = `${input.addressLine1}, ${input.city ?? ""}, ${input.stateCode}${input.postalCode ? ` ${input.postalCode}` : ""}`;
  const url = `https://api.rentcast.io/v1/avm/value?address=${encodeURIComponent(address)}`;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "X-Api-Key": key }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`RentCast returned ${response.status}.`);
    const data = await response.json() as RentCastValueResponse;
    if (!data.price || data.price <= 0) throw new Error("RentCast returned no estimate.");
    const subject = data.subjectProperty;
    const evidence: PropertyValuationEvidence[] = [...existingEvidence, {
      id: evidenceId(`rentcast:${address}:${data.price}`), kind: "RENTCAST", value: data.price, retrievedAt: new Date().toISOString(),
      sourceUrl: "https://www.rentcast.io/", sourceLabel: "RentCast AVM", reliability: 0.9,
    }];
    const balance = input.currentBalance && input.currentBalance > 0 ? input.currentBalance : 0;
    return {
      estimatedValue: data.price, confidenceLow: data.priceRangeLow ?? Math.round(data.price * 0.94), confidenceHigh: data.priceRangeHigh ?? Math.round(data.price * 1.06),
      comparableCount: data.comparables?.length ?? 0, lastSaleDate: subject?.lastSaleDate, lastSalePrice: subject?.lastSalePrice,
      estimatedMortgageBalance: balance, propertyType: propertyType(subject?.propertyType), yearBuilt: subject?.yearBuilt ?? 0,
      estimatedLTV: balance ? Math.round(balance / data.price * 1000) / 10 : 0, usableEquity: balance ? Math.max(0, data.price - balance) : 0,
      simulated: false,
      provenance: {
        estimatedValue: "MEASURED", confidenceRange: data.priceRangeLow ? "MEASURED" : "MODELED", comparableCount: "MEASURED",
        lastSale: subject?.lastSalePrice ? "MEASURED" : "MODELED", estimatedMortgageBalance: input.currentBalance ? "MEASURED" : "MODELED",
        estimatedLTV: "MODELED", usableEquity: "MODELED", propertyType: subject?.propertyType ? "MEASURED" : "MODELED", yearBuilt: subject?.yearBuilt ? "MEASURED" : "MODELED",
      },
      disclaimer: DISCLAIMER, method: "RENTCAST", confidence: "MEDIUM", evidence, freshnessAt: new Date().toISOString(),
      providerCostUsd: Number((await getConfigValue("RENTCAST_COST_PER_LOOKUP_USD")) ?? 0),
    };
  } catch (error) {
    console.error(`[RentCast] evidence fallback failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    return emptyResult(input, existingEvidence);
  }
}

export async function getPropertyValuation(input: PropertyValuationInput): Promise<PropertyValuationResult> {
  const evidence: PropertyValuationEvidence[] = [];
  if (input.estimatedValue && input.estimatedValue > 0) evidence.push({
    id: evidenceId(`borrower:${input.estimatedValue}`), kind: "BORROWER_ESTIMATE", value: input.estimatedValue,
    retrievedAt: new Date().toISOString(), sourceLabel: "Borrower-provided estimate", reliability: 0.35,
  });
  if (input.useFreeEvidence === false) return fetchRentCast(input, evidence);
  try {
    const census = await normalizeWithCensus(input);
    if (census) evidence.push(census);
    const source = await collectConfiguredPublicRecord(input);
    if (source) {
      evidence.push(...source.evidence);
      await addFhfaAdjustment(input, source.record, evidence);
      const open = buildOpenEvidenceValuation(input, evidence, source.record);
      if (open) return open;
    }
  } catch (error) {
    console.error(`[property-evidence] free chain failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
  return fetchRentCast(input, evidence);
}
