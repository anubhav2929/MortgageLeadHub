import type { Lead, PropertyValuationResult } from "@/domain/types";

export interface PropertyClarification {
  id: string;
  question: string;
  reason: string;
}

/** Legacy demo estimates must never survive as cached lead data. */
export function isReusablePropertyValuation(valuation: PropertyValuationResult | undefined): boolean {
  return Boolean(valuation && !valuation.simulated && valuation.method !== "SIMULATED");
}

/**
 * Turns missing or conflicting property evidence into specific questions an
 * officer can ask. These are deterministic data-quality prompts, not lending
 * advice and not model-generated facts.
 */
export function propertyClarifications(
  lead: Pick<Lead, "addressLine1" | "city" | "stateCode" | "postalCode" | "estimatedValue" | "currentBalance">,
  valuation: PropertyValuationResult
): PropertyClarification[] {
  const questions: PropertyClarification[] = [];
  const add = (id: string, question: string, reason: string) => questions.push({ id, question, reason });

  if (!lead.addressLine1?.trim()) {
    add("street", "What is the property’s full street address?", "A street address is required to match assessor and parcel records reliably.");
  }
  if (!lead.city?.trim()) {
    add("city", "Which city is the property in?", "City is needed to disambiguate similarly named streets.");
  }
  if (!lead.postalCode?.trim()) {
    add("postal", "What is the property ZIP code?", "ZIP code improves Census normalization and county-source matching.");
  }
  if (!lead.estimatedValue) {
    add("borrower-value", "What does the borrower believe the property is worth today?", "The borrower estimate is retained as its own evidence source and is never silently treated as verified.");
  } else if (valuation.method !== "INSUFFICIENT_EVIDENCE" && valuation.estimatedValue > 0) {
    const difference = Math.abs(lead.estimatedValue - valuation.estimatedValue) / valuation.estimatedValue;
    if (difference >= 0.2) {
      add(
        "value-conflict",
        "Has the property been renovated, damaged, or changed since the latest public record?",
        "The borrower estimate differs from the evidence-based range by at least 20%."
      );
    }
  }
  if (lead.currentBalance === undefined) {
    add("balance", "What is the current first-mortgage payoff or approximate balance?", "Public valuation providers do not verify private outstanding loan balances.");
  }
  if (valuation.provenance.propertyType === "MODELED") {
    add("property-type", "Is this a single-family home, condo, townhome, or multi-family property?", "The property type was not verified by a source.");
  }
  if (valuation.yearBuilt <= 0 || valuation.provenance.yearBuilt === "MODELED") {
    add("year-built", "Approximately what year was the property built?", "Year built was not verified by a source and can improve comparable selection.");
  }
  if (
    valuation.method === "INSUFFICIENT_EVIDENCE" &&
    !(valuation.evidence ?? []).some((item) => item.kind === "RECORDED_SALE")
  ) {
    add("purchase", "When was the property purchased, and what was the purchase price?", "No recorded-sale evidence was available for time adjustment.");
  }

  return questions;
}
