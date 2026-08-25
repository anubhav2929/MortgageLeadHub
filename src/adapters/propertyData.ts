import { createHash } from "node:crypto";
import { mapWithConcurrency } from "@/core/concurrency";
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
const CENSUS_HOSTS = new Set(["api.census.gov", "geocoding.geo.census.gov", "www2.census.gov"]);
const ARCGIS_HOST_PATTERN = /(^|\.)arcgis\.com$/i;
const FHFA_MASTER_JSON = "https://www.fhfa.gov/hpi/download/monthly/hpi_master.json";
const SOURCE_TIMEOUT_MS = 10_000;
const MAX_PUBLIC_SOURCES = 8;
const DEFAULT_ACS_YEAR = "2024";

export interface PropertyEvidenceConnectionHealth {
  ok: boolean;
  message: string;
}

interface PropertyEvidenceConnectionOptions {
  fetchImpl?: typeof fetch;
  config?: {
    braveKey?: string;
    censusKey?: string;
    censusYear?: string;
    sourcesJson?: string;
    legacyEndpoint?: string;
    allowlist?: string;
  };
}

function reportedBalance(input: PropertyValuationInput): { balance: number; supplied: boolean } {
  const supplied = typeof input.currentBalance === "number" && Number.isFinite(input.currentBalance) && input.currentBalance >= 0;
  return { balance: supplied ? input.currentBalance! : 0, supplied };
}

function evidenceId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function emptyResult(input: PropertyValuationInput, evidence: PropertyValuationEvidence[]): PropertyValuationResult {
  const { balance, supplied: balanceSupplied } = reportedBalance(input);
  return {
    estimatedValue: 0, confidenceLow: 0, confidenceHigh: 0, comparableCount: 0,
    estimatedMortgageBalance: balance, propertyType: "SINGLE_FAMILY", yearBuilt: 0, estimatedLTV: 0, usableEquity: 0,
    simulated: false,
    provenance: {
      estimatedValue: "MODELED", confidenceRange: "MODELED", comparableCount: "MODELED", lastSale: "MODELED",
      estimatedMortgageBalance: balanceSupplied ? "MEASURED" : "MODELED", estimatedLTV: "MODELED",
      usableEquity: "MODELED", propertyType: "MODELED", yearBuilt: "MODELED",
    },
    disclaimer: DISCLAIMER, method: "INSUFFICIENT_EVIDENCE", confidence: "INSUFFICIENT", evidence,
    freshnessAt: new Date().toISOString(), providerCostUsd: 0,
  };
}

/**
 * Safe synchronous replacement for a stale/demo valuation. It intentionally
 * carries forward only the borrower's own estimate as low-weight evidence;
 * no external lookup or modeled dollar value happens while a lead page is
 * rendering. An administrator can start the real evidence check explicitly.
 */
export function buildInsufficientPropertyValuation(input: PropertyValuationInput): PropertyValuationResult {
  const evidence: PropertyValuationEvidence[] = [];
  if (input.estimatedValue && input.estimatedValue > 0) {
    evidence.push({
      id: evidenceId(`borrower:${input.estimatedValue}`),
      kind: "BORROWER_ESTIMATE",
      value: input.estimatedValue,
      retrievedAt: new Date().toISOString(),
      sourceLabel: "Borrower-provided estimate",
      reliability: 0.35,
    });
  }
  return emptyResult(input, evidence);
}

interface CensusGeography { state: string; county: string; tract: string }
interface CensusMatch {
  matchedAddress?: string;
  coordinates?: { x?: number; y?: number };
  geographies?: Record<string, Array<Record<string, unknown>>>;
}
interface NormalizedAddress { formatted: string; evidence: PropertyValuationEvidence; census?: CensusGeography }

export function parseCensusGeography(match: CensusMatch): CensusGeography | undefined {
  const tract = match.geographies?.["Census Tracts"]?.[0];
  const state = safeText(tract?.STATE);
  const county = safeText(tract?.COUNTY);
  const tractCode = safeText(tract?.TRACT);
  return state && county && tractCode ? { state, county, tract: tractCode } : undefined;
}

async function normalizeWithCensus(input: PropertyValuationInput): Promise<NormalizedAddress | undefined> {
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
    formatted: match.matchedAddress,
    census: parseCensusGeography(match),
    evidence: {
      id: evidenceId(`census:${match.matchedAddress}`), kind: "PUBLIC_RECORD", retrievedAt: new Date().toISOString(),
      sourceUrl: "https://geocoding.geo.census.gov/geocoder/", sourceLabel: "US Census Geocoder", reliability: 0.95,
      notes: `Normalized address${match.coordinates ? ` at ${match.coordinates.y}, ${match.coordinates.x}` : ""}.`,
    },
  };
}

interface AcsValueRow {
  name: string;
  value: number;
  marginOfError?: number;
}

export function parseAcsHousingValue(payload: unknown): AcsValueRow | undefined {
  if (!Array.isArray(payload) || payload.length < 2 || !Array.isArray(payload[0]) || !Array.isArray(payload[1])) return undefined;
  const headers = payload[0].map(String);
  const row = payload[1];
  const valueIndex = headers.indexOf("B25077_001E");
  const marginIndex = headers.indexOf("B25077_001M");
  const nameIndex = headers.indexOf("NAME");
  const value = safeNumber(row[valueIndex]);
  if (!value) return undefined;
  return {
    name: safeText(row[nameIndex]) ?? "matched Census area",
    value,
    marginOfError: marginIndex >= 0 ? safeNumber(row[marginIndex]) : undefined,
  };
}

