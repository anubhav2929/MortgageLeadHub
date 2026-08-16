# Equity Flow Group — Lead Platform

A mortgage lead intake, qualification, and outreach platform. Borrowers submit an
inquiry; the system scores it, decides whether and how it may legally be
contacted, runs an AI-assisted multi-channel cadence, and hands qualified leads
to a licensed loan officer.

The compliance surface is the point. Contacting a borrower on the wrong channel,
at the wrong hour, in a state nobody on the team is licensed in, or after they
have opted out are all regulatory events, not UX bugs — so those rules live in
one pure, heavily tested module (`src/core/policyGate.ts`) that every outbound
path must pass through.

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

The app runs with zero configuration. Every third-party integration degrades to
a simulated implementation when its credentials are absent, so the full product
is explorable — including AI outreach, calls, and texts — without an account
anywhere. See [Configuration](#configuration).

Open http://localhost:3000. Demo sign-in credentials are listed in
[DEPLOY.md](DEPLOY.md).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:coverage` | Unit tests with a coverage report and thresholds |
| `npm run verify` | typecheck → lint → test → build. Run before pushing. |

## Configuration

No API key is required to run the application. Each integration resolves its
credentials **at call time** — from the encrypted credential store in the
database first, then from the environment — so keys entered in
**Admin → Integrations** take effect immediately without a redeploy or a
restart. An integration with no credentials logs its intent and returns a
simulated result rather than throwing.

Two values are the exception and must be set in the environment, because they
are needed to reach the credential store itself:

| Variable | Why it can't live in the store |
| --- | --- |
| `DATABASE_URL` | The store is a table in this database |
| `CREDENTIAL_SECRET` | Encrypts the store; keeping it beside the ciphertext would protect nothing |

Everything else — Telnyx, Twilio, Anthropic, NVIDIA, Resend, Vapi, RentCast —
is configured in the admin panel, which also carries the step-by-step setup
instructions for each provider. See
[ADR-0002](docs/adr/0002-runtime-credential-resolution.md) for why.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — layers, dependency rules, and how a lead moves through the system
- [CONTRIBUTING.md](CONTRIBUTING.md) — working agreements, testing strategy, review checklist
- [docs/adr/](docs/adr/) — architecture decision records for the non-obvious choices
- [DEPLOY.md](DEPLOY.md) — deployment, environment variables, provider setup
- [SPEC.md](docs/SPEC.md) — functional requirements (F-01 … F-13)

## Tech stack

Next.js 16 (App Router, Server Actions) · React 19 · TypeScript (strict) ·
Tailwind CSS 4 · PostgreSQL · Vitest · Zod.
