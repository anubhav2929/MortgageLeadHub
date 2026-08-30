# Equity Flow Group communications production checklist

**Prepared:** August 29, 2026
**Systems:** CRM, Vapi voice, Telnyx SMS, Resend email, automated cadence, and shared conversation context

## Delivery status

The CRM-side implementation is complete for controlled production UAT. Saving credentials in **Admin → Integrations** takes effect on the next provider operation; Vapi, Telnyx, and Resend account configuration still has to be completed by an owner of those accounts. A green credential check proves connectivity, while the acceptance tests below prove the complete communication loop.

| Capability | CRM code | Provider/account work |
|---|---|---|
| Personalized Vapi outbound greeting | Complete | Run a CRM-originated call to verify the exact production voice |
| Server-controlled one-question flow | Complete | Attach server events/credential to the inbound assistant; outbound calls receive tools automatically |
| Phone/SMS/email shared context | Complete and redacted | Verify with a three-channel UAT conversation |
| Telnyx outbound/inbound SMS | Complete | Activate number, messaging profile, 10DLC, signed webhooks, and Advanced Opt-Out |
| Resend outbound/delivery/inbound | Complete | Verify sending and receiving domains; configure two signed webhooks |
| Automated cadence and durable queues | Complete | Set `CRON_SECRET` and run authenticated schedulers |

## How shared context works

The lead—not the provider—is the conversation system of record.

1. Intake answers, verified lead fields, approved officer notes, SMS attempts/replies, email attempts/replies, and call transcript turns are ordered into one lead conversation thread.
2. Before any AI-generated call, text, email, or status-chat answer, the CRM produces a bounded brief and removes restricted data.
3. Vapi receives that brief as background context, but it may not use the brief to skip a required question. The server returns exactly one question through `get_next_question`; an earlier value is converted into a confirmation question.
4. A Telnyx reply is stored as a borrower SMS note. A Resend reply is matched by the per-lead Reply-To alias plus the saved borrower email and stored as a borrower email note. A completed Vapi call contributes redacted transcript turns and its summary.
5. The next channel regenerates its brief from the updated thread. No provider has to copy context directly to another provider, and no provider prompt becomes the source of truth.

This design keeps phone, SMS, and email consistent while preventing a text or email from silently changing a verified lead field. Provider webhooks are authenticated, deduplicated, and applied in lifecycle order.

## Vapi: account-side setup

- [ ] In **Phone Numbers**, confirm the production number can place outbound calls. Copy its Vapi phone-number **ID**, not only the displayed phone number.
- [ ] In **API Keys**, create a private server key for this CRM.
- [ ] In **Credentials**, create a Custom Credential with header `Authorization`, Bearer prefix enabled, and a random token of at least 32 bytes.
- [ ] In the published saved assistant, set the Server URL to `https://www.equityflowgroup.com/api/webhooks/vapi` and select that credential.
- [ ] Enable server messages `status-update`, `transcript`, `tool-calls`, `transfer-update`, `end-of-call-report`, and `hang`.
- [ ] Add the five custom tools `get_next_question`, `record_qualification_answer`, `request_warm_transfer`, `get_callback_slots`, and `book_callback`, plus Vapi's built-in `endCall` tool. Each custom tool uses the same CRM webhook and credential.
- [ ] Use Vapi dynamic variables in the outbound first message and retain a privacy-safe generic inbound fallback.
- [ ] Use the reviewed prompt in `docs/VAPI-ASSISTANT-SYSTEM-PROMPT.md`, test it, and publish it.
- [ ] Start with smart endpointing, `0.8` second wait, two-word interruption threshold, `0.2` second voice threshold, one-second backoff, and a 900-second maximum call duration.
- [ ] Configure and test the exact voice, model, and transcriber in the Vapi assistant. The CRM does not duplicate these provider settings.
- [ ] Do not use the Vapi **Talk** button to validate CRM personalization. It runs the dashboard assistant without a CRM lead. Place the test from a lead or the CRM calling center.

### Vapi: CRM Admin values

Save these under **Admin → Integrations → Vapi**:

- `VAPI_API_KEY`: private Vapi key
- `VAPI_PHONE_NUMBER_ID`: exact production number ID
- `VAPI_ASSISTANT_ID`: exact published saved-assistant ID
- `VAPI_WEBHOOK_SECRET`: the same random Bearer token used in Vapi
- `WARM_TRANSFER_FALLBACK_NUMBER`: central licensed line used when no eligible assigned officer is available
- `APP_URL`: `https://www.equityflowgroup.com` when the custom production origin is not already resolved by Vercel

For a CRM outbound lead named John Doe in Wichita, the saved assistant receives those values through dynamic variables. Its reviewed first message should not disclose the inquiry type before identity is confirmed.

## Telnyx: account-side setup

- [ ] Buy or port an SMS-capable US local number.
- [ ] Create a messaging profile and assign the number to it.
- [ ] Create a least-privilege API key.
- [ ] Register the company brand and a direct-lending 10DLC campaign. Submit the exact intake consent language, opt-in flow, sender identity, privacy/terms URLs, sample messages, and STOP handling. Wait until the campaign is active and attach it to the messaging profile.
- [ ] On the messaging profile, use API v2 POST webhooks:
  - Primary: `https://www.equityflowgroup.com/api/webhooks/telnyx`
  - Failover: `https://www.equityflowgroup.com/api/webhooks/telnyx/failover`