async function fetchCensusHousingBenchmark(
  input: PropertyValuationInput,
  normalized: NormalizedAddress | undefined
): Promise<PropertyValuationEvidence | undefined> {
  const apiKey = await getConfigValue("CENSUS_DATA_API_KEY");
  if (!apiKey) return undefined;
  const configuredYear = (await getConfigValue("CENSUS_ACS_YEAR"))?.trim();
  const year = configuredYear && /^20\d{2}$/.test(configuredYear) ? configuredYear : DEFAULT_ACS_YEAR;
  const url = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
  url.searchParams.set("get", "NAME,B25077_001E,B25077_001M");
  if (normalized?.census) {
    url.searchParams.set("for", `tract:${normalized.census.tract}`);
    url.searchParams.set("in", `state:${normalized.census.state} county:${normalized.census.county}`);
  } else if (input.postalCode && /^\d{5}/.test(input.postalCode)) {
    url.searchParams.set("for", `zip code tabulation area:${input.postalCode.slice(0, 5)}`);
  } else {
    return undefined;
  }
  url.searchParams.set("key", apiKey);
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  if (!response.ok) return undefined;
  const row = parseAcsHousingValue(await response.json() as unknown);
  if (!row) return undefined;
  return {
    id: evidenceId(`census-acs:${year}:${row.name}:${row.value}`),
    kind: "CENSUS_MARKET",
    value: row.value,
    retrievedAt: new Date().toISOString(),
    sourceUrl: `https://data.census.gov/table/ACSDT5Y${year}.B25077`,
    sourceLabel: `US Census ACS ${year} neighborhood housing value`,
    reliability: 0.58,
    notes: `Median owner-occupied home value for ${row.name}${row.marginOfError ? ` (90% survey margin ±$${Math.round(row.marginOfError).toLocaleString()})` : ""}; this is neighborhood context, not a parcel appraisal.`,
  };
}

let acsSummaryCache: { year: string; expiresAt: number; text: string } | undefined;
let acsSummaryCachePromise: { year: string; promise: Promise<string> } | undefined;

