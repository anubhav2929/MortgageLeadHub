// Simplified state -> IANA timezone default map, used the same way the real
// system would: resolve from property state code, per SPEC.md F-01 step 5c.
// Not exhaustive (states spanning multiple zones use their majority zone).

export const STATE_TIMEZONE: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Denver",
  IL: "America/Chicago",
  IN: "America/New_York",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/New_York",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
};

// Priority states first (primary ad spend per 2026-07-28 call with Aldrish),
// deprioritized states after — this order drives the intake form's state
// picker so higher-intent markets sort to the top. NV and SC added per the
// July 2026 Equity Flow Group business plan, which licenses them but they
// hadn't been added to the intake form yet.
export const STATE_NAMES: Record<string, string> = {
  CA: "California",
  FL: "Florida",
  IL: "Illinois",
  NY: "New York",
  OR: "Oregon",
  TX: "Texas",
  NV: "Nevada",
  SC: "South Carolina",
  AZ: "Arizona",
  CO: "Colorado",
  GA: "Georgia",
  NC: "North Carolina",
  OH: "Ohio",
  PA: "Pennsylvania",
  WA: "Washington",
};

// Ad-spend priority (marketing allocation decision from the 2026-07-28 call)
// — drives intake form ordering only. Distinct from LICENSING_PRIORITY_STATES
// below, which is a separate compliance-scoring concept; the two lists
// happen to overlap partially but come from different business decisions
// and should not be conflated.
export const PRIORITY_STATES = new Set(["CA", "FL", "IL", "NY", "OR", "TX"]);

// Compliance-scoring priority states (S_Compliance in the lead quality
// score) per the Equity Flow Group business plan, July 2026. A lead in one
// of these states scores the full 20 compliance points; any other licensed
// state scores 10; a state we're not licensed in at all scores 0 and should
// be routed to an external partner rather than worked in-house.
export const LICENSING_PRIORITY_STATES = new Set(["CA", "TX", "FL", "NV", "NY", "SC"]);
