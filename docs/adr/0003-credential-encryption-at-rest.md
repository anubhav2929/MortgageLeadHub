# ADR-0003 — Encrypt stored credentials with an environment-held root key

- **Status:** Accepted
- **Date:** 2026-08-10
- **Related:** [ADR-0002](0002-runtime-credential-resolution.md)

## Context

ADR-0002 moved integration credentials into the database so an administrator can
manage them from the admin panel. That store now holds live provider API keys —
Telnyx, Twilio, Anthropic, Resend, Vapi — with real billing and real send
capability attached.

The system is also subject to a SoftCheck security inspection covering the
safeguards protecting client information, so "the database is private" is not an
answer that survives review on its own.

## Decision

Encrypt every stored credential value with AES-256-GCM (`core/secretBox.ts`).
The key is derived by scrypt from a single `CREDENTIAL_SECRET`, held **only in
the environment** and never in the database.

Payloads carry a `v1:` version prefix so the algorithm can be rotated later
without guessing at the format of existing rows.

Storage is authenticated, not merely confidential: GCM's tag means a modified
ciphertext is *detected* rather than silently decrypting to garbage that then
gets sent to a provider as an API key.

## Why the root key must not live in the database

Encrypting a table with a key stored in the same table protects against nothing.
Anyone who can read the ciphertext can read the key. The only configuration in
which encryption at rest has meaning is one where the key lives somewhere the
database dump does not — which here means the environment (and, in production,
the platform's secret store).

The cost is one required environment variable. The admin panel shows a warning
banner when `CREDENTIAL_SECRET` is unset, and the store refuses to save rather
than falling back to plaintext.

## Failure behaviour

`decryptSecret()` returns `null` and never throws. A tampered payload, an
unversioned legacy value, or a rotated root key all degrade to "this credential
is not configured", which the rest of the system already handles by simulating.

Throwing would take down every request that touches the credential store,
turning a single bad row into a full outage.

## What is never logged

Audit entries for credential changes record key **names** and the outcome
(`changed`, `cleared`) — never values, never masked values, never prefixes. The
admin UI displays a mask (`sk-•••••7890`) that is deliberately not reversible,
and the save path refuses to write a value containing the mask character, so a
form resubmission cannot overwrite a real key with its own mask.

## Consequences

- A database dump alone does not yield working provider credentials.
- Rotating `CREDENTIAL_SECRET` invalidates every stored credential; they must be
  re-entered. This is documented in DEPLOY.md and is the intended behaviour for
  a compromised root key.
- `core/secretBox.ts` is the one module in `core/` permitted to read
  `process.env`, exempted by name in `tests/architecture.test.ts`.
- Encryption uses `node:crypto` rather than a dependency, consistent with the
  password hashing and HMAC verification in `core/auth.ts`.
