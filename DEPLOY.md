# Production deployment

The linked Vercel production project serves https://www.equityflowgroup.com. The application database is migrated through `006_auth_action_tokens`, and the deployment is fail-closed when the database, verified TLS, or release gate is unavailable.

## Safe release procedure

1. Run `npm run typecheck`, `npm run lint`, `npm test`, `npx next build --webpack`, and `npm audit --omit=dev`.
2. Create and verify an encrypted production backup with `npm run db:backup` where database credentials are available.
3. Run `npm run db:migrate:check`; apply only reviewed additive migrations with `npm run db:migrate:apply`.
4. Run `npm run db:snapshot:migrate` and verify source counts/checksum against normalized counts.
5. Record provider diagnostics and approved-number UAT.
6. Set `PRODUCTION_DEPLOY_READY=verified-release-v2` in Vercel and run `vercel deploy . --prod -y`.

Builds never seed, reset, delete, rotate credentials, or automatically apply pending schema changes. A production build fails if migrations are pending.

## Configuration model

`DATABASE_URL`/`POSTGRES_URL`, the database CA, and `CREDENTIAL_SECRET` are bootstrap environment variables. Provider and public configuration is entered by an Admin under **Admin → Integrations**, encrypted in the database, and resolved on each request without redeployment.

Supported Admin configuration includes:

- Vapi API/number/webhook credentials, voice/model, duration, endpointing, interruption/backoff, custom webhook credential, and warm-transfer fallback.
- Telnyx API/number/profile/voice IDs and Ed25519 public key; Twilio fallback credentials.
- Resend outbound, sender, inbound, and delivery signing values.
- OpenAI, Anthropic, NVIDIA routing; RentCast/FHFA data; Reddit OAuth approval; iSoftpull legal gate.
- Cron, app URL, NMLS, GA4, Search Console, Meta Pixel/CAPI, and approved feature gates.

Secrets are write-only after save. Provider connection tests are read-only and time bounded; results and operator changes are audited.

## Scheduler

Automatic outreach requires protected calls to:

- `/api/cron/cadence`
- `/api/cron/process-webhooks`

Send `Authorization: Bearer <CRON_SECRET>`. Use exactly one scheduler. Vercel Hobby cannot register the sub-daily timing required for a five-minute SLA; upgrade to Pro or use an external scheduler. The endpoints fail closed without a matching secret.

## Provider callbacks

| Provider | Endpoint |
| --- | --- |
| Telnyx primary | `/api/webhooks/telnyx` |
| Telnyx failover | `/api/webhooks/telnyx/failover` |
| Twilio delivery | `/api/webhooks/delivery/twilio` |
| Twilio inbound | `/api/webhooks/inbound/twilio` |
| Resend delivery | `/api/webhooks/delivery/resend` |
| Resend inbound | `/api/webhooks/resend-inbound` |

Vapi receives its callback URL per call. Provider-native signature verification and replay/idempotency controls are mandatory.

## First staff launch

1. Activate the customer Admin through an invitation/reset link; production has no shared demo passwords.
2. Enroll Admin and Compliance in authenticator MFA and save recovery codes.
3. Enter providers and run **Test connection**.
4. Complete 10DLC, sender-domain, Reddit/credit approvals, scheduler, and signed webhook setup.
5. Run UAT only on approved phone numbers.
6. Enable Vapi squads, warm transfer, callbacks, automated dialer, Reddit posting, free valuation, and Meta CAPI one flag at a time after acceptance evidence.

See [docs/CRM-FINAL-DEPLOYMENT-AUDIT.md](docs/CRM-FINAL-DEPLOYMENT-AUDIT.md), [docs/CLIENT-PRODUCTION-HANDOFF-REPORT.md](docs/CLIENT-PRODUCTION-HANDOFF-REPORT.md), and [docs/GO-LIVE-SETUP.md](docs/GO-LIVE-SETUP.md).
