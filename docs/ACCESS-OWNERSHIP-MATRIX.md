# Production access and ownership matrix

Primary ownership must sit in Aldrish-controlled organizations/accounts. Anubhav receives the least privilege needed for implementation and support. Account owners—not application code—must complete the transfers.

| System | Aldrish primary role | Anubhav role | Required controls | Transfer evidence |
|---|---|---|---|---|
| GitHub | Organization owner (two named owners) | Maintainer on this repository | MFA, protected main branch, required checks, Dependabot | Org/repo settings screenshot |
| Vercel | Team owner/billing owner | Developer | MFA/SSO, protected production env, audit log | Team member and domain screenshots |
| Domain/DNS | Registrant and billing owner | DNS editor only during launch | Registry lock, MFA, recovery contacts | Registrar ownership export |
| PostgreSQL | Project owner | Developer or read-only support | Verified TLS, PITR/backups, separate production credentials | Project members and backup test |
| Vapi | Organization owner/billing | Developer | Scoped credentials, signed webhook, approved test numbers | Members, phone id, webhook UAT |
| Telnyx | Account owner/compliance contact | Developer | MFA, 10DLC approval, signed primary/failover webhooks | Campaign approval and webhook screenshots |
| Resend | Team owner/domain owner | Developer | Verified sender domain, signed delivery/inbound webhooks | Domain and webhook screenshots |
| Reddit | OAuth app owner and commercial-approval holder | App developer | Written commercial approval, least scopes, company account | Approval letter and app settings |
| Google Analytics/Search Console | Property owner | Editor | Consent mode, no PII, verified domain | Property access/export |
| Meta Business/Pixel/CAPI | Business admin and dataset owner | Developer | Consent gate, minimal data, event-id dedupe | Business members and Events Manager UAT |
| RentCast/property sources | Billing/data-license owner | Developer | Allowlisted sources, terms record, cost cap | Subscription/license and benchmark |
| Credit vendor | Compliance/business owner | No live access until approved | Counsel-approved language, sandbox first, retention/encryption | Contract, legal approval, UAT |
| Object storage/malware scanner | Project owner | Developer | Private bucket, service token, scanning, expiry, access logs | Bucket policy and scanner test |

## Completion record

For every row, record the date, the Aldrish owner, invited users/roles, MFA status, recovery owner, billing owner, and a link to evidence. Do not place secrets or recovery codes in this document.

