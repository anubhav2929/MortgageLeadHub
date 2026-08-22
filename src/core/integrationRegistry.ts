// Every external provider the product can talk to, in one place.
//
// This is the single source of truth for three things that used to drift
// apart: which env vars exist, what the admin panel renders, and what
// "configured" means for each provider. Adding a provider here gives you the
// runtime capability check, the admin form, and the setup instructions
// together — there is no second list to remember to update.
//
// Pure data. No I/O, no secrets, safe to import from a client component
// (the panel renders instructions from it).

export interface IntegrationField {
  /** Also the env var name, so an existing .env deployment keeps working. */
  key: string;
  label: string;
  /** Secret fields are encrypted at rest and never sent back to the browser. */
  secret: boolean;
  placeholder?: string;
  help?: string;
  optional?: boolean;
}

export type IntegrationCategory = "Messaging" | "AI" | "Voice AI" | "Data" | "Platform";

export interface IntegrationDef {
  id: string;
  name: string;
  category: IntegrationCategory;
  /** Plain-language: what breaks or simulates without this. */
  powers: string;
  /** All of these must have a value before the integration counts as live. */
  requiredKeys: string[];
  fields: IntegrationField[];
  setupSteps: string[];
  docsUrl?: string;
  freeTier?: string;
  /** Shown when another integration can cover the same job. */
  alternativeNote?: string;
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "telnyx",
    name: "Telnyx",
    category: "Messaging",
    powers:
      "Outbound SMS — the channel the follow-up cadence uses most. Preferred over Twilio when both are set. Also places announcement calls once the two voice fields below are filled in.",
    requiredKeys: ["TELNYX_API_KEY", "TELNYX_PHONE_NUMBER"],
    fields: [
      { key: "TELNYX_API_KEY", label: "API key", secret: true, placeholder: "KEY0123...", help: "Portal → Auth → API Keys" },
      { key: "TELNYX_PHONE_NUMBER", label: "Phone number", secret: false, placeholder: "+15125550142", help: "E.164 format, including +1" },
      { key: "TELNYX_MESSAGING_PROFILE_ID", label: "Messaging profile ID", secret: false, optional: true, help: "Only needed if your number isn't on a default profile" },
      {
        key: "TELNYX_ACCOUNT_SID",
        label: "Account ID (voice only)",
        secret: false,
        optional: true,
        help: "Portal → Account Settings. Only needed for outbound calls, not SMS.",
      },
      {
        key: "TELNYX_TEXML_APP_ID",
        label: "TeXML Application ID (voice only)",
        secret: false,
        optional: true,
        help: "Portal → Voice → TeXML Applications. Only needed for outbound calls, not SMS.",
      },
    ],
    setupSteps: [
      "Create an account at portal.telnyx.com.",
      "Buy a phone number under Numbers → Search & Buy.",
      "Create an API key under Auth → API Keys and paste it above.",
      "Complete 10DLC brand and campaign registration — carriers require it for business SMS and it takes 1-3 business days to clear.",
      "SMS works as soon as the key and number are saved. Outbound CALLS need two more fields: Telnyx fetches the call script from a URL instead of accepting it inline the way Twilio does.",
      "For calls: create a TeXML Application under Voice → TeXML Applications, assign your number to it, and paste its ID plus your Account ID above. DELIVERY_WEBHOOK_SECRET must also be set — it authenticates Telnyx's fetch of the script.",
    ],
    docsUrl: "https://portal.telnyx.com",
    alternativeNote: "Roughly half Twilio's per-segment cost with 10DLC registration built in.",
  },
  {
    id: "twilio",
    name: "Twilio",
    category: "Messaging",
    powers:
      "Outbound voice calls, and SMS fallback when Telnyx isn't configured. Preferred for voice when both carriers are set up, because it needs no TeXML application.",
    requiredKeys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
    fields: [
      { key: "TWILIO_ACCOUNT_SID", label: "Account SID", secret: false, placeholder: "AC..." },
      { key: "TWILIO_AUTH_TOKEN", label: "Auth token", secret: true },
      { key: "TWILIO_PHONE_NUMBER", label: "Phone number", secret: false, placeholder: "+15125550142" },
    ],
    setupSteps: [
      "Sign up at twilio.com/try-twilio — the trial includes about $15 of credit, no card required.",
      "Copy the Account SID and Auth Token from the console dashboard.",
      "Buy or claim a trial phone number and paste it above in E.164 format.",
      "On a trial account you can only text numbers you've verified under Phone Numbers → Verified Caller IDs. Add any tester's cell there first, or their messages will silently never arrive.",
    ],
    docsUrl: "https://console.twilio.com",
    freeTier: "~$15 trial credit",
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    category: "AI",
    powers: "AI-written call scripts, emails and texts; borrower chat answers; conversation extraction; intake name validation.",
    requiredKeys: ["ANTHROPIC_API_KEY"],
    fields: [{ key: "ANTHROPIC_API_KEY", label: "API key", secret: true, placeholder: "sk-ant-..." }],
    setupSteps: [
      "Create an account at console.anthropic.com.",
      "Add billing — this is usage-based, not a subscription.",
      "Create an API key under Settings → API Keys and paste it above.",
    ],
    docsUrl: "https://console.anthropic.com",
    alternativeNote: "NVIDIA's free tier can cover every AI feature including transcript extraction. Anthropic is preferred by default for tasks whose output is written to the lead record, because its tool-calling constrains the model to a schema.",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    category: "AI",
    powers: "Free-tier model for every AI feature — message drafting, borrower chat, transcript extraction, and lead-discovery scoring. Preferred for high-volume work when both providers are configured.",
    requiredKeys: ["NVIDIA_API_KEY"],
    fields: [
      { key: "NVIDIA_API_KEY", label: "API key", secret: true, placeholder: "nvapi-..." },
      { key: "NVIDIA_MODEL", label: "Model", secret: false, optional: true, placeholder: "meta/llama-3.1-8b-instruct" },
      {
        key: "AI_PROVIDER",
        label: "Which provider to use app-wide",
        secret: false,
        optional: true,
        placeholder: "AUTO",
        help: "AUTO (default) uses whichever is configured, preferring the free tier for high-volume work. Set ANTHROPIC or NVIDIA to force one everywhere — chat, call scripts, extraction, and discovery scoring all follow it.",
      },
    ],
    setupSteps: [
      "Sign in at build.nvidia.com.",
      "Open any chat model and click 'Get API Key'.",
      "Paste the key above — no card required.",
    ],
    docsUrl: "https://build.nvidia.com",
    freeTier: "Free tier, no card",
  },
  {
    id: "resend",
    name: "Resend",
    category: "Messaging",
    powers: "Outbound email, invite and password-reset links, and inbound replies matched back to the lead.",
    requiredKeys: ["RESEND_API_KEY"],
    fields: [
      { key: "RESEND_API_KEY", label: "API key", secret: true, placeholder: "re_..." },
      { key: "RESEND_FROM_EMAIL", label: "From address", secret: false, placeholder: "leads@yourdomain.com" },
      {
        key: "RESEND_INBOUND_WEBHOOK_SECRET",
        label: "Inbound webhook secret",
        secret: true,
        optional: true,
        placeholder: "whsec_...",
        help: "Only needed to receive borrower replies",
      },
      {
        key: "RESEND_WEBHOOK_SECRET",
        label: "Delivery webhook secret",
        secret: true,
        optional: true,
        placeholder: "whsec_...",
        help: "Without this, sent email never advances to delivered or bounced",
      },
    ],
    setupSteps: [
      "Create an account at resend.com and verify your sending domain.",
      "Create an API key and paste it above.",
      "For delivery tracking: add a webhook for the 'email.sent', 'email.delivered', and 'email.bounced' events pointing at /api/webhooks/delivery/resend, then paste its signing secret above. Without it, every email stays 'sent' forever and a bounce is never noticed.",
      "For inbound replies: add a webhook for the 'email.received' event pointing at /api/webhooks/resend-inbound, then paste its signing secret above.",
    ],
    docsUrl: "https://resend.com",
    freeTier: "3,000 emails/month free",
  },
  {
    id: "vapi",
    name: "Vapi",
    category: "Voice AI",
    powers: "Live conversational AI qualification calls — the 'AI call' button on a lead.",
    requiredKeys: ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_WEBHOOK_SECRET"],
    fields: [
      { key: "VAPI_API_KEY", label: "Private API key", secret: true },
      { key: "VAPI_PHONE_NUMBER_ID", label: "Phone number ID", secret: false, help: "The number's id, not the number itself" },
      { key: "VAPI_WEBHOOK_SECRET", label: "Webhook secret", secret: true, help: "Any random string — generate with: openssl rand -hex 32" },
    ],
    setupSteps: [
      "Create an account at vapi.ai and copy your private API key.",
      "Add a phone number: buy one in Vapi, or import your existing Telnyx/Twilio number. Copy that number's id (not the number).",
      "Generate any random string for the webhook secret. The app sends it on every call and Vapi echoes it back, so the webhook can verify the request is genuine.",
      "Set APP_URL under Platform below (or rely on Vercel's automatic URL) so the callback resolves.",
    ],
    docsUrl: "https://vapi.ai",
  },
  {
    id: "rentcast",
    name: "RentCast",
    category: "Data",
    powers: "Property valuation and AVM lookups. Only fires for leads that gave a street address.",
    requiredKeys: ["PROPERTY_DATA_API_KEY"],
    fields: [{ key: "PROPERTY_DATA_API_KEY", label: "API key", secret: true }],
    setupSteps: ["Sign up at rentcast.io.", "Copy your API key from the dashboard and paste it above."],
    docsUrl: "https://rentcast.io",
    freeTier: "50 lookups/month free, no card",
  },
  {
    id: "reddit",
    name: "Lead discovery (Arctic Shift)",
    category: "Data",
    powers:
      "Lead discovery — finds public posts showing refinance or equity intent for a human to review. Never contacts anyone automatically.",
    requiredKeys: [],
    fields: [],
    setupSteps: [
      "Nothing to configure — this reads a public, no-auth archive and is live by default.",
      "Reddit's own API needed a 'script' app from reddit.com/prefs/apps, which is no longer dependably available. We removed that dependency rather than leaving the feature broken.",
      "Discovered posts are review-only signals. They are not leads and cannot be called, texted, or emailed by the cadence — nobody found this way has given consent.",
    ],
    docsUrl: "https://arctic-shift.photon-reddit.com",
    freeTier: "Free, no account or API key",
  },
  {
    id: "docusign",
    name: "DocuSign",
    category: "Data",
    powers:
      "Send disclosures and loan documents for electronic signature from a lead, and track signing status back onto the document.",
    requiredKeys: ["DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_INTEGRATION_KEY", "DOCUSIGN_USER_ID", "DOCUSIGN_PRIVATE_KEY"],
    fields: [
      { key: "DOCUSIGN_ACCOUNT_ID", label: "Account ID", secret: false, help: "Settings \u2192 Apps and Keys" },
      { key: "DOCUSIGN_INTEGRATION_KEY", label: "Integration key (client ID)", secret: false },
      { key: "DOCUSIGN_USER_ID", label: "Impersonated user ID", secret: false, help: "The API user consent is granted for" },
      { key: "DOCUSIGN_PRIVATE_KEY", label: "RSA private key", secret: true, placeholder: "-----BEGIN RSA PRIVATE KEY-----" },
    ],
    setupSteps: [
      "Create a developer account at developers.docusign.com and add an app under Settings \u2192 Apps and Keys.",
      "Generate an RSA keypair and grant JWT consent for the impersonated user, or authentication will fail on the first send.",
      "An e-signature on a mortgage disclosure is governed by ESIGN/UETA: the borrower must affirmatively consent to electronic records and be able to retain a copy. Confirm your template captures that before sending anything real.",
    ],
    docsUrl: "https://developers.docusign.com",
    freeTier: "Free developer sandbox; production requires a paid plan",
  },
  {
    id: "isoftpull",
    name: "iSoftpull",
    category: "Data",
    powers: "Soft credit inquiry at the pre-qualification gate — returns a real credit band without affecting the borrower's score.",
    requiredKeys: ["ISOFTPULL_API_KEY", "ISOFTPULL_API_SECRET"],
    fields: [
      { key: "ISOFTPULL_API_KEY", label: "API token", secret: true, placeholder: "..." },
      { key: "ISOFTPULL_API_SECRET", label: "API secret", secret: true, placeholder: "..." },
    ],
    setupSteps: [
      "Sign up at isoftpull.com and complete their onboarding — they verify the business before enabling live pulls.",
      "A soft pull is a consumer report under FCRA. You must have a permissible purpose and the borrower's authorisation on file; the intake form captures that authorisation at the pre-qualification checkbox.",
      "Copy the API token and secret from your iSoftpull dashboard and paste them above.",
      "Inquiries are billed per pull. The app only fires one after the borrower crosses the pre-qualification gate, and never more than once per lead.",
    ],
    docsUrl: "https://isoftpull.com",
    freeTier: "Billed per inquiry — no free tier",
  },
  {
    id: "platform",
    name: "Platform",
    category: "Platform",
    powers: "Base URL for email links and webhook callbacks, cron protection, and the NMLS ID shown in the public footer.",
    requiredKeys: [],
    fields: [
      { key: "APP_URL", label: "Public app URL", secret: false, optional: true, placeholder: "https://equityflowgroup.com", help: "Leave blank on Vercel — falls back to the deployment URL" },
      { key: "CRON_SECRET", label: "Cron secret", secret: true, optional: true, help: "Required in production — the cadence endpoint refuses to run without it" },
      { key: "COMPANY_NMLS_ID", label: "Company NMLS ID", secret: false, optional: true, help: "Shown in the public footer; a visible placeholder appears until set" },
      {
        key: "DELIVERY_WEBHOOK_SECRET",
        label: "Delivery webhook secret",
        secret: true,
        optional: true,
        help: "Authenticates carrier delivery callbacks. Until it is set, texts and calls stay 'sent' and a carrier rejection is never seen.",
      },
      {
        key: "INBOUND_PHONE_NUMBER",
        label: "Inbound phone number",
        secret: false,
        optional: true,
        placeholder: "+12132892042",
        help: "The number borrowers call in on. Shown to officers on each lead so they know which line to expect a callback from.",
      },
    ],
    setupSteps: [
      "APP_URL only needs setting if you're not on Vercel, or you're using a custom domain that differs from the deployment URL.",
      "Generate a cron secret with: openssl rand -hex 32",
      "Generate a delivery webhook secret the same way. Then point Twilio's StatusCallback (or Telnyx's messaging-profile webhook) at /api/webhooks/delivery/twilio (or /telnyx) — the app appends the secret to the URL automatically when sending, so you only need to paste it here.",
      "Set your real NMLS ID before sharing the public site — until then the footer shows an obvious placeholder rather than a fake-looking number.",
    ],
  },
];

export function findIntegration(id: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

/** Every field key across every integration — used to validate that an admin
 *  can only write keys the product actually reads. */
export const ALL_INTEGRATION_KEYS: string[] = INTEGRATIONS.flatMap((i) => i.fields.map((f) => f.key));

export function isSecretKey(key: string): boolean {
  for (const i of INTEGRATIONS) {
    const f = i.fields.find((x) => x.key === key);
    if (f) return f.secret;
  }
  return true; // unknown key: assume secret, fail safe
}
