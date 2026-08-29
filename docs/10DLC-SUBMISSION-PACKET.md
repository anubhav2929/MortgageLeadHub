# Equity Flow Group — Telnyx 10DLC resubmission packet

Prepared: August 29, 2026

Status: website/CRM implementation prepared; legal business data, carrier fees, and final submission require the Telnyx account owner.

This packet describes the product as implemented. It is not a legal opinion and does not promise carrier approval. The account owner should confirm the legal entity, licensing representations, and campaign answers before submitting.

## 1. Correct campaign classification

| Telnyx field | Recommended answer | Reason |
|---|---|---|
| Brand | The exact registered legal entity operating Equity Flow Group | Website, email domain, EIN, and Telnyx brand must match |
| Use case | `MIXED` (or Low Volume Mixed if the portal offers that option and expected volume is under its limit) | The same number sends inquiry follow-up, two-way support, and callback confirmations/reminders; some inquiry follow-up is promotional |
| `directLending` | `true` only if the registered entity is the direct lender/broker responsible for this consumer relationship | The traffic concerns the consumer's own mortgage inquiry, not third-party or payday lending |
| `subscriberOptin` | `true` | SMS requires a separate unchecked checkbox |
| `subscriberOptout` | `true` | STOP and equivalent keywords suppress immediately |
| `subscriberHelp` | `true` | HELP is supported |
| `numberPool` | `false` | Current architecture uses one configured sender |
| `embeddedLink` | `false` for the samples below | Do not enable unless production messages will contain URLs |
| `embeddedPhone` | `false` for the samples below | Enable if a phone number is included in production message bodies |
| `ageGated` | `false` | No age-gated content |

Do not select Customer Care if promotional mortgage follow-up will be sent. Do not describe this as purchased lead generation, an affiliate campaign, or messages sent on behalf of unrelated lenders. If the registered entity is an ISV sending for multiple client brands, stop and use Telnyx's ISV/reseller registration path instead of this direct-customer packet.

## 2. Campaign description — paste into Telnyx

> Equity Flow Group sends first-party SMS only to consumers who submit a mortgage refinance or home-equity inquiry at https://www.equityflowgroup.com/apply and separately check the optional SMS consent box. Messages include requested inquiry follow-up, answers to borrower questions, licensed-officer coordination, callback confirmations and reminders, and limited inquiry-related follow-up. Equity Flow Group does not buy lead lists, scrape contact details for messaging, cold text, send on behalf of unrelated third parties, or use this campaign for payday lending, third-party lending, or collection activity. Consent evidence stores the disclosure text and version, timestamp, source URL, IP address, browser information, and lead/person references. STOP is enforced before every later automated or manual send.

## 3. Message flow / call to action — paste into Telnyx

> Consumers reach https://www.equityflowgroup.com/apply from Equity Flow Group's public website and enter their own contact and mortgage-inquiry information. On the final Consent step, SMS is presented as a separate optional checkbox that is unchecked by default. The full disclosure is visible next to the checkbox and links to the Privacy Policy and Terms. The inquiry can be submitted without SMS consent. If the consumer checks SMS and submits, the CRM stores the exact disclosure version, grant decision, timestamp, source URL, IP address, browser information, session identifier, and lead/person references. Messages are limited to the inquiry the consumer submitted, two-way responses, and requested callback scheduling. Every production template identifies Equity Flow Group and includes STOP instructions. Replying STOP or an equivalent supported keyword immediately creates a global suppression checked immediately before every send. Reply HELP returns support information; START resubscribes only through the documented inbound keyword flow.

## 4. Exact website SMS disclosure

> By checking this box, I agree to receive recurring informational and marketing text messages from Equity Flow Group about the mortgage refinance or home-equity inquiry I submitted, including requested follow-ups, answers to my questions, and callback confirmations or reminders. Messages may be sent using an automated system. Message frequency varies. Message and data rates may apply. Consent is not a condition of obtaining goods or services. Reply STOP to opt out or HELP for help. Privacy Policy: https://www.equityflowgroup.com/privacy. Terms: https://www.equityflowgroup.com/terms.

Evidence pages:

- Opt-in: https://www.equityflowgroup.com/apply (final Consent step)
- Privacy: https://www.equityflowgroup.com/privacy
- Terms: https://www.equityflowgroup.com/terms
- Opt-out: https://www.equityflowgroup.com/unsubscribe

## 5. Representative messages — paste exactly

Sample 1 — borrower-requested follow-up:

> Equity Flow Group: Hi {{firstName}}, we received the mortgage inquiry you submitted on our website. A licensed loan officer can help with your questions and next steps. Reply STOP to opt out, HELP for help.

Sample 2 — callback confirmation:

> Equity Flow Group: Your requested callback is confirmed for {{localTime}} {{timeZone}}. Reply STOP to opt out, HELP for help.

Sample 3 — two-way inquiry follow-up:

> Equity Flow Group: Following up on your refinance or home-equity inquiry. What question can we help you with next? Reply STOP to opt out, HELP for help.

Sample 4 — callback reminder:

> Equity Flow Group: Reminder—your requested callback starts in 15 minutes at {{localTime}} {{timeZone}}. Reply STOP to opt out, HELP for help.

These samples deliberately avoid rates, approval promises, credit data, property details, URL shorteners, and unrelated promotions.

## 6. Keyword responses

Opt-out keywords: `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT`

Help keywords: `HELP, INFO`

Opt-in keywords: `START, UNSTOP, YES`

STOP response:

> You have been unsubscribed from Equity Flow Group text messages. No more text messages will be sent. Reply START to resubscribe.

HELP response:

