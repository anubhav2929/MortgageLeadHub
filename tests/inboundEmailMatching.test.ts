import { describe, expect, it } from "vitest";
import { matchInboundEmailToPerson } from "@/domain/inboundEmail";
import type { Lead, Person } from "@/domain/types";

const lead = (id: string, publicRef: string) => ({ id, publicRef }) as Lead;
const person = (id: string, leadId: string, email: string): Person => ({
  id,
  leadId,
  role: "PRIMARY",
  firstName: "Test",
  lastName: "Borrower",
  phoneE164: "+13165550123",
  email,
  preferredContactWindow: "ANY",
  timezone: "America/Chicago",
});

describe("matchInboundEmailToPerson", () => {
  it("uses the per-lead alias to disambiguate two inquiries for the same borrower", () => {
    const result = matchInboundEmailToPerson({
      fromEmail: "Borrower <borrower@example.com>",
      toEmails: ["replies+ref_two@reply.example.com"],
      leads: [lead("lead-one", "ref_one"), lead("lead-two", "ref_two")],
      people: [
        person("person-one", "lead-one", "borrower@example.com"),
        person("person-two", "lead-two", "borrower@example.com"),
      ],
    });

    expect(result.person?.id).toBe("person-two");
  });

  it("does not treat knowledge of a public lead alias as sender authentication", () => {
    const result = matchInboundEmailToPerson({
      fromEmail: "attacker@example.net",
      toEmails: ["replies+ref_one@reply.example.com"],
      leads: [lead("lead-one", "ref_one")],
      people: [person("person-one", "lead-one", "borrower@example.com")],
    });

    expect(result.person).toBeUndefined();
    expect(result.reason).toBe("unknown_sender");
  });

  it("falls back to one unique saved sender when no alias is present", () => {
    const result = matchInboundEmailToPerson({
      fromEmail: "borrower@example.com",
      leads: [lead("lead-one", "ref_one")],
      people: [person("person-one", "lead-one", "borrower@example.com")],
    });

    expect(result.person?.id).toBe("person-one");
  });
});
