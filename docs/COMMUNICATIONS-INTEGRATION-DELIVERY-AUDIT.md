# Communications integration delivery audit

**Audit date:** August 29, 2026
**Scope:** Vapi voice, Telnyx SMS, Resend email, cross-channel lead context, delivery safety, provider configuration, and initial scaling readiness.

## Executive result

The application code is ready for controlled production UAT after the account-side checklist in this report is completed. The delivery path is not yet proven live merely by saving API keys: Vapi webhook credentials, Telnyx signed webhooks/10DLC, Resend sending and receiving domains, webhook subscriptions, and a production scheduler must all be verified with real test traffic.

No destructive database operation or schema migration was required for this pass. The fixes use the existing normalized qualification, webhook inbox, attempt, message, and outbox structures, so existing lead data is preserved.

The call-question skipping defect was reproduced in code and fixed. Intake and verified values had been seeded into `QualificationProgress` and counted as completed answers. The server now treats them as context only, asks the borrower to confirm or correct each required value, accepts only the current server-selected question, and rejects out-of-sequence answers. The single-assistant fallback now uses the same five server tools as the squad path, so turning squads off no longer returns question control to the model.

## Completion matrix

| Capability | Code status | Account/UAT status | Delivery decision |
|---|---|---|---|
| Vapi outbound transient assistant | Complete | Needs a live approved-number call | Ready for UAT |
| Server-owned one-question sequence | Complete and tested | Needs recorded scenario UAT | Ready for UAT |
| Vapi squads/handoffs | Implemented behind feature flag | Enable only after baseline UAT | Controlled rollout |
| Vapi webhook authentication | Bearer, X-Vapi-Secret, and explicit HMAC supported | Create credential and paste ID/token | Configuration required |
| Vapi dashboard inbound assistant | CRM can initialize an exact caller by E.164 | Dashboard assistant must use the listed tools/server settings | Configuration required |
| Warm transfer/callback tools | Implemented and policy-gated | Needs licensed destinations, flags, and live bridge test | Configuration required |
| Telnyx outbound SMS | Implemented using `/v2/messages` | Needs key, number, profile, 10DLC | Configuration required |
| Telnyx signed primary/failover webhooks | Complete, Ed25519 + replay window + durable dedupe | Profile URLs/public key must be set | Configuration required |
| STOP/START/HELP | Complete; carrier autoresponse no longer duplicated | Advanced Opt-In/Out must be enabled | Ready after configuration |
| Resend outbound email | Complete; provider idempotency retained | Sending domain/from address must be verified | Configuration required |
| Resend delivery lifecycle | Implemented with Svix verification and ordered status handling | Subscribe all listed delivery events | Configuration required |
| Resend inbound replies | Complete with durable `svix-id` dedupe | Receiving domain/webhook/Reply-To base required | Configuration required |
| Email and SMS templates | Complete for all 12 lead states | Copy/legal review recommended | Ready for UAT |
| Cross-channel context | Voice, cadence, manual email, and manual SMS use the unified redacted brief | Conversation-continuity UAT required | Ready for UAT |
| High-volume scaling | Durable queues and `SKIP LOCKED` webhook workers exist | Load/rate tests and provider limit review outstanding | Do not bulk-launch yet |

## Changes made in this pass

### Voice and question sequencing

