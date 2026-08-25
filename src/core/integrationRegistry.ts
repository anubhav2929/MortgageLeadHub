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
  multiline?: boolean;
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
      { key: "TELNYX_PUBLIC_KEY", label: "Webhook Ed25519 public key", secret: false, optional: true, help: "Portal → Account Settings → Public Key. Required by the signed unified webhook." },
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
      "For calls: create a TeXML Application under Voice → TeXML Applications, assign your number to it, and paste its ID plus your Account ID above. Each script fetch is authenticated with a short-lived per-call token.",
    ],
    docsUrl: "https://portal.telnyx.com",
    alternativeNote: "Roughly half Twilio's per-segment cost with 10DLC registration built in.",
  },
  {
    id: "openai",
    name: "OpenAI",
    category: "AI",
    powers: "Primary or fallback AI for extraction, summaries, action items, drafting, chat, classification, and discovery.",
    requiredKeys: ["OPENAI_API_KEY"],
    fields: [
      { key: "OPENAI_API_KEY", label: "API key", secret: true, placeholder: "sk-..." },
      { key: "OPENAI_MODEL", label: "Model", secret: false, optional: true, placeholder: "gpt-5.4-mini" },
      { key: "AI_PROVIDER_PRIORITY", label: "Global provider priority", secret: false, optional: true, placeholder: "OPENAI,ANTHROPIC,NVIDIA", help: "First configured provider is primary across all compatible AI surfaces." },
    ],
    setupSteps: [
      "Create a project API key in the OpenAI platform.",
      "Choose a model that supports the required structured output.",
      "Place OPENAI first in the global priority to make it primary.",
    ],
    docsUrl: "https://developers.openai.com/api/docs/models",
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
    fields: [
      { key: "ANTHROPIC_API_KEY", label: "API key", secret: true, placeholder: "sk-ant-..." },
      { key: "ANTHROPIC_MODEL", label: "Model", secret: false, optional: true, placeholder: "claude-sonnet-5" },
    ],
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
      { key: "VAPI_VOICE_ID", label: "Voice", secret: false, optional: true, placeholder: "Savannah", help: "Vapi built-in voices, no extra account needed: Elliot, Savannah, Rohan, Emma, Clara, Nico, Kai." },
      { key: "VAPI_MODEL_PROVIDER", label: "Model provider", secret: false, optional: true, placeholder: "openai" },
      { key: "VAPI_MODEL", label: "Model", secret: false, optional: true, placeholder: "gpt-4o-mini" },
      { key: "VAPI_MAX_DURATION_SECONDS", label: "Maximum call duration", secret: false, optional: true, placeholder: "900" },
      { key: "VAPI_WAIT_SECONDS", label: "Endpointing wait (seconds)", secret: false, optional: true, placeholder: "0.8", help: "Pause before the assistant responds; tune through recorded UAT." },
      { key: "VAPI_INTERRUPTION_WORDS", label: "Interruption threshold (words)", secret: false, optional: true, placeholder: "2" },
      { key: "VAPI_INTERRUPTION_VOICE_SECONDS", label: "Interruption voice threshold (seconds)", secret: false, optional: true, placeholder: "0.2" },
      { key: "VAPI_BACKOFF_SECONDS", label: "Interruption backoff (seconds)", secret: false, optional: true, placeholder: "1" },
      { key: "VAPI_WEBHOOK_SECRET", label: "Webhook secret", secret: true, help: "Any random string — generate with: openssl rand -hex 32" },
      { key: "VAPI_WEBHOOK_CREDENTIAL_ID", label: "Webhook credential ID", secret: false, optional: true, help: "Vapi Custom Credential used for signed server events." },
      { key: "VAPI_ALLOW_LEGACY_WEBHOOK_AUTH", label: "Allow legacy plaintext webhook auth", secret: false, optional: true, placeholder: "false", help: "Emergency compatibility only. Signed HMAC webhooks are the default." },
      { key: "WARM_TRANSFER_FALLBACK_NUMBER", label: "Central transfer line", secret: false, optional: true, placeholder: "+12135550142", help: "Used only when no active, licensed assigned officer has a valid phone number." },
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
    id: "arctic-shift",
    name: "Lead discovery (Arctic Shift)",
    category: "Data",
    powers:
      "Free read-only lead discovery — finds recent public posts showing refinance or home-equity intent for a human to review. It never contacts anyone automatically.",
    requiredKeys: [],
    fields: [],
    setupSteps: [
      "Nothing to configure — Arctic Shift is a public, no-auth archive and is live by default.",
      "Run Discovery searches recent posts across the curated mortgage and consumer-finance communities, then filters and scores them locally.",
      "Discovered posts remain review-only signals. They are not callable, textable, or emailable CRM leads because no borrower consent was collected.",
      "Reddit OAuth below is separate and is only required for approved, human-confirmed publishing.",
    ],
    docsUrl: "https://arctic-shift.photon-reddit.com",
    freeTier: "Free · no account or API key",
  },
  {
    id: "public-data",
    name: "Free Property Valuation & Public Records",
    category: "Data",
    powers:
      "An independent valuation lane that normalizes addresses, discovers compatible public ArcGIS assessor layers, uses the official keyless Census ACS summary file for neighborhood housing values, applies FHFA sale adjustments, and falls back to RentCast when configured.",
    requiredKeys: [],
    fields: [
      {
        key: "CENSUS_DATA_API_KEY",
        label: "Census Data API key",
        secret: true,
        optional: true,
        placeholder: "Free key from api.census.gov",
        help: "Optional faster API route for official tract/ZIP median owner-occupied home values. Without it, the app uses the keyless official ACS summary file.",
      },
      {
        key: "CENSUS_ACS_YEAR",
        label: "Census ACS vintage",
        secret: false,
        optional: true,
        placeholder: "2024",
        help: "Leave blank for the tested default. Change only after confirming the newer ACS 5-year table is published.",
      },
      {
        key: "BRAVE_SEARCH_API_KEY",
        label: "Brave property-source search API key",
        secret: true,
        optional: true,
        help: "Optional second ranking layer for official .gov and allowlisted property-record pages. ArcGIS public-catalog discovery is built in. Search results never become valuation values.",
      },
      {
        key: "PROPERTY_PUBLIC_RECORD_SOURCES_JSON",
        label: "Public-record source definitions (JSON)",
        secret: false,
        optional: true,
        placeholder: '[{"label":"County assessor","endpoint":"https://.../query","format":"ARCGIS","addressField":"SITE_ADDR"}]',
        multiline: true,
        help: "One or more allowlisted JSON/ArcGIS query APIs. Each source fails independently so one county outage cannot erase all evidence.",
      },
      {
        key: "PROPERTY_RECORD_ALLOWLIST",
        label: "Allowed public-record hosts",
        secret: false,
        optional: true,
        placeholder: "services.arcgis.com,data.county.gov",
        help: "Comma-separated HTTPS hosts. Required for every configured public-record endpoint to prevent server-side request forgery.",
      },
    ],
    setupSteps: [
      "This lane is independent from Arctic Shift lead discovery; either system can fail or run without blocking the other.",
      "Census address normalization, safe ArcGIS hosted-layer discovery, and FHFA sale adjustment are built in. Catalog searches receive locality only—not the street address—and only compatible FeatureServer schemas are queried.",
      "The official keyless ACS summary file provides the nationwide tract benchmark. Optionally save a free Census Data API key to use the smaller direct API response instead.",
      "Optionally add a Brave Search API key as a second source-ranking signal; valuation works without it.",
      "Add each assessor/open-data API host to PROPERTY_RECORD_ALLOWLIST, then add its JSON or ArcGIS source definition.",
      "Configure RentCast in its separate card for the final AVM fallback when public evidence remains insufficient.",
      "Only public/allowlisted property facts enter deterministic valuation; search results and discussion content never supply a dollar value.",
    ],
    docsUrl: "https://api.census.gov/data/key_signup.html",
    freeTier: "Census Geocoder/ACS summary data, ArcGIS discovery, and FHFA built in",
  },
  {
    id: "reddit",
    name: "Reddit OAuth",
    category: "Data",
    powers:
      "Approved Reddit API connection for human-reviewed direct publishing and, when authorized, first-party discovery. It is independent from the read-only public-data adapter.",
    requiredKeys: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_COMMERCIAL_APPROVED"],
    fields: [
      { key: "REDDIT_CLIENT_ID", label: "OAuth client ID", secret: false },
      { key: "REDDIT_CLIENT_SECRET", label: "OAuth client secret", secret: true },
      { key: "REDDIT_COMMERCIAL_APPROVED", label: "Written commercial approval recorded", secret: false, placeholder: "false" },
    ],
    setupSteps: [
      "Obtain and document Reddit approval for API access and commercial use before setting REDDIT_COMMERCIAL_APPROVED=true.",
      "Register a confidential OAuth app and configure this deployment's /api/integrations/reddit/callback URL.",
      "Connect the company account from Lead Discovery. The app requests only identity, read, and submit scopes.",
      "Every response remains human-reviewed: edit the final text, confirm subreddit rules, then explicitly Publish.",
    ],
    docsUrl: "https://www.reddit.com/prefs/apps",
  },
  {
    id: "isoftpull",
    name: "iSoftpull",
    category: "Data",
    powers: "Soft credit inquiry at the pre-qualification gate — returns a real credit band without affecting the borrower's score.",
    requiredKeys: ["ISOFTPULL_API_KEY", "ISOFTPULL_API_SECRET", "CREDIT_LIVE_APPROVED"],
    fields: [
      { key: "ISOFTPULL_API_KEY", label: "API token", secret: true, placeholder: "..." },
      { key: "ISOFTPULL_API_SECRET", label: "API secret", secret: true, placeholder: "..." },
      { key: "CREDIT_LIVE_APPROVED", label: "Counsel-approved live credit gate", secret: false, placeholder: "false", help: "Set to true only after authorization language and permissible-purpose approval." },
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
    id: "analytics",
    name: "Google Analytics & Meta",
    category: "Platform",
    powers: "Consent-aware GA4 funnel events plus Meta Pixel and Conversions API deduplication using shared event IDs.",
    requiredKeys: ["NEXT_PUBLIC_GA_MEASUREMENT_ID"],
    fields: [
      { key: "NEXT_PUBLIC_GA_MEASUREMENT_ID", label: "GA4 measurement ID", secret: false, placeholder: "G-..." },
      { key: "GOOGLE_SITE_VERIFICATION", label: "Google Search Console verification token", secret: false, optional: true },
      { key: "NEXT_PUBLIC_META_PIXEL_ID", label: "Browser Meta Pixel ID", secret: false, optional: true },
      { key: "META_PIXEL_ID", label: "Server Meta dataset/pixel ID", secret: false, optional: true },
      { key: "META_CAPI_ACCESS_TOKEN", label: "Meta CAPI access token", secret: true, optional: true },
      { key: "META_GRAPH_API_VERSION", label: "Reviewed Graph API version", secret: false, optional: true, placeholder: "vXX.0" },
    ],
    setupSteps: [
      "Create GA4 and Meta assets in Aldrish-controlled business accounts.",
      "Save GA, Meta, and Search Console values here. The server passes only the public IDs to the browser after consent; no redeploy is required.",
      "Enable the metaCapi feature flag only after consent-denial and PII-redaction UAT passes.",
      "Never add lead, property, mortgage, credit, transcript, or qualification fields to analytics events.",
    ],
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
        help: "Legacy shared-secret callback compatibility only. New Telnyx and Twilio callbacks use provider-native signatures, and TeXML announcements use per-call tokens.",
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
      "Point Twilio callbacks at /api/webhooks/delivery/twilio and /api/webhooks/inbound/twilio; X-Twilio-Signature is verified with the auth token. Configure Telnyx's signed /api/webhooks/telnyx primary and /failover URLs with TELNYX_PUBLIC_KEY.",
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
