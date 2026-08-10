import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Executable architecture. The layering described in ARCHITECTURE.md is only
// real if something enforces it — otherwise the first "quick fix" that
// imports the database into a pure function erodes it, and nobody notices
// until the core is no longer testable without a running Postgres.
//
// Layers, innermost first:
//   core/     pure business rules — no I/O, no framework, no vendor SDKs
//   domain/   entities, persistence, server actions (may use core)
//   adapters/ the ONLY place a third-party vendor SDK or HTTP client lives
//   app/      Next.js routes and pages
//   components/ React UI

const SRC = join(process.cwd(), "src");

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every module specifier this file imports from, including `import type`. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  const pattern = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]);
  return specifiers;
}

const coreFiles = filesUnder(join(SRC, "core"));
const rel = (f: string) => relative(SRC, f);

describe("core/ stays pure", () => {
  it("has files to check, so a broken glob can't make this suite vacuous", () => {
    expect(coreFiles.length).toBeGreaterThan(8);
  });

  it("never imports from an outer layer", () => {
    const violations: string[] = [];
    for (const file of coreFiles) {
      for (const spec of importsOf(file)) {
        if (/^@\/(adapters|app|components|lib)\//.test(spec)) {
          violations.push(`${rel(file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("depends on domain/ only for type declarations, never for behaviour", () => {
    // core/ legitimately needs the shared entity types and the state
    // reference tables. What it must not do is call into domain logic —
    // that would invert the dependency direction.
    const ALLOWED_DOMAIN_MODULES = ["@/domain/types", "@/domain/stateTimezone"];
    const violations: string[] = [];
    for (const file of coreFiles) {
      for (const spec of importsOf(file)) {
        if (spec.startsWith("@/domain/") && !ALLOWED_DOMAIN_MODULES.includes(spec)) {
          violations.push(`${rel(file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("never imports Next.js — it must run in any JavaScript runtime", () => {
    const violations: string[] = [];
    for (const file of coreFiles) {
      for (const spec of importsOf(file)) {
        if (spec === "next" || spec.startsWith("next/") || spec === "react") {
          violations.push(`${rel(file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("never imports a database or filesystem module", () => {
    // This is what keeps the ~195 core tests running in under a second with
    // no fixtures, no mocks, and no test database.
    const FORBIDDEN = ["pg", "node:fs", "fs", "node:fs/promises", "@vercel/postgres"];
    const violations: string[] = [];
    for (const file of coreFiles) {
      for (const spec of importsOf(file)) {
        if (FORBIDDEN.includes(spec)) violations.push(`${rel(file)} → ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("never imports a vendor SDK — those belong in adapters/", () => {
    const VENDORS = ["twilio", "telnyx", "resend", "@anthropic-ai/sdk", "openai", "@vapi-ai/server-sdk"];
    const violations: string[] = [];
    for (const file of coreFiles) {
      for (const spec of importsOf(file)) {
        if (VENDORS.some((v) => spec === v || spec.startsWith(`${v}/`))) {
          violations.push(`${rel(file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("does not read process.env directly, except where the root key is bootstrapped", () => {
    // secretBox is the one deliberate exception: CREDENTIAL_SECRET cannot
    // come from the credential store it exists to decrypt.
    const EXEMPT = ["core/secretBox.ts"];
    const violations = coreFiles
      .filter((f) => !EXEMPT.includes(rel(f)))
      .filter((f) => readFileSync(f, "utf8").includes("process.env"))
      .map(rel);
    expect(violations).toEqual([]);
  });
});

describe("layer boundaries elsewhere", () => {
  it("keeps React out of the domain layer", () => {
    const violations: string[] = [];
    for (const file of filesUnder(join(SRC, "domain"))) {
      for (const spec of importsOf(file)) {
        if (spec === "react" || spec.startsWith("react/") || spec.startsWith("@/components/")) {
          violations.push(`${rel(file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps components out of adapters — an adapter is I/O, not UI", () => {
    const violations: string[] = [];
    for (const file of filesUnder(join(SRC, "adapters"))) {
      for (const spec of importsOf(file)) {
        if (spec.startsWith("@/components/") || spec.startsWith("@/app/")) {
          violations.push(`${rel(file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps the adapter result contract a discriminated union", () => {
    // The original shape signalled failure with an optional `error` field,
    // which made ignoring it the default: three call sites read
    // `providerMessageId` and reported success while the provider had
    // rejected the send. Requiring `ok` means the compiler forces the
    // question. Reverting to an optional error field would silently
    // reopen that whole class of bug.
    const code = readFileSync(join(SRC, "adapters/result.ts"), "utf8")
      .split("\n")
      // The file documents the old shape in prose; only the code counts.
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(code).toMatch(/ok:\s*true/);
    expect(code).toMatch(/ok:\s*false/);
    expect(code).not.toMatch(/error\?:/);
  });

  it("never lets an adapter report a bare success shape", () => {
    // Every outbound adapter must return the union, so no adapter can hand
    // back something a caller can treat as unconditionally successful.
    const outbound = ["sms.ts", "voice.ts", "email.ts"];
    for (const file of outbound) {
      const source = readFileSync(join(SRC, "adapters", file), "utf8");
      expect(source, `${file} should return AdapterResult`).toMatch(/Promise<AdapterResult>/);
    }
  });

  it("routes every adapter through the runtime credential store", () => {
    // Reading process.env directly in an adapter reintroduces the bug this
    // architecture was reworked to eliminate: a key entered in the admin
    // panel would be ignored until the process restarted.
    const violations = filesUnder(join(SRC, "adapters"))
      .filter((f) => /process\.env\./.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(violations).toEqual([]);
  });
});