- [ ] Copy the account Ed25519 public key. The CRM verifies `telnyx-signature-ed25519` and `telnyx-timestamp` and rejects callbacks outside the replay window.
- [ ] Enable Advanced Opt-In/Out and approve STOP, START, and HELP responses. Telnyx sends its configured response; the CRM records policy state without sending a duplicate.
- [ ] Assign the approved campaign/profile to the exact sending number.

### Telnyx: CRM Admin values

Save these under **Admin → Integrations → Telnyx**:

- `TELNYX_API_KEY`
- `TELNYX_PHONE_NUMBER` in E.164 form, for example `+13165550123`
- `TELNYX_MESSAGING_PROFILE_ID` (recommended for explicit campaign/webhook selection)
- `TELNYX_PUBLIC_KEY` from Telnyx Account Settings

The Telnyx card is considered fully live only after the API key, number, and public key are present. The **Verify** action is read-only. A real send/reply test is still mandatory because carrier campaign activation cannot be proven by an API-key check.

## Resend: account-side setup

- [ ] Add the company sending domain and publish the DNS records Resend provides. Wait until SPF and DKIM show verified.
- [ ] Create a sending API key and choose a From address on that verified domain, such as `leads@example.com`.
- [ ] Create a delivery webhook:
  - URL: `https://www.equityflowgroup.com/api/webhooks/delivery/resend`
  - Events: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed`
- [ ] Save that delivery webhook's signing secret separately.
- [ ] Add a receiving subdomain, such as `reply.example.com`, and publish the Resend MX record. A separate subdomain avoids replacing the main business mailbox MX records.
- [ ] Create an inbound webhook:
  - URL: `https://www.equityflowgroup.com/api/webhooks/resend-inbound`
  - Event: `email.received`
- [ ] Save the inbound webhook's own signing secret; do not reuse or swap it with the delivery secret.

### Resend: CRM Admin values

Save these under **Admin → Integrations → Resend**:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`, for example `Equity Flow Group <leads@example.com>`
- `RESEND_WEBHOOK_SECRET`: delivery webhook secret
- `RESEND_INBOUND_WEBHOOK_SECRET`: inbound `email.received` webhook secret
- `RESEND_REPLY_TO_EMAIL`: receiving base, for example `replies@reply.example.com`

For lead email, the CRM changes that base into a per-lead address such as `replies+<public-ref>@reply.example.com`. The public reference disambiguates inquiries, but it is not treated as authentication: the sender must still match the primary borrower's saved email before their text enters AI context.

## Automation scheduler

Set `CRON_SECRET` in **Admin → Integrations → Platform** and configure exactly one scheduler for each route:

- `GET https://www.equityflowgroup.com/api/cron/process-webhooks` every minute for durable webhook/outbox processing
- `GET https://www.equityflowgroup.com/api/cron/cadence` every five minutes for cadence execution, call reconciliation, and queue maintenance
- Header on both: `Authorization: Bearer <CRON_SECRET>`

Do not configure duplicate schedulers. The database leases and idempotency controls prevent duplicate business events, but two clocks create unnecessary provider traffic and operational noise. If the Vercel plan cannot schedule these frequencies, use one external HTTPS scheduler.

## Final acceptance test

- [ ] Create an approved test lead with full name, city, E.164 phone, email, timezone, and voice/SMS/email consent.
- [ ] Start the call from the CRM. Verify exact full name/city, no private inquiry disclosure before identity confirmation, and all server-selected questions asked or confirmed once.
- [ ] Give one answer by phone. End the call and verify its transcript/summary appears once in the lead timeline.
- [ ] Send an SMS. Verify its copy naturally continues the phone discussion. Reply by text and verify the reply appears once.
- [ ] Send an email. Verify it reflects the phone and text context. Reply to the per-lead address and verify it attaches to the exact lead once.
- [ ] Confirm Telnyx delivery status and Resend delivered/bounce status advance the original attempt rather than creating a second attempt.
- [ ] Reply STOP. Confirm global suppression, lead state, and timeline update once; verify the next SMS/callback reminder is suppressed immediately before send.
- [ ] Replay one Vapi, Telnyx, and Resend webhook fixture. Confirm each business event remains single.
- [ ] Force an officer no-answer transfer. Verify the call offers borrower-timezone callback slots and that booking creates only the approved confirmation and reminder messages.
- [ ] Review Admin integration health without exposing any plaintext secret.

## Official references

- [Vapi outbound calling with a saved assistant](https://docs.vapi.ai/calls/outbound-calling)
- [Vapi dynamic variables](https://docs.vapi.ai/assistants/dynamic-variables)
- [Vapi server events](https://docs.vapi.ai/server-url/events)
- [Vapi Soniox transcriber](https://docs.vapi.ai/providers/transcriber/soniox)
- [Telnyx signed messaging webhooks](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks)
- [Telnyx Advanced Opt-In/Out](https://developers.telnyx.com/docs/messaging/messages/advanced-opt-in-out)
- [Telnyx 10DLC registration](https://developers.telnyx.com/docs/messaging/10dlc/campaign-registration)
- [Resend sending API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend receiving](https://resend.com/docs/dashboard/receiving/introduction)
- [Resend webhook events](https://resend.com/docs/webhooks/event-types)
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
