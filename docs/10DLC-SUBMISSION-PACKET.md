# Telnyx 10DLC submission packet

Status: code-ready; carrier submission and approval must be completed by the Telnyx account owner.

## Campaign identity

- Brand: Equity Flow Group
- Use case: direct, borrower-initiated mortgage refinance/home-equity inquiry follow-up
- Lead source: the company’s own web intake form
- Explicitly excluded: purchased leads, affiliate lists, scraped contacts, and Reddit-discovered users
- Sender: the Telnyx number configured as `TELNYX_PHONE_NUMBER`
- Public URLs: `/apply`, `/privacy`, and `/terms` on the production `APP_URL`

## SMS disclosure shown at intake

> By checking this box, I consent to receive text messages from Equity Flow Group and its licensed partners about my refinance or home equity inquiry, including messages sent using an automatic telephone dialing system. Message and data rates may apply. Consent is not a condition of purchase. Reply STOP to opt out at any time, HELP for help.

The checkbox is unchecked by default. The consent record stores the exact disclosure snapshot, version, timestamp, source URL, IP address, user agent, session id, and person/lead reference.

## Representative messages

1. Follow-up: `Hi {{firstName}}, this is Equity Flow Group following up on the mortgage inquiry you submitted. A licensed loan officer can help with next steps. Reply STOP to opt out.`
2. Callback confirmation: `Your callback with Equity Flow Group is booked for {{localTime}}. Reply STOP to opt out.`
3. Callback reminder: `Reminder: your Equity Flow Group callback starts in 15 minutes at {{localTime}}. Reply STOP to opt out.`
4. Help: `Equity Flow Group mortgage inquiry support. Message frequency varies. Reply STOP to opt out. Contact the number or email shown on our website for help.`

## Opt-out and operational controls

- STOP and equivalent keywords create immediate suppression before any later send.
- START does not silently erase compliance history; it follows the inbound keyword policy.
- HELP returns support/sender information and does not remove suppression.
- Suppression is checked immediately before every send, including delayed callback reminders.
- Quiet hours use the borrower’s IANA timezone; UTC is used at rest.
- Signed Telnyx primary and failover endpoints are `/api/webhooks/telnyx` and `/api/webhooks/telnyx/failover`.
- The legacy query-secret Telnyx routes return HTTP 410 and must not be configured in the Telnyx portal.

## Account-owner checklist

- Confirm the legal brand/entity, EIN, address, website, privacy URL, and terms URL in Telnyx.
- Submit the campaign using the direct borrower-initiated lending follow-up use case.
- Attach screenshots of the unchecked SMS checkbox and complete disclosure.
- Assign the approved campaign/messaging profile to the production number.
- Configure signed primary and failover webhooks and the account Ed25519 public key.
- Run opt-in, STOP, START, HELP, delivery receipt, replay, and failover UAT on approved test numbers.
- Record carrier campaign id, approval date, reviewer, and screenshots in the launch evidence folder.