async function loadAcsSummaryFile(year: string): Promise<string> {
  if (acsSummaryCache?.year === year && acsSummaryCache.expiresAt > Date.now()) return acsSummaryCache.text;
  if (!acsSummaryCachePromise || acsSummaryCachePromise.year !== year) {
    const promise = (async () => {
      const url = `https://www2.census.gov/programs-surveys/acs/summary_file/${year}/table-based-SF/data/5YRData/acsdt5y${year}-b25077.dat`;
      const response = await fetch(url, { headers: { Accept: "text/plain" }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`Census summary file returned HTTP ${response.status}.`);
      const declaredSize = Number(response.headers.get("content-length"));
      if (declaredSize && declaredSize > 30_000_000) throw new Error("Census summary file exceeded the safety limit.");
      const text = await response.text();
      if (text.length > 30_000_000 || !text.startsWith("GEO_ID|B25077_E001|B25077_M001")) {
        throw new Error("Census summary file format was not recognized.");
      }
      acsSummaryCache = { year, text, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
      return text;
    })().finally(() => {
      if (acsSummaryCachePromise?.year === year) acsSummaryCachePromise = undefined;
    });
    acsSummaryCachePromise = { year, promise };
  }
  return acsSummaryCachePromise.promise;
}

export function parseAcsSummaryValue(text: string, geoId: string): { value: number; marginOfError?: number } | undefined {
  const start = text.indexOf(`\n${geoId}|`);
  if (start < 0) return undefined;
  const end = text.indexOf("\n", start + 1);
  const [matchedGeoId, rawValue, rawMargin] = text.slice(start + 1, end < 0 ? undefined : end).split("|");
  const value = safeNumber(rawValue);
  if (matchedGeoId !== geoId || !value) return undefined;
  return { value, marginOfError: safeNumber(rawMargin) };
}

/**
 * Keyless official fallback. The table-based ACS Summary File is a public,
 * pipe-delimited Census data product. It is cached once per process and used
 * only after parcel evidence is insufficient, so normal parcel lookups do not
 * pay the download cost.
 */
async function fetchCensusSummaryBenchmark(normalized: NormalizedAddress | undefined): Promise<PropertyValuationEvidence | undefined> {
  if (!normalized?.census) return undefined;
  const configuredYear = (await getConfigValue("CENSUS_ACS_YEAR"))?.trim();
  const year = configuredYear && /^20\d{2}$/.test(configuredYear) ? configuredYear : DEFAULT_ACS_YEAR;
  const geoId = `1400000US${normalized.census.state}${normalized.census.county}${normalized.census.tract}`;
  const text = await loadAcsSummaryFile(year);
  const row = parseAcsSummaryValue(text, geoId);
  if (!row) return undefined;
  const { value, marginOfError: margin } = row;
  return {
    id: evidenceId(`census-summary:${year}:${geoId}:${value}`),
    kind: "CENSUS_MARKET",
    value,
    retrievedAt: new Date().toISOString(),
    sourceUrl: `https://www.census.gov/programs-surveys/acs/data/summary-file.html`,
    sourceLabel: `US Census ACS ${year} tract housing value`,
    reliability: 0.58,
    notes: `Median owner-occupied home value for the matched Census tract${margin ? ` (90% survey margin ±$${Math.round(margin).toLocaleString()})` : ""}; this is neighborhood context, not a parcel appraisal.`,
  };
}

export interface PublicRecordResponse {
  assessedValue?: number;
  estimatedValue?: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  propertyType?: string;
  yearBuilt?: number;
  sourceUrl?: string;
  sourceLabel?: string;
}

type PublicSourceFormat = "GENERIC_JSON" | "ARCGIS";
interface PublicRecordSource {
  label: string;
  endpoint: string;
  format: PublicSourceFormat;
  addressParam: string;
  addressField?: string;
  orderByField?: string;
  reliability: number;
  fieldMap?: Partial<Record<keyof PublicRecordResponse, string>>;
}

function safeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function safeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}
function safeYear(value: unknown): number | undefined {
  const year = safeNumber(value);
  return year && year >= 1700 && year <= new Date().getUTCFullYear() + 1 ? Math.round(year) : undefined;
}
function safeDate(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const raw = String(Math.trunc(value));
    if (/^(19|20)\d{6}$/.test(raw)) {
      const date = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00.000Z`);
      return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
    }
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  const text = safeText(value);
  if (!text) return undefined;
  if (/^(19|20)\d{6}$/.test(text)) {
    const date = new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
function getPath(input: unknown, path: string): unknown {
  let cursor = input;
  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = Array.isArray(cursor) ? cursor[Number(part)] : (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}
function findValue(input: unknown, aliases: string[]): unknown {
  if (!input || typeof input !== "object") return undefined;
  const wanted = new Set(aliases.map((item) => item.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const queue: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!current.value || typeof current.value !== "object" || current.depth > 2) continue;
    const entries = Array.isArray(current.value)
      ? current.value.map((value, index) => [String(index), value] as const)
      : Object.entries(current.value);
    for (const [key, value] of entries) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (wanted.has(normalized) && value !== null && value !== "") return value;
      if (typeof value === "object" && value !== null) queue.push({ value, depth: current.depth + 1 });
    }
  }
  return undefined;
}

const FIELD_ALIASES: Record<keyof PublicRecordResponse, string[]> = {
  assessedValue: ["assessedValue", "assessed_value", "total_assessed_value", "assd_total", "assessed_total", "taxable_value"],
  estimatedValue: ["estimatedValue", "estimated_value", "appraised_value", "total_value", "total_val", "marketValue", "market_val"],
  lastSalePrice: ["lastSalePrice", "last_sale_price", "last_sale_amount", "sale_price", "sale_amount", "sale_amt", "sales_price", "transfer_value", "consideration"],
  lastSaleDate: ["lastSaleDate", "last_sale_date", "sale_date", "transfer_date", "deed_date", "recording_date"],
  propertyType: ["propertyType", "property_type", "prop_type", "land_use", "use_description", "class_description"],
  yearBuilt: ["yearBuilt", "year_built", "built_year", "yr_built", "actual_year_built"],
  sourceUrl: ["sourceUrl", "source_url", "record_url", "property_url"],
  sourceLabel: ["sourceLabel", "source_label"],
};

function mapRecord(payload: unknown, source: PublicRecordSource): PublicRecordResponse {
  const root = source.format === "ARCGIS"
    ? ((payload as { features?: Array<{ attributes?: unknown }> })?.features?.[0]?.attributes ?? payload)
    : payload;
  const read = (key: keyof PublicRecordResponse) => {
    const configured = source.fieldMap?.[key];
    return configured ? getPath(root, configured) : findValue(root, FIELD_ALIASES[key]);
  };
  return {
    assessedValue: safeNumber(read("assessedValue")), estimatedValue: safeNumber(read("estimatedValue")),
    lastSalePrice: safeNumber(read("lastSalePrice")), lastSaleDate: safeDate(read("lastSaleDate")),
    propertyType: safeText(read("propertyType")), yearBuilt: safeYear(read("yearBuilt")),
    sourceUrl: safeText(read("sourceUrl")), sourceLabel: safeText(read("sourceLabel")),
  };
}

function allowedHosts(raw: string | undefined): Set<string> {
  return new Set([...CENSUS_HOSTS, ...(raw ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)]);
}
function validateSourceUrl(endpoint: string, hosts: Set<string>): URL {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("Public-record endpoints must use HTTPS.");
  if (!hosts.has(url.hostname.toLowerCase())) throw new Error(`Public-record host ${url.hostname} is not allowlisted.`);
  return url;
}

export function parsePublicRecordSources(raw: string | undefined, legacyEndpoint?: string): PublicRecordSource[] {
  const sources: PublicRecordSource[] = [];
  if (raw) {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("PROPERTY_PUBLIC_RECORD_SOURCES_JSON must be a JSON array.");
    for (const item of parsed.slice(0, MAX_PUBLIC_SOURCES)) {
      if (!item || typeof item !== "object") continue;
      const value = item as Record<string, unknown>;
      const endpoint = safeText(value.endpoint);
      if (!endpoint) continue;
      const format = value.format === "ARCGIS" ? "ARCGIS" : "GENERIC_JSON";
      const addressField = safeText(value.addressField);
      const orderByField = safeText(value.orderByField);
      if (format === "ARCGIS" && (!addressField || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(addressField))) {
        throw new Error("Every ArcGIS source needs a safe addressField name.");
      }
      if (orderByField && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(orderByField)) {
        throw new Error("ArcGIS orderByField must be a safe field name.");
      }
      const rawReliability = typeof value.reliability === "number" ? value.reliability : 0.74;
      sources.push({
        label: safeText(value.label) ?? `Public record source ${sources.length + 1}`, endpoint, format,
        addressParam: safeText(value.addressParam) ?? "address", addressField, orderByField,
        reliability: Math.min(0.9, Math.max(0.5, rawReliability)),
        fieldMap: value.fieldMap && typeof value.fieldMap === "object"
          ? value.fieldMap as PublicRecordSource["fieldMap"]
          : undefined,
      });
    }
  }
  if (legacyEndpoint && !sources.some((source) => source.endpoint === legacyEndpoint)) {
    sources.push({ label: "Configured public records", endpoint: legacyEndpoint, format: "GENERIC_JSON", addressParam: "address", reliability: 0.74 });
  }
  return sources.slice(0, MAX_PUBLIC_SOURCES);
}

/**
 * Read-only health check for the property-evidence lane. Arctic Shift is not
 * called here because Reddit discussion is not property evidence; the shared
 * public-data orchestrator runs this check beside Arctic Shift concurrently.
 */
export async function verifyPropertyEvidenceConnection(
  options: PropertyEvidenceConnectionOptions = {}
): Promise<PropertyEvidenceConnectionHealth> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = options.config ?? {
    braveKey: await getConfigValue("BRAVE_SEARCH_API_KEY"),
    censusKey: await getConfigValue("CENSUS_DATA_API_KEY"),
    censusYear: await getConfigValue("CENSUS_ACS_YEAR"),
    sourcesJson: await getConfigValue("PROPERTY_PUBLIC_RECORD_SOURCES_JSON"),
    legacyEndpoint: await getConfigValue("PROPERTY_PUBLIC_RECORD_ENDPOINT"),
    allowlist: await getConfigValue("PROPERTY_RECORD_ALLOWLIST"),
  };

  let configuredSources = 0;
  try {
    const sources = parsePublicRecordSources(config.sourcesJson, config.legacyEndpoint);
    const hosts = allowedHosts(config.allowlist);
    for (const source of sources) validateSourceUrl(source.endpoint, hosts);
    configuredSources = sources.length;
  } catch (error) {
    return {
      ok: false,
      message: `Property-record configuration is invalid: ${error instanceof Error ? error.message : "validation failed"}`,
    };
  }

  const checks: Array<{ label: string; run: () => Promise<boolean> }> = [
    {
      label: "US Census Geocoder",
      run: async () => {
        const response = await fetchImpl("https://geocoding.geo.census.gov/geocoder/benchmarks?format=json", {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
        });
        return response.ok;
      },
    },
    {
      label: "FHFA HPI",
      run: async () => {
        const response = await fetchImpl(FHFA_MASTER_JSON, {
          method: "GET",
          headers: { Accept: "application/json", Range: "bytes=0-0" },
          signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
        });
        await response.body?.cancel().catch(() => undefined);
        return response.ok;
      },
    },
    {
      label: "ArcGIS public catalog",
      run: async () => {
        const url = new URL("https://www.arcgis.com/sharing/rest/search");
        url.searchParams.set("f", "json");
        url.searchParams.set("num", "1");
        url.searchParams.set("q", 'parcel type:"Feature Service"');
        const response = await fetchImpl(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
        });
        return response.ok;
      },
    },
    {
      label: "Census ACS public summary file",
      run: async () => {
        const year = config.censusYear && /^20\d{2}$/.test(config.censusYear) ? config.censusYear : DEFAULT_ACS_YEAR;
        const url = `https://www2.census.gov/programs-surveys/acs/summary_file/${year}/table-based-SF/data/5YRData/acsdt5y${year}-b25077.dat`;
        const response = await fetchImpl(url, {
          headers: { Accept: "text/plain", Range: "bytes=0-63" },
          signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
        });
        await response.body?.cancel().catch(() => undefined);
        return response.ok;
      },
    },
  ];

  if (config.braveKey) {
    checks.push({
      label: "Brave Search",
      run: async () => {
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", "site:fhfa.gov house price index");
        url.searchParams.set("count", "1");
        const response = await fetchImpl(url, {
          headers: { Accept: "application/json", "X-Subscription-Token": config.braveKey! },
          signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
        });
        return response.ok;
      },
    });
  }

  if (config.censusKey) {
    checks.push({
      label: "Census ACS housing benchmark",
      run: async () => {
        const year = config.censusYear && /^20\d{2}$/.test(config.censusYear) ? config.censusYear : DEFAULT_ACS_YEAR;
        const url = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
        url.searchParams.set("get", "NAME,B25077_001E");
        url.searchParams.set("for", "us:*");
        url.searchParams.set("key", config.censusKey!);
        const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
        return response.ok && (response.headers.get("content-type") ?? "").includes("json");
      },
    });
  }

  const results = await Promise.allSettled(checks.map((check) => check.run()));
  const failed = results.flatMap((result, index) =>
    result.status === "fulfilled" && result.value ? [] : [checks[index].label]
  );
  if (failed.length > 0) {
    return { ok: false, message: `Property evidence unavailable: ${failed.join(", ")}.` };
  }

  const optional = [
    config.braveKey ? "Brave Search connected" : "Brave Search optional",
    config.censusKey ? "Census ACS direct API connected" : "keyless Census ACS summary fallback enabled",
    configuredSources > 0 ? `${configuredSources} allowlisted record source${configuredSources === 1 ? "" : "s"}` : "no local assessor source configured",
  ].join("; ");
  return { ok: true, message: `Census Geocoder and public ACS summary data, FHFA, and ArcGIS public catalog reachable; ${optional}.` };
}

