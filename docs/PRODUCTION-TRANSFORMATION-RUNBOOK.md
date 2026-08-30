# Production transformation runbook

This change is additive until the repository switch is explicitly performed. Do not point provider dashboards at the new routes before the corresponding environment values and database migration are present.

## 1. Preflight and backup

1. Create a Neon restore point or branch from production.
2. Pause manual CRM writes and the GitHub cadence workflow.
3. Record the current deployment SHA, Vapi phone-number ID, voice/model values, and Vapi webhook settings. Never copy API keys into this document or a ticket.
4. Run `npm run db:migrate:check`. Exit code 2 means migrations are pending; this command is read-only.
5. Run `npm run db:snapshot:inspect` and save the reported revision, collection counts, and SHA-256 checksum in the change record.

## 2. Additive database deployment

1. Run `npm run db:migrate:apply` against the isolated Neon branch first.
2. Run `npm run db:snapshot:migrate` on that branch.
3. Compare expected and verified counts. Investigate any mismatch before continuing.
4. Deploy a Vercel preview connected to the Neon branch and run the normal regression suite.
5. Repeat the migration in the production maintenance window. The legacy `mlh_store` row remains intact and is not deleted.

The application rejects stale legacy-snapshot writes using a database revision. A concurrent writer must reload and retry; it can no longer overwrite a newer snapshot silently.

## 3. Telnyx configuration

Set `TELNYX_PUBLIC_KEY` to the account Ed25519 public key, then configure the Telnyx messaging profile:

- Primary webhook: `https://www.equityflowgroup.com/api/webhooks/telnyx`
- Failover webhook: `https://www.equityflowgroup.com/api/webhooks/telnyx/failover`

Select inbound and delivery message events. The two URLs terminate on the same Vercel application; the second route satisfies the requested failover field but is not independent infrastructure.

Do not include `?secret=` on either URL. The application verifies `telnyx-signature-ed25519` and `telnyx-timestamp`, rejects events outside five minutes, and deduplicates `(provider,event-id)` in `webhook_inbox`.

Use Admin → Operations to verify the exact URLs, signing readiness, queue state, and quarantined events. Send a live SMS only to the designated test number after explicit approval. Verify sent, delivered, inbound reply, STOP, duplicate delivery, and retry behavior.

## 4. Vapi compatibility cutover

Create and publish a saved Vapi assistant, then save its ID as `VAPI_ASSISTANT_ID`. Keep the provider/model, voice, transcriber, endpointing, tools, prompt, and server events in that assistant. The CRM call payload references it instead of rebuilding those settings per call.

Create a Vapi Bearer Custom Credential for the server URL using the same token stored as `VAPI_WEBHOOK_SECRET`, and attach it to the assistant and each CRM tool. The credential ID remains in Vapi and is not stored by the CRM.

Canary one outbound and one inbound call to the designated test number. Verify queued → ringing → connected → ended, one-question cadence, deterministic decision, transcript turns, outcome, summary, action items, and reviewed field candidates. Recording retention is off unless it has been explicitly approved and encrypted storage is ready.

Inbound calls are attached only when the caller has one exact E.164 match. Unknown or ambiguous callers appear in Admin → Operations instead of being guessed onto a lead.

## 5. AI and timezone

Configure one or more of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `NVIDIA_API_KEY`. Set `AI_PROVIDER_PRIORITY` to a comma-separated order such as `OPENAI,ANTHROPIC,NVIDIA`. The first configured entry is primary and only retryable availability failures move to the next provider.

Set provider models with `OPENAI_MODEL`, `ANTHROPIC_MODEL`, and `NVIDIA_MODEL`. Vapi credentials are separate; changing the CRM priority does not prove that the same provider is ready inside Vapi.

In Admin → Settings, select and save an IANA operational timezone. Database timestamps remain UTC. Operational display and daily counters use the Admin timezone; contact policy continues to use the borrower timezone.

## 6. Rollback

1. Pause cadence and CRM writes.
2. Restore the previous deployment SHA.
3. Leave the normalized tables and `webhook_inbox` intact for evidence and replay.
4. The previous app continues reading the untouched `mlh_store` row. If any normalized-only writes were accepted, export/reconcile them before reopening writes.
5. Restore the Neon branch/restore point only when database integrity is in doubt; doing so discards newer events and requires provider reconciliation.

## 7. Gated integrations

- Reddit: retain demo discovery until written commercial approval is attached to the launch record, set `REDDIT_COMMERCIAL_APPROVED=true`, complete Admin OAuth, and only then enable `redditPosting`. Every publication remains human-previewed and explicitly approved.
- Property valuation: the official free-evidence lane is always primary. Configure only allowlisted public-record endpoints and official FHFA data, benchmark the chain on the approved UAT address set, and keep RentCast as the parcel-level fallback; failures show insufficient evidence rather than a simulated value.
- Credit: leave `CREDIT_LIVE_APPROVED=false` until vendor access and counsel-approved authorization language are both recorded.
- Meta/GA: record consent-banner approval and verify request payloads contain no PII before enabling `metaCapi`.

## 8. Callback and transfer UAT

Use only approved test numbers. Verify officer answer, operator-first summary, summary-delivered, and bridged as separate states. Force busy, voicemail, timeout, and provider failure and confirm the borrower is offered a callback. Book, reschedule, and cancel callbacks; confirm exactly one immediate SMS and one pre-call reminder, then send STOP between them and verify the reminder is suppressed.

## 9. Acceptance window

For 48 hours monitor provider failures, `PENDING`/`RETRY` queue age, quarantined events, cadence lease skips, concurrent snapshot rejections, Vapi completion rate, summaries, and field-review activity. Do not remove legacy webhook routes or the legacy snapshot during this period.
