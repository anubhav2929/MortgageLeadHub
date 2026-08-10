// Resolving which "From" address an outbound email actually uses.
//
// This is fiddly enough to deserve its own tested function. Two settings
// compete:
//
//   Admin → Settings  senderName / senderEmail — the display identity the
//                     business wants borrowers to see.
//   Admin → Integrations  RESEND_FROM_EMAIL — an address on a domain Resend
//                     has actually verified.
//
// Only the second one is allowed to leave the building. Resend rejects any
// send from an unverified domain, so a nicely-worded sender identity on a
// domain nobody verified is not a preference — it is a hard delivery failure.
//
// The bug this replaces: the adapter did `input.from || configured || default`,
// and every caller always supplied `input.from`. So RESEND_FROM_EMAIL was
// dead config — an admin could set it, see it saved, and still have every
// email fail.

/** Domains that only ever appear as unconfigured placeholders. */
const PLACEHOLDER_DOMAINS = ["equityflowgroup.demo", "example.com", "localhost"];

function addressOf(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim();
}

function displayNameOf(from: string): string | null {
  const match = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return match ? match[1].trim() : null;
}

export function isPlaceholderAddress(address: string): boolean {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  return PLACEHOLDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Decide the From header for an outbound email.
 *
 * Precedence, deliberately not "first non-empty wins":
 *  1. A verified address configured in Integrations always supplies the
 *     address, because it is the only one that can actually send.
 *  2. The caller's display name is preserved on top of it, so borrowers still
 *     see the business identity from Settings.
 *  3. Only if nothing is configured do we fall back to the caller's own
 *     address — which in practice means the demo placeholder, and which only
 *     matters on the simulated path where nothing is really sent.
 */
export function resolveSenderAddress(callerFrom: string | undefined, configuredFrom: string | undefined): string {
  const configured = configuredFrom?.trim();
  const caller = callerFrom?.trim();

  if (configured) {
    const configuredAddress = addressOf(configured);
    // A display name in the configured value wins; otherwise borrow the
    // caller's, so "Equity Flow Group <leads@verified.com>" is possible even
    // when Integrations only holds a bare address.
    const name = displayNameOf(configured) ?? (caller ? displayNameOf(caller) : null);
    return name ? `${name} <${configuredAddress}>` : configuredAddress;
  }

  return caller || "leads@equityflowgroup.demo";
}

/**
 * Whether this send is going to fail for sender-configuration reasons.
 * Lets the caller surface a precise warning instead of waiting for Resend to
 * reject it with a generic domain error.
 */
export function senderConfigWarning(resolvedFrom: string): string | null {
  const address = addressOf(resolvedFrom);
  if (!address.includes("@")) return "Sender address is not a valid email address.";
  if (isPlaceholderAddress(address)) {
    return `Sending from ${address}, which is a placeholder domain that no provider will accept. Set a verified address under Admin → Integrations → Resend.`;
  }
  return null;
}
