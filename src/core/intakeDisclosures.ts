import type { ConsentScope, DisclosureVersion } from "@/domain/types";

interface DisclosureStore {
  disclosures: Map<string, DisclosureVersion>;
}

/**
 * Stable disclosure families used by the public intake. The family key does
 * not contain a version number: Admin/Compliance can publish v2, v3, etc.
 * without changing application code or breaking historical consent evidence.
 */
export const INTAKE_DISCLOSURE_KEYS = {
  CONTACT_VOICE: "contact_voice",
  CONTACT_SMS: "contact_sms",
  CONTACT_EMAIL: "contact_email",
  RECORDING: "call_recording",
} as const satisfies Record<Extract<ConsentScope, "CONTACT_VOICE" | "CONTACT_SMS" | "CONTACT_EMAIL" | "RECORDING">, string>;

export const CURRENT_INTAKE_DISCLOSURES = {
  CONTACT_VOICE: {
    id: "disc_contact_voice_v1",
    key: INTAKE_DISCLOSURE_KEYS.CONTACT_VOICE,
    bodyText:
      "By checking this box, I agree to receive calls from Equity Flow Group about the mortgage refinance or home-equity inquiry I submitted, including calls made using an automated dialing system, an artificial or prerecorded voice, or an AI voice assistant. Calls may be recorded for quality and compliance purposes. Consent is not a condition of obtaining goods or services, and I may request a human representative at any time.",
  },
  CONTACT_SMS: {
    id: "disc_contact_sms_v1_10dlc",
    key: INTAKE_DISCLOSURE_KEYS.CONTACT_SMS,
    bodyText:
      "By checking this box, I agree to receive recurring informational and marketing text messages from Equity Flow Group about the mortgage refinance or home-equity inquiry I submitted, including requested follow-ups, answers to my questions, and callback confirmations or reminders. Messages may be sent using an automated system. Message frequency varies. Message and data rates may apply. Consent is not a condition of obtaining goods or services. Reply STOP to opt out or HELP for help. Privacy Policy: https://www.equityflowgroup.com/privacy. Terms: https://www.equityflowgroup.com/terms.",
  },
  CONTACT_EMAIL: {
    id: "disc_contact_email_v1",
    key: INTAKE_DISCLOSURE_KEYS.CONTACT_EMAIL,
    bodyText:
      "By checking this box, I agree to receive email communications from Equity Flow Group about the mortgage refinance or home-equity inquiry I submitted. Consent is not a condition of obtaining goods or services, and I may unsubscribe at any time.",
  },
  RECORDING: {
    id: "disc_call_recording_v1",
    key: INTAKE_DISCLOSURE_KEYS.RECORDING,
    bodyText:
      "Calls may be recorded and may include an AI voice assistant for quality, training, and compliance purposes. I may request a human representative at any time.",
  },
} as const;

export type IntakeDisclosureScope = keyof typeof CURRENT_INTAKE_DISCLOSURES;

export interface PublicIntakeDisclosure {
  id: string;
  key: string;
  version: number;
  bodyText: string;
}

const RELEASE_EFFECTIVE_AT = "2026-08-29T00:00:00.000Z";

/**
 * Additive release migration. It never deletes or rewrites historical
 * disclosure/consent rows. The legacy version remains available as evidence;
 * only the live family used for new submissions changes.
 */
export function ensureCurrentIntakeDisclosures(db: DisclosureStore): void {
  for (const value of Object.values(CURRENT_INTAKE_DISCLOSURES)) {
    if (db.disclosures.has(value.id)) continue;
    db.disclosures.set(value.id, {
      ...value,
      version: 1,
      effectiveFrom: RELEASE_EFFECTIVE_AT,
      approvedBy: "System release — 10DLC consent alignment",
      approvedAt: RELEASE_EFFECTIVE_AT,
      status: "APPROVED",
    });
  }
}

function newestApproved(db: DisclosureStore, key: string): DisclosureVersion | undefined {
  return Array.from(db.disclosures.values())
    .filter((item) => item.key === key && item.status === "APPROVED")
    .sort((left, right) => right.version - left.version || right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
}

/** Returns the exact versions displayed and captured for a new intake. */
export function resolveActiveIntakeDisclosures(db: DisclosureStore): Record<IntakeDisclosureScope, PublicIntakeDisclosure> {
  ensureCurrentIntakeDisclosures(db);
  return Object.fromEntries(
    (Object.keys(CURRENT_INTAKE_DISCLOSURES) as IntakeDisclosureScope[]).map((scope) => {
      const configured = CURRENT_INTAKE_DISCLOSURES[scope];
      const active = newestApproved(db, configured.key) ?? db.disclosures.get(configured.id)!;
      return [scope, { id: active.id, key: active.key, version: active.version, bodyText: active.bodyText }];
    })
  ) as Record<IntakeDisclosureScope, PublicIntakeDisclosure>;
}