- Form and verified values are retained as a bounded context snapshot but no longer complete a current-call question.
- `get_next_question` returns exactly one question. When an earlier value exists, the returned prompt asks the borrower to confirm or correct it.
- `record_qualification_answer` accepts only the question currently selected by the server. Attempts to jump ahead are rejected.
- Both the squad and single-assistant configurations include `get_next_question`, `record_qualification_answer`, `request_warm_transfer`, `get_callback_slots`, and `book_callback`.
- Both configurations explicitly state that a known answer is context, not permission to skip.
- Vapi `toolWithToolCallList` nested payloads are now parsed, including nested tool-call IDs and parameters. Tool failures use Vapi's per-result `error` field.
- Inbound calls matched to exactly one E.164 borrower now initialize the same context snapshot and qualification progress used by outbound calls.
- Existing endpointing controls remain administrator-editable: smart endpointing, 0.8-second wait, two-word interruption threshold, and one-second interruption backoff. Vapi documents that `waitSeconds` is applied after LLM/TTS processing and that `backoffSeconds` controls post-interruption silence, so these values must be tuned from recordings rather than treated as universal constants ([Vapi voice pipeline](https://docs.vapi.ai/customization/voice-pipeline-configuration)).

Vapi recommends Custom Credentials referenced by `credentialId`; its documented standard setup is an `Authorization` Bearer credential, while `X-Vapi-Secret` remains a compatibility option ([Vapi server authentication](https://docs.vapi.ai/server-url/server-authentication)). The receiver now supports both contracts. Vapi also documents nested `toolWithToolCallList` payloads ([Vapi custom tools](https://docs.vapi.ai/tools/custom-tools)) and recommends focused assistants with explicit handoff conditions and carefully bounded context ([Vapi squads](https://docs.vapi.ai/squads)).

### SMS

- Telnyx continues to be resolved from Admin settings on every send; no redeploy is required after saving credentials.
- The undocumented `Idempotency-Key` request header was removed from the Telnyx Messages API call. Application deduplication remains in the durable outbox. Resend still uses its documented provider idempotency contract.
- Telnyx `autoresponse_type` is now consumed. When Advanced Opt-In/Out has already replied to STOP/START/HELP, the CRM updates suppression and timeline state without sending a duplicate response. Telnyx documents this field and reserves those operations ([Telnyx Advanced Opt-In/Out](https://developers.telnyx.com/docs/messaging/messages/advanced-opt-in-out)).
- Suppression is saved before any fallback acknowledgement network request.
- Primary and failover ingestion verify the documented Ed25519 signature over `{timestamp}|{json_payload}` and reject stale replays ([Telnyx webhook verification](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks)).
- Message rate and queue behavior must be governed by the approved 10DLC campaign. Telnyx throughput depends on campaign class/vetting and excess traffic may queue for up to four hours ([Telnyx messaging limits](https://developers.telnyx.com/docs/messaging/messages/rate-limiting)).

### Email and cross-channel continuity

- The manual SMS generator bug that requested a `VOICE` artifact was corrected to request an SMS artifact.
- Manual email and SMS drafts now receive the same redacted unified conversation brief already used by cadence and voice.
- The outreach prompt must continue the prior conversation, answer the newest safe unresolved question, and defer rate, approval, legal, tax, or case-specific answers to a licensed officer instead of inventing them.
- Central templates now cover all CRM stages: new, attempting contact, in conversation, qualifying, ready for handoff, assigned, acknowledged, nurture, stale, suppressed, completed customer, and closed. Suppressed and closed-lost templates are explicitly non-sendable.
- Outbound lead email can use `RESEND_REPLY_TO_EMAIL` to create a per-lead Reply-To alias. Inbound matching prefers that exact alias and refuses ambiguous sender-only matches.
- A per-lead alias is no longer accepted by itself: the inbound sender must also match the lead's saved primary email before any text enters the shared AI context.
- Automated cadence and borrower status-chat generation now apply the same restricted-data redaction used by manual drafts and Vapi.
- Telnyx's current `40300` STOP rejection is classified as a borrower opt-out rather than an account-authentication error. Both synchronous send rejection and later delivery rejection create global suppression and stop future outreach.
- Resend refuses live delivery when the API key exists but the configured From address is missing, placeholder-like, or outside a verified-domain setup; it raises an integration error rather than attempting a doomed send.
- The public-origin setting is normalized centrally before metadata, SEO, invite/reset links, OAuth callbacks, analytics, or provider webhooks use it. Bare domains and copied Markdown links become one HTTPS origin; irreparable legacy values fail over to Vercel's stable production custom domain rather than crashing page rendering.
- Admin integration cards now display copy-ready Vapi, Telnyx primary/failover, and Resend delivery/inbound webhook URLs generated from that effective production origin.
- Inbound Resend webhooks are signature-verified, durably deduplicated by `svix-id`, then fetch the full received email. Resend documents that the initial event contains metadata and the content must be retrieved separately, and that any address on a receiving domain can be routed from its `to` field ([Resend receiving](https://resend.com/docs/dashboard/receiving/introduction)).
- Resend's documented 24-hour idempotency key is retained for sends ([Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)). Delivery subscriptions include sent, delivered, delayed, bounced, complained, failed, and suppressed events ([Resend event types](https://resend.com/docs/webhooks/event-types)).

## Required account configuration

### Vapi

1. In Admin → Integrations → Vapi, save `VAPI_API_KEY`, the exact `VAPI_PHONE_NUMBER_ID`, and a random `VAPI_WEBHOOK_SECRET`.
2. In Vapi → Integrations/Server Configuration, create a Bearer Token Custom Credential:
   - Header: `Authorization`
   - Bearer prefix: enabled
   - Token: the exact value saved as `VAPI_WEBHOOK_SECRET`
3. Save its ID as `VAPI_WEBHOOK_CREDENTIAL_ID` in the CRM.
4. For CRM-originated outbound calls, the CRM sends a transient assistant or squad with the call. The separately published assistant shown on the phone number is not the source of truth for those outbound calls.
5. For inbound calls, keep a published assistant on the number and configure its server URL as `https://www.equityflowgroup.com/api/webhooks/vapi`, use the same Custom Credential, enable `status-update`, `transcript`, `tool-calls`, `transfer-update`, `end-of-call-report`, and `hang`, and add the same five server tools. Its prompt must say: before every qualification question call `get_next_question`; ask only the returned prompt; record only the explicit answer; never choose or skip questions.
6. Do not paste large lead records or restricted identifiers into the Vapi dashboard prompt. Runtime context comes from the CRM snapshot.

### Telnyx

1. Save `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`, `TELNYX_MESSAGING_PROFILE_ID`, and Account Settings → Public Key as `TELNYX_PUBLIC_KEY`.
2. On the messaging profile set:
   - Primary: `https://www.equityflowgroup.com/api/webhooks/telnyx`
   - Failover: `https://www.equityflowgroup.com/api/webhooks/telnyx/failover`
3. Enable Advanced Opt-In/Out and approve the exact STOP, START, and HELP responses.
4. Complete and approve the 10DLC brand/campaign and attach the sending number. API success is not evidence that carrier registration is complete.
5. Send an approved test message, reply STOP, confirm the global suppression appears once, and prove a queued reminder is suppressed before send.

### Resend

1. Verify the sending domain and save a verified `RESEND_FROM_EMAIL`.
2. Create a delivery webhook at `https://www.equityflowgroup.com/api/webhooks/delivery/resend`; subscribe sent, delivered, delivery_delayed, bounced, complained, failed, and suppressed; save its signing secret as `RESEND_WEBHOOK_SECRET`.
3. Enable a receiving domain, create an `email.received` webhook at `https://www.equityflowgroup.com/api/webhooks/resend-inbound`, and save its signing secret as `RESEND_INBOUND_WEBHOOK_SECRET`.
4. Save an address on that receiving domain as `RESEND_REPLY_TO_EMAIL`, for example `replies@reply.example.com`. The CRM creates `replies+<lead-public-ref>@reply.example.com` automatically.
5. Send one email from each representative lead stage, reply from the borrower mailbox, and verify the reply appears once on the exact lead timeline.

### Scheduler

The project does not declare sub-minute Vercel Cron schedules. Configure an authenticated external scheduler to call the cadence/outbox and webhook-processing endpoints at the production frequency documented in the deployment runbook. Without a scheduler, saving provider credentials makes manual sends live but does not make automated follow-up reliable.

## Scaling assessment

The normalized operational tables, unique provider event IDs, durable outbox IDs, retry states, stale-lock recovery, and PostgreSQL `FOR UPDATE SKIP LOCKED` claims are appropriate building blocks for horizontal workers. They prevent two workers from claiming the same ready record and retain delivery evidence.

Before a high-volume launch:

1. Set a CRM call concurrency ceiling below the purchased Vapi concurrency and perform a 429/quota test.
2. Add campaign-aware SMS throttling from the actual Telnyx 10DLC vetting class; do not rely on carrier queues as the application scheduler.
3. Load-test webhook ingestion with duplicates, reordering, signature failures, and failover delivery.
4. Keep email idempotency retries inside Resend's 24-hour window and add explicit application throttling for the account's current Resend quota.
5. Move remaining synchronous manual/cadence provider operations through the outbox before bulk campaigns. The current design is suitable for controlled launch volume, not an unrestricted bulk blast.
6. Store only bounded redacted communication summaries in model prompts. Full transcripts remain in the CRM and should not grow every new prompt indefinitely.

## Mandatory 24-hour acceptance test

Use approved test numbers and mailboxes only:

1. Lead has complete intake values; Vapi must still confirm every required item in order.
2. Borrower corrects one intake value; the old value remains traceable and the new value becomes a candidate, not a silent overwrite.
3. Interrupt and pause naturally; confirm no stacked questions and no false interruption.
4. Complete warm transfer; officer hears summary before bridge and borrower is not released early.
5. Force officer busy/no-answer; callback slots are offered and booked in the borrower timezone.
6. Receive booking confirmation, then reply STOP before the reminder; no reminder may leave the system.
7. Continue by email and by SMS; each draft must reflect the newest phone/email/text context without repeating answered questions.
8. Replay the same Vapi, Telnyx, and Resend webhook; each business event must appear once.
9. Exercise bounce, complained, failed, and suppressed email fixtures.
10. Confirm Admin health panels show live provider results without exposing credentials.

## Verification performed in this pass

- Targeted Vitest suites: qualification sequencing, Vapi webhook authentication, inbound keyword behavior, and all-stage outreach templates.
- TypeScript: passed.
- ESLint: passed.
- Production health endpoint: application healthy and database reachable at audit time.
- Next.js production build: all 44 routes compiled successfully with the supported webpack builder. The local Turbopack attempt was blocked by the restricted environment's internal port-binding rule, not by a source compilation error.

Provider authentication and carrier/domain approval cannot be proven from source code or from a public health response. Record screenshots/log IDs from the mandatory live UAT before client acceptance.
