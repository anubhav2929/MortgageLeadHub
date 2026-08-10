# ADR-0002 — Resolve integration credentials at call time

- **Status:** Accepted
- **Date:** 2026-08-10
- **Supersedes:** the module-level `capabilities` constant in `src/lib/env.ts`

## Context

Integration credentials were read from `process.env` and frozen into a
module-level `capabilities` object at import time:

```ts
export const capabilities = {
  hasSms: !!process.env.TWILIO_AUTH_TOKEN,
  …
};
```

Every adapter and several UI surfaces branched on that constant.

The operational requirement is that an administrator enters an API key in the
admin panel and the corresponding feature starts working — everywhere,
immediately, with no redeploy, no restart, and no engineer involved.

The module-level constant makes that impossible. A key stored in the database
after boot is invisible to a constant computed at boot. On serverless the
failure is worse than a stale value: some lambdas have restarted and see the
key, others have not, so the same action succeeds or silently simulates
depending on which instance served it.

The operator-facing symptom is the real problem. Someone enters a key, nothing
changes, and they have no way to distinguish a wrong key from a stale process.

## Decision

Introduce `src/lib/runtimeConfig.ts`. Resolve every credential **per call**:

```ts
export async function getConfigValue(key: string): Promise<string | undefined> {
  try {
    const stored = (await getDb()).credentials.get(key);
    if (stored) {
      const plain = decryptSecret(stored.value);
      if (plain?.trim()) return plain.trim();
    }
  } catch {
    // DB unreachable during boot — env is the correct fallback here.
  }
  const fromEnv = process.env[key];
  return fromEnv?.trim() || undefined;
}
```

Precedence is store-first, environment-fallback. `getCapabilities()` is computed
fresh on each call rather than cached.

Every adapter was rewired to this. `tests/architecture.test.ts` fails the build
if any file under `src/adapters/` references `process.env` directly, because
that single line is what would reintroduce the bug.

## Exceptions

`DATABASE_URL` and `CREDENTIAL_SECRET` remain environment-only. Both are needed
to *reach and decrypt* the credential store, so neither can live in it.

## Rationale for store-first precedence

The admin panel is the intended interface; the environment is the bootstrap and
the deployment-automation path. If the environment won, a key set once during
deployment could never be rotated from the UI, which defeats the purpose.

## Consequences

- A key entered in the panel takes effect on the very next request, on every
  instance, with no deploy. This was verified end to end: saving a Telnyx key
  flipped the integration to "Live" and changed the root-layout banner from
  DEMO to LIVE without a restart.
- Every credential read is now async and hits the database. The rows are tiny
  and the connection is already open; the cost is not measurable against the
  network call the credential is being fetched *for*.
- Capability checks in server components must be awaited. Several functions
  (e.g. `voiceAgentStatus()`) became async as a direct result.
- A credential read during boot, before the database is reachable, falls back to
  the environment rather than throwing. This is intentional — it is exactly the
  case the environment fallback exists for.