interface BraveSearchResponse { web?: { results?: Array<{ url?: string }> } }

interface ArcGisCatalogItem { url?: string; title?: string; owner?: string; tags?: string[] }
interface ArcGisCatalogResponse { results?: ArcGisCatalogItem[] }

function normalizedServiceUrl(value: string): string | undefined {
  try {
    return new URL(value).toString()
      .replace(/\/query\/?$/i, "")
      .replace(/\/\d+\/?$/, "")
      .replace(/\/$/, "")
      .toLowerCase();
  } catch {
    return undefined;
  }
}

function rankConfiguredSources(sources: PublicRecordSource[], discoveredUrls: string[]): Map<string, number> {
  const ranking = new Map<string, number>();
  for (const [index, discoveredUrl] of discoveredUrls.entries()) {
    const discovered = normalizedServiceUrl(discoveredUrl);
    if (!discovered) continue;
    for (const source of sources) {
      const configured = normalizedServiceUrl(source.endpoint);
      if (!configured || ranking.has(source.endpoint)) continue;
      if (configured.startsWith(discovered) || discovered.startsWith(configured)) {
        ranking.set(source.endpoint, index);
      }
    }
  }
  return ranking;
}

async function searchArcGisCatalogItems(area: string): Promise<ArcGisCatalogItem[]> {
  // ArcGIS full-text ranking differs substantially by publisher. Three small
  // locality-only searches cover parcel maps, assessor datasets, and annual
  // tax-roll tables; schema inspection remains the compatibility gate.
  const terms = ["parcel", "assessor", '"tax roll"'];
  const responses = await Promise.allSettled(terms.map(async (term) => {
    const url = new URL("https://www.arcgis.com/sharing/rest/search");
    url.searchParams.set("f", "json");
    url.searchParams.set("num", "20");
    url.searchParams.set("q", `${area.slice(0, 100)} ${term} type:\"Feature Service\"`);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    const body = await response.json() as ArcGisCatalogResponse;
    return body.results ?? [];
  }));
  const merged = responses.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  return merged.filter((item, index, all) =>
    Boolean(item.url) && all.findIndex((candidate) => candidate.url === item.url) === index
  );
}

