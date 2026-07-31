// Officer eligibility + assignment — SPEC.md F-08.

import type { LoanIntent, Officer } from "@/domain/types";

export interface RoutingInput {
  propertyStateCode: string;
  intent: LoanIntent;
  nowLocalHour: number;
  lastAssignedAtByOfficer: Record<string, number>; // officerId -> epoch ms, 0 if never
}

export function isEligible(officer: Officer, input: RoutingInput): boolean {
  if (!officer.isActive) return false;
  if (!officer.licensedStates.includes(input.propertyStateCode)) return false;
  if (!officer.productTypes.includes(input.intent)) return false;
  if (officer.currentLoad >= officer.dailyCapacity) return false;
  if (input.nowLocalHour < officer.activeHoursStart || input.nowLocalHour >= officer.activeHoursEnd) return false;
  return true;
}

export function selectOfficer(officers: Officer[], input: RoutingInput): Officer | null {
  const eligible = officers.filter((o) => isEligible(o, input));
  if (eligible.length === 0) return null;

  return [...eligible].sort((a, b) => {
    if (a.currentLoad !== b.currentLoad) return a.currentLoad - b.currentLoad;
    const aLast = input.lastAssignedAtByOfficer[a.id] ?? 0;
    const bLast = input.lastAssignedAtByOfficer[b.id] ?? 0;
    if (aLast !== bLast) return aLast - bLast; // longest since last assignment first
    return a.id.localeCompare(b.id);
  })[0];
}
