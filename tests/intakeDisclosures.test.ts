import { describe, expect, it } from "vitest";
import {
  CURRENT_INTAKE_DISCLOSURES,
  resolveActiveIntakeDisclosures,
} from "@/core/intakeDisclosures";
import type { Database } from "@/domain/store";
import type { DisclosureVersion } from "@/domain/types";

function databaseWith(disclosures: DisclosureVersion[] = []): Database {
  return { disclosures: new Map(disclosures.map((item) => [item.id, item])) } as unknown as Database;
}

describe("intake disclosure resolution", () => {
  it("installs the current 10DLC-aligned disclosure families additively", () => {
    const legacy: DisclosureVersion = {
      id: "disc_tcpa_sms_v3",
      key: "tcpa_sms_v3",
      version: 3,
      bodyText: "historical text",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      approvedBy: "Compliance",
      approvedAt: "2026-01-01T00:00:00.000Z",
      status: "APPROVED",
    };
    const db = databaseWith([legacy]);

    const active = resolveActiveIntakeDisclosures(db);

    expect(active.CONTACT_SMS.bodyText).toBe(CURRENT_INTAKE_DISCLOSURES.CONTACT_SMS.bodyText);
    expect(db.disclosures.get(legacy.id)).toEqual(legacy);
    expect(active.CONTACT_SMS.bodyText).toContain("informational and marketing");
    expect(active.CONTACT_SMS.bodyText).toContain("Reply STOP");
    expect(active.CONTACT_SMS.bodyText).toContain("https://www.equityflowgroup.com/privacy");
  });

  it("uses a later Admin-approved version from the stable disclosure family", () => {
    const db = databaseWith();
    resolveActiveIntakeDisclosures(db);
    db.disclosures.set("disc_contact_sms_v2", {
      id: "disc_contact_sms_v2",
      key: "contact_sms",
      version: 2,
      bodyText: "Reviewed v2 SMS disclosure",
      effectiveFrom: "2026-08-30T00:00:00.000Z",
      approvedBy: "Compliance Admin",
      approvedAt: "2026-08-30T00:00:00.000Z",
      status: "APPROVED",
    });

    expect(resolveActiveIntakeDisclosures(db).CONTACT_SMS).toMatchObject({
      id: "disc_contact_sms_v2",
      version: 2,
      bodyText: "Reviewed v2 SMS disclosure",
    });
  });
});