async function searchArcGisCatalog(area: string): Promise<string[]> {
  return (await searchArcGisCatalogItems(area)).flatMap((result) => result.url ? [result.url] : []);
}

interface ArcGisField { name?: string; alias?: string; type?: string }
interface ArcGisLayerMetadata { fields?: ArcGisField[] }
interface ArcGisServiceMetadata {
  layers?: Array<{ id?: number; name?: string }>;
  tables?: Array<{ id?: number; name?: string }>;
}

function normalizedFieldLabel(field: ArcGisField): string {
  return `${field.name ?? ""} ${field.alias ?? ""}`.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findArcGisField(fields: ArcGisField[], aliases: string[], numericOnly = false): string | undefined {
  const wanted = aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return fields.find((field) => {
    if (!field.name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name)) return false;
    if (numericOnly && !/Double|Integer|Single|SmallInteger/i.test(field.type ?? "")) return false;
    const label = normalizedFieldLabel(field);
    return wanted.some((alias) => label === alias || label.includes(alias));
  })?.name;
}

function safeHostedArcGisUrl(raw: string | undefined): URL | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !ARCGIS_HOST_PATTERN.test(url.hostname)) return undefined;
    if (!/\/rest\/services\/.+\/FeatureServer(?:\/\d+)?\/?$/i.test(url.pathname)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

async function arcGisLayerUrls(serviceUrl: URL): Promise<URL[]> {
  if (/\/FeatureServer\/\d+\/?$/i.test(serviceUrl.pathname)) return [serviceUrl];
  const metadataUrl = new URL(serviceUrl);
  metadataUrl.searchParams.set("f", "json");
  const response = await fetch(metadataUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return [];
  const metadata = await response.json() as ArcGisServiceMetadata;
  return [...(metadata.layers ?? []), ...(metadata.tables ?? [])]
    .filter((layer) => typeof layer.id === "number" && /parcel|assessor|property|tax|roll|assessment|cama|valuation/i.test(layer.name ?? ""))
    .slice(0, 3)
    .map((layer) => new URL(`${serviceUrl.toString().replace(/\/$/, "")}/${layer.id}`));
}

async function sourceFromArcGisLayer(item: ArcGisCatalogItem, layerUrl: URL): Promise<PublicRecordSource | undefined> {
  const metadataUrl = new URL(layerUrl);
  metadataUrl.searchParams.set("f", "json");
  const response = await fetch(metadataUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return undefined;
  const metadata = await response.json() as ArcGisLayerMetadata;
  const fields = metadata.fields ?? [];
  const addressField = findArcGisField(fields, [
    "situsfulladdress", "situsaddress", "situsaddr", "propertyaddress", "propertyaddr", "siteaddress", "siteaddr",
    "locationaddress", "propertylocation", "streetaddress", "fulladdress", "fulladdr", "physicaladdress", "phyaddr", "proploc", "address1", "address",
  ]);
  const assessedValue = findArcGisField(fields, [
    "totalassessedvalue", "assessedvalue", "totalassessment", "assdtotal", "assessedtotal", "totalassessed",
    "totalvalue", "totalval", "taxablevalue", "taxvalue", "landbuildingvalue",
  ], true);
  const estimatedValue = findArcGisField(fields, [
    "marketvalue", "marketval", "appraisedvalue", "appraisedval", "apprvalue", "apprval", "totalappraised",
    "totalmarketvalue", "justvalue", "justval", "propertyvalue", "propertyval",
  ], true);
  const lastSalePrice = findArcGisField(fields, [
    "lastsaleprice", "lastsaleamount", "lastsaleamt", "saleprice", "saleamount", "saleamt", "salesprice",
    "transfervalue", "consideration", "deedamount",
  ], true);
  if (!addressField || (!assessedValue && !estimatedValue && !lastSalePrice)) return undefined;
  return {
    label: `${item.title?.trim() || "ArcGIS public parcel records"}${item.owner ? ` (${item.owner})` : ""}`,
    endpoint: `${layerUrl.toString().replace(/\/$/, "")}/query`,
    format: "ARCGIS",
    addressParam: "address",
    addressField,
    orderByField: findArcGisField(fields, ["rollyear", "assessmentyear", "taxyear", "fiscalyear", "valuationyear", "fy"], true),
    reliability: 0.62,
    fieldMap: {
      assessedValue,
      estimatedValue,
      lastSalePrice,
      lastSaleDate: findArcGisField(fields, ["lastsaledate", "saledate", "saleDate", "transferdate", "deeddate"]),
      propertyType: findArcGisField(fields, ["propertytype", "proptype", "usetype", "usedescription", "landuse", "classdescription", "propertyclass"]),
      yearBuilt: findArcGisField(fields, ["yearbuilt", "builtyear", "yrbuilt", "actualyearbuilt"], true),
    },
  };
}

/**
 * Discovers only hosted ArcGIS FeatureServer layers and only retains layers
 * exposing both an address and recognized valuation/sale field. Arbitrary
 * search-result pages and non-ArcGIS hosts are never fetched.
 */
export async function discoverArcGisPropertySources(area: string): Promise<PublicRecordSource[]> {
  if (!area.trim()) return [];
  const items = (await searchArcGisCatalogItems(area)).filter((item) => {
    const descriptor = `${item.title ?? ""} ${(item.tags ?? []).join(" ")}`;
    return /parcel|assessor|property appraiser|tax roll|roll year|assessment|cama/i.test(descriptor) &&
      !/right of way|flood|zoning|planning|census block|school|environment/i.test(descriptor) &&
      Boolean(safeHostedArcGisUrl(item.url));
  }).sort((a, b) => {
    const score = (item: ArcGisCatalogItem) => /assessor|property appraiser|tax roll|roll year|assessment|cama/i.test(`${item.title ?? ""} ${(item.tags ?? []).join(" ")}`) ? 0 : 1;
    return score(a) - score(b);
  }).slice(0, 6);
  const perItem = await mapWithConcurrency(items, 3, async (item) => {
    const serviceUrl = safeHostedArcGisUrl(item.url);
    if (!serviceUrl) return [];
    const layers = await arcGisLayerUrls(serviceUrl).catch(() => []);
    const sources = await Promise.all(layers.map((layer) => sourceFromArcGisLayer(item, layer).catch(() => undefined)));
    return sources.filter((source): source is PublicRecordSource => Boolean(source));
  });
  return perItem.flat().filter((source, index, all) =>
    all.findIndex((candidate) => candidate.endpoint === source.endpoint) === index
  ).slice(0, 3);
}

async function searchBraveOfficialSources(area: string, sources: PublicRecordSource[], key: string): Promise<string[]> {
  const hosts = Array.from(new Set(sources.map((source) => new URL(source.endpoint).hostname)));
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", `"${area.slice(0, 120)}" (assessor OR parcel OR "property record") (${hosts.map((host) => `site:${host}`).join(" OR ")})`);
  url.searchParams.set("count", String(Math.min(20, Math.max(5, hosts.length * 2))));
  url.searchParams.set("country", "US");
  url.searchParams.set("search_lang", "en");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return [];
  const body = await response.json() as BraveSearchResponse;
  return (body.web?.results ?? []).flatMap((result) => result.url ? [result.url] : []);
}

async function prioritizeSourcesWithSearch(area: string, sources: PublicRecordSource[]): Promise<PublicRecordSource[]> {
  if (sources.length < 2) return sources;
  const key = await getConfigValue("BRAVE_SEARCH_API_KEY");
  const searches = await Promise.allSettled([
    searchArcGisCatalog(area),
    key ? searchBraveOfficialSources(area, sources, key) : Promise.resolve([]),
  ]);
  const arcGisUrls = searches[0].status === "fulfilled" ? searches[0].value : [];
  const braveUrls = searches[1].status === "fulfilled" ? searches[1].value : [];
  const arcGisRanking = rankConfiguredSources(sources, arcGisUrls);
  const braveHostRanking = new Map<string, number>();
  for (const [index, resultUrl] of braveUrls.entries()) {
    try {
      const host = new URL(resultUrl).hostname.toLowerCase();
      if (!braveHostRanking.has(host)) braveHostRanking.set(host, index);
    } catch {
      // Malformed search results are ignored and are never fetched directly.
    }
  }
  const missingRank = 1_000_000;
  return [...sources].sort((a, b) => {
    const aArc = arcGisRanking.get(a.endpoint) ?? missingRank;
    const bArc = arcGisRanking.get(b.endpoint) ?? missingRank;
    const aBrave = braveHostRanking.get(new URL(a.endpoint).hostname.toLowerCase()) ?? missingRank;
    const bBrave = braveHostRanking.get(new URL(b.endpoint).hostname.toLowerCase()) ?? missingRank;
    return Math.min(aArc * 2, aBrave * 2 + 1) - Math.min(bArc * 2, bBrave * 2 + 1);
  });
}

function sourceEvidence(source: PublicRecordSource, url: URL, record: PublicRecordResponse): PropertyValuationEvidence[] {
  const evidence: PropertyValuationEvidence[] = [];
  const retrievedAt = new Date().toISOString();
  const label = record.sourceLabel ?? source.label;
  // Never render an arbitrary URL supplied inside provider data. The endpoint
  // itself already passed the strict host allowlist and carries no borrower
  // query parameters in this canonical evidence link.
  const sourceUrl = `${url.origin}${url.pathname}`;
  if (record.assessedValue) evidence.push({
    id: evidenceId(`${label}:assessor:${record.assessedValue}`), kind: "ASSESSOR", value: record.assessedValue,
    retrievedAt, sourceUrl, sourceLabel: label, reliability: source.reliability,
  });
  if (record.lastSalePrice) evidence.push({
    id: evidenceId(`${label}:sale:${record.lastSalePrice}:${record.lastSaleDate ?? ""}`), kind: "RECORDED_SALE",
    value: record.lastSalePrice, observedAt: record.lastSaleDate, retrievedAt, sourceUrl, sourceLabel: label,
    reliability: Math.min(0.92, source.reliability + 0.08),
  });
  if (record.estimatedValue) evidence.push({
    id: evidenceId(`${label}:estimate:${record.estimatedValue}`), kind: "PUBLIC_RECORD", value: record.estimatedValue,
    retrievedAt, sourceUrl, sourceLabel: label, reliability: Math.max(0.55, source.reliability - 0.04),
  });
  return evidence;
}

async function fetchPublicSource(source: PublicRecordSource, address: string, streetAddress: string, hosts: Set<string>): Promise<{ record: PublicRecordResponse; evidence: PropertyValuationEvidence[] } | undefined> {
  const url = validateSourceUrl(source.endpoint, hosts);
  if (source.format === "ARCGIS") {
    const escaped = streetAddress.replace(/'/g, "''");
    url.searchParams.set("where", `UPPER(${source.addressField}) LIKE UPPER('%${escaped}%')`);
    url.searchParams.set("outFields", "*");
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultRecordCount", "5");
    if (source.orderByField) url.searchParams.set("orderByFields", `${source.orderByField} DESC`);
    url.searchParams.set("f", "json");
  } else {
    url.searchParams.set(source.addressParam, address);
  }
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${source.label} returned HTTP ${response.status}.`);
  const record = mapRecord(await response.json() as unknown, source);
  const evidence = sourceEvidence(source, url, record);
  return evidence.length > 0 || record.propertyType || record.yearBuilt ? { record, evidence } : undefined;
}

interface FhfaRow { [key: string]: unknown }
let fhfaCache: { expiresAt: number; rows: FhfaRow[] } | undefined;
function rowsFromFhfaPayload(payload: unknown): FhfaRow[] {
  if (Array.isArray(payload)) return payload.filter((row): row is FhfaRow => Boolean(row && typeof row === "object"));
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "results", "rows"]) {
    const value = (payload as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value.filter((row): row is FhfaRow => Boolean(row && typeof row === "object"));
  }
  return [];
}
async function getFhfaRows(): Promise<FhfaRow[]> {
  if (fhfaCache && fhfaCache.expiresAt > Date.now()) return fhfaCache.rows;
  const response = await fetch(FHFA_MASTER_JSON, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`FHFA returned HTTP ${response.status}.`);
  const rows = rowsFromFhfaPayload(await response.json());
  if (rows.length === 0) throw new Error("FHFA returned no index rows.");
  fhfaCache = { rows, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
  return rows;
}
function field(row: FhfaRow, aliases: string[]): unknown {
  const keys = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), value]));
  for (const alias of aliases) {
    const value = keys.get(alias.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (value !== undefined) return value;
  }
  return undefined;
}

export function findFhfaAdjustment(rows: FhfaRow[], stateCode: string, saleDate: string, salePrice: number): number | undefined {
  const sale = new Date(saleDate);
  if (!Number.isFinite(sale.getTime()) || salePrice <= 0) return undefined;
  const saleYear = sale.getUTCFullYear();
  const saleQuarter = Math.floor(sale.getUTCMonth() / 3) + 1;
  const stateRows = rows.map((row) => ({
    level: String(field(row, ["level", "geography_type", "geo_type"]) ?? "").toLowerCase(),
    place: String(field(row, ["place_id", "state", "state_code", "place_name"]) ?? "").toUpperCase(),
    type: String(field(row, ["hpi_type", "type"]) ?? "").toLowerCase(),
    flavor: String(field(row, ["hpi_flavor", "flavor"]) ?? "").toLowerCase(),
    frequency: String(field(row, ["frequency", "freq"]) ?? "").toLowerCase(),
    year: Number(field(row, ["yr", "year"])), period: Number(field(row, ["period", "quarter", "qtr"])),
    index: safeNumber(field(row, ["index_nsa", "index", "hpi", "value"])),
  })).filter((item) =>
    item.place === stateCode.toUpperCase() && (!item.level || item.level.includes("state")) &&
    (!item.type || item.type.includes("purchase")) && (!item.flavor || item.flavor.includes("all") || item.flavor.includes("purchase")) &&
    (!item.frequency || item.frequency.startsWith("quarter")) && Number.isFinite(item.year) && item.index
  ).sort((a, b) => a.year - b.year || a.period - b.period);
  const start = stateRows.filter((item) => item.year < saleYear || (item.year === saleYear && item.period <= saleQuarter)).at(-1);
  const end = stateRows.at(-1);
  if (!start?.index || !end?.index || start.index <= 0 || end.index <= 0) return undefined;
  return Math.round((salePrice * end.index) / start.index / 1000) * 1000;
}

async function addFhfaAdjustment(input: PropertyValuationInput, records: PublicRecordResponse[], evidence: PropertyValuationEvidence[]) {
  const sale = records.filter((record) => record.lastSalePrice && record.lastSaleDate)
    .sort((a, b) => new Date(b.lastSaleDate!).getTime() - new Date(a.lastSaleDate!).getTime())[0];
  if (!sale?.lastSalePrice || !sale.lastSaleDate) return;
  let adjusted: number | undefined;
  try {
    adjusted = findFhfaAdjustment(await getFhfaRows(), input.stateCode, sale.lastSaleDate, sale.lastSalePrice);
  } catch (error) {
    console.warn(`[property-evidence] live FHFA dataset unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (!adjusted) {
    const raw = await getConfigValue("FHFA_HPI_INDEX_JSON");
    if (raw) {
      try {
        const series = JSON.parse(raw) as Record<string, Record<string, number>>;
        const state = series[input.stateCode];
        const saleYear = String(new Date(sale.lastSaleDate).getUTCFullYear());
        const currentYear = String(new Date().getUTCFullYear());
        const start = state?.[saleYear], end = state?.[currentYear];
        if (start && end && start > 0 && end > 0) adjusted = Math.round((sale.lastSalePrice * end) / start / 1000) * 1000;
      } catch {
        console.error("[property-evidence] FHFA_HPI_INDEX_JSON is invalid JSON; configured fallback skipped.");
      }
    }
  }
  if (!adjusted) return;
  evidence.push({
    id: evidenceId(`fhfa:${input.stateCode}:${sale.lastSaleDate}:${adjusted}`), kind: "FHFA_HPI", value: adjusted,
    observedAt: sale.lastSaleDate, retrievedAt: new Date().toISOString(), sourceUrl: "https://www.fhfa.gov/house-price-index",
    sourceLabel: "FHFA House Price Index", reliability: 0.88,
    notes: "Recorded sale time-adjusted with the official state index; contextual evidence, not a property comparable.",
  });
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
  const independentSources = new Set(independent.map((item) => item.sourceLabel));
  if (independentSources.size < 1) return undefined;
  const weight = values.reduce((sum, item) => sum + item.reliability, 0);
  const estimate = Math.round(values.reduce((sum, item) => sum + item.value! * item.reliability, 0) / weight / 1000) * 1000;
  const dispersion = Math.max(...values.map((item) => Math.abs(item.value! - estimate) / estimate));
  const newestAgeDays = Math.min(...values.map((item) => Math.max(0, (Date.now() - new Date(item.observedAt ?? item.retrievedAt).getTime()) / 86_400_000)));
  const contextualOnly = independent.every((item) => item.kind === "CENSUS_MARKET");
  const confidence = !contextualOnly && independentSources.size >= 3 && dispersion <= 0.12 && newestAgeDays <= 365
    ? "HIGH" : !contextualOnly && independentSources.size >= 2 && dispersion <= 0.22 ? "MEDIUM" : "LOW";
  const spread = Math.round(estimate * (confidence === "HIGH" ? 0.06 : confidence === "MEDIUM" ? 0.1 : contextualOnly ? 0.22 : 0.16));
  const { balance, supplied: balanceSupplied } = reportedBalance(input);
  return {
    estimatedValue: estimate, confidenceLow: Math.max(0, estimate - spread), confidenceHigh: estimate + spread,
    comparableCount: independentSources.size, lastSaleDate: record?.lastSaleDate, lastSalePrice: record?.lastSalePrice,
    estimatedMortgageBalance: balance, propertyType: propertyType(record?.propertyType), yearBuilt: record?.yearBuilt ?? 0,
    estimatedLTV: balance ? Math.round((balance / estimate) * 1000) / 10 : 0, usableEquity: balance ? Math.max(0, estimate - balance) : 0,
    simulated: false,
    provenance: {
      estimatedValue: contextualOnly ? "MODELED" : "MEASURED", confidenceRange: "MODELED", comparableCount: "MEASURED", lastSale: record?.lastSalePrice ? "MEASURED" : "MODELED",
      estimatedMortgageBalance: balanceSupplied ? "MEASURED" : "MODELED", estimatedLTV: "MODELED", usableEquity: "MODELED",
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
    const { balance, supplied: balanceSupplied } = reportedBalance(input);
    return {
      estimatedValue: data.price, confidenceLow: data.priceRangeLow ?? Math.round(data.price * 0.94),
      confidenceHigh: data.priceRangeHigh ?? Math.round(data.price * 1.06), comparableCount: data.comparables?.length ?? 0,
      lastSaleDate: subject?.lastSaleDate, lastSalePrice: subject?.lastSalePrice, estimatedMortgageBalance: balance,
      propertyType: propertyType(subject?.propertyType), yearBuilt: subject?.yearBuilt ?? 0,
      estimatedLTV: balance ? Math.round((balance / data.price) * 1000) / 10 : 0, usableEquity: balance ? Math.max(0, data.price - balance) : 0,
      simulated: false,
      provenance: {
        estimatedValue: "MEASURED", confidenceRange: data.priceRangeLow ? "MEASURED" : "MODELED", comparableCount: "MEASURED",
        lastSale: subject?.lastSalePrice ? "MEASURED" : "MODELED", estimatedMortgageBalance: balanceSupplied ? "MEASURED" : "MODELED",
        estimatedLTV: "MODELED", usableEquity: "MODELED", propertyType: subject?.propertyType ? "MEASURED" : "MODELED",
        yearBuilt: subject?.yearBuilt ? "MEASURED" : "MODELED",
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
  const rawAddress = input.addressLine1
    ? `${input.addressLine1}, ${input.city ?? ""}, ${input.stateCode}${input.postalCode ? ` ${input.postalCode}` : ""}`.trim()
    : "";
  try {
    const [normalized, allowlistValue, sourcesJson, legacyEndpoint] = await Promise.all([
      normalizeWithCensus(input),
      getConfigValue("PROPERTY_RECORD_ALLOWLIST"),
      getConfigValue("PROPERTY_PUBLIC_RECORD_SOURCES_JSON"),
      getConfigValue("PROPERTY_PUBLIC_RECORD_ENDPOINT"),
    ]);
    if (normalized) evidence.push(normalized.evidence);
    const address = normalized?.formatted ?? rawAddress;
    const allowlist = allowedHosts(allowlistValue);
    const configuredSources = parsePublicRecordSources(sourcesJson, legacyEndpoint);
    for (const source of configuredSources) validateSourceUrl(source.endpoint, allowlist);
    const searchArea = [input.city, input.stateCode].filter(Boolean).join(" ");
    const [orderedConfigured, discoveredSources, censusBenchmark] = await Promise.all([
      address ? prioritizeSourcesWithSearch(searchArea || input.stateCode, configuredSources) : Promise.resolve([]),
      address ? discoverArcGisPropertySources(searchArea || input.stateCode).catch(() => []) : Promise.resolve([]),
      fetchCensusHousingBenchmark(input, normalized).catch(() => undefined),
    ]);
    if (censusBenchmark) evidence.push(censusBenchmark);
    const discoveredHosts = discoveredSources.flatMap((source) => {
      try { return [new URL(source.endpoint).hostname.toLowerCase()]; } catch { return []; }
    });
    const queryHosts = new Set([...allowlist, ...discoveredHosts.filter((host) => ARCGIS_HOST_PATTERN.test(host))]);
    const orderedSources = [...orderedConfigured, ...discoveredSources]
      .filter((source, index, all) => all.findIndex((item) => item.endpoint === source.endpoint) === index)
      .slice(0, MAX_PUBLIC_SOURCES);
    const results = await mapWithConcurrency(orderedSources, 3, async (source) => {
      try {
        return await fetchPublicSource(source, address, input.addressLine1 ?? address, queryHosts);
      } catch (error) {
        console.warn(`[property-evidence] ${source.label} failed: ${error instanceof Error ? error.message : "unknown error"}`);
        return undefined;
      }
    });
    const successful = results.filter((result): result is NonNullable<typeof result> => Boolean(result));
    const records = successful.map((result) => result.record);
    for (const result of successful) evidence.push(...result.evidence);
    await addFhfaAdjustment(input, records, evidence);
    const richestRecord = records.sort((a, b) => Object.values(b).filter(Boolean).length - Object.values(a).filter(Boolean).length)[0];
    const open = buildOpenEvidenceValuation(input, evidence, richestRecord);
    if (open) return open;
    // The keyless official summary file is intentionally last in the free
    // lane: it is a tract benchmark, not parcel evidence, and its first use
    // downloads a cached table. It still yields an honest planning range when
    // no county record or API-key lookup is available.
    const summaryBenchmark = await fetchCensusSummaryBenchmark(normalized).catch((error) => {
      console.warn(`[property-evidence] Census summary fallback failed: ${error instanceof Error ? error.message : "unknown error"}`);
      return undefined;
    });
    if (summaryBenchmark) {
      evidence.push(summaryBenchmark);
      const contextual = buildOpenEvidenceValuation(input, evidence, richestRecord);
      if (contextual) return contextual;
    }
  } catch (error) {
    console.error(`[property-evidence] free chain failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
  return fetchRentCast(input, evidence);
}