> Equity Flow Group support: reply here or email inquiry@equityflowgroup.com. Message frequency varies. Message and data rates may apply. Reply STOP to opt out.

START response:

> You have been resubscribed to Equity Flow Group text messages. Reply STOP to opt out, HELP for help.

Enable Telnyx Advanced Opt-Out on the messaging profile and keep the CRM webhook suppression path enabled. Carrier-side keyword handling and CRM-side suppression are layered controls, not substitutes for one another.

## 7. Clarification / appeal text

Use this only after inserting the actual rejection reason and campaign/brand IDs. Do not state that a carrier rejected solely because of error `40010`; that error proves the sending number lacked an active campaign assignment, not why a campaign review may have failed.

> Please reconsider the Equity Flow Group campaign [CAMPAIGN ID] for the registered brand [BRAND ID]. This is a first-party, borrower-initiated mortgage inquiry program. Consumers enter their own phone number at https://www.equityflowgroup.com/apply and must separately select an optional SMS checkbox that is unchecked by default. The inquiry can be submitted without SMS consent. We revised the public opt-in to name Equity Flow Group, identify recurring informational and marketing inquiry-related messages, state that frequency varies and message/data rates may apply, state that consent is not a condition of services, provide STOP/HELP instructions, and link the live Privacy Policy and Terms. We also aligned the campaign description and samples with actual production messages, removed references that could imply third-party lead sharing, and documented that purchased lists, scraped contacts, cold messaging, payday lending, third-party lending, and collection traffic are excluded. The CRM preserves the exact consent disclosure/version and capture evidence and applies STOP suppression immediately before every send. [INSERT ONE SENTENCE ADDRESSING THE SPECIFIC REJECTION CODE OR REVIEWER COMMENT.] We request a new review of the corrected campaign materials and attached website evidence.

## 8. Implementation evidence

- Each channel is a separate optional checkbox and is unchecked by default.
- The public form renders the same approved disclosure version the server records.
- Admin/Compliance can publish a new immutable disclosure version; prior versions remain retained for evidence.
- Consent records include exact text, version ID, timestamp, source URL, IP address, user agent, session, and lead/person references.
- SMS policy checks consent, suppression, quiet hours, spacing, attempt caps, and cancellation immediately before sending.
- Inbound STOP handling is durable and provider webhooks use Telnyx Ed25519 signature/replay verification.
- Messages are brand-identified and generated from approved templates with STOP language.
- The Telnyx integration test verifies the messaging number, profile, signed webhook URLs, and `ASSIGNED` 10DLC phone-number campaign status.

## 9. Resubmission checklist

Before opening the portal:

- [ ] Confirm the exact legal business name, entity type, EIN, registered address, business phone, and domain-based email.
- [ ] Confirm the entity is licensed/authorized for every public lending representation; enter the real NMLS ID in CRM Admin → Integrations → Platform.
- [ ] Enter the same legal name, public support email, support phone, and registered address in CRM Admin → Integrations → Platform.
- [ ] Confirm the website, privacy, terms, and opt-in pages are live without placeholders.
- [ ] Capture a screenshot of the final Consent step showing the unchecked SMS box and expanded disclosure.
- [ ] Confirm expected monthly message volume before choosing standard Mixed versus Low Volume Mixed.

In Telnyx:

- [ ] Register or correct the Brand using business details that exactly match public records and the website.
- [ ] If a prior campaign is rejected and locked, create a new corrected campaign; Telnyx documents that a rejected campaign cannot simply be edited.
- [ ] Paste the classification, description, message flow, samples, and keyword responses from this packet.
- [ ] Enable `directLending`, opt-in, opt-out, and HELP only if the portal/business facts support those answers.
- [ ] Submit and retain the campaign ID, date, fee receipt, and screenshots.
- [ ] After approval, assign `+19492397627` (or the final production sender) to the approved campaign.
- [ ] Wait until assignment status is `ASSIGNED`; carrier propagation can take additional business days.
- [ ] Run CRM Admin → Integrations → Telnyx → Test connection. It must report an assigned 10DLC campaign.
- [ ] Send opt-in, HELP, STOP, START, delivery, and failover UAT only to approved test numbers.

## 10. Standards mapped to implementation

- Telnyx/TCR: explicit opt-in, accurate use case and samples, brand identification, STOP/HELP/START, campaign assignment, and no disallowed unsolicited/non-direct-lending traffic.
- Telephone Consumer Protection Act/FCC rules: affirmative channel consent evidence for automated outreach, reasonable revocation handling, and a single neutral opt-out confirmation.
- CAN-SPAM (for email, not SMS registration): truthful sender/subject information and working unsubscribe handling for commercial email.
- GLBA/Regulation P may apply depending on the legal entity and relationship; the privacy page describes platform data practices, but counsel must determine whether a separate model privacy notice is required.
- State privacy, telemarketing, call-recording, licensing, and quiet-hour requirements can be stricter than federal baselines and require counsel review for the states served.

Authoritative references:

- https://developers.telnyx.com/docs/messaging/10dlc/campaign-registration
- https://developers.telnyx.com/docs/messaging/10dlc/campaign-use-cases/index
- https://developers.telnyx.com/docs/messaging/10dlc/10dlc-rate-limits
- https://developers.telnyx.com/docs/messaging/10dlc/phone-number-assignment
- https://developers.telnyx.com/docs/messaging/messages/phone-number-configuration
- https://docs.fcc.gov/public/attachments/FCC-24-24A1.pdf
- https://docs.fcc.gov/public/attachments/FCC-12-143A1.pdf
- https://www.consumerfinance.gov/rules-policy/regulations/1016/
