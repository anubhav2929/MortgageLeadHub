// SMS length handling.
//
// A GSM-7 segment is 160 characters, or 153 when a message is split across
// several. Going long is not an error — carriers concatenate — but each extra
// segment is billed separately and increases the chance a message is split
// oddly on an older handset. 320 keeps us to two segments.

export const SMS_MAX_CHARS = 320;

/**
 * Trims to the limit at a word boundary.
 *
 * The previous behaviour sliced at a fixed index and appended an ellipsis,
 * which routinely cut a word in half — a borrower receiving "we can look at
 * your refina…" reads it as a broken system, not a busy one. Trimming to the
 * last complete word costs a few characters and reads as deliberate.
 */
export function clampSms(body: string, max = SMS_MAX_CHARS): string {
  const text = body.trim();
  if (text.length <= max) return text;

  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // A single unbroken token longer than the limit has no word boundary to
  // find; fall back to a hard cut rather than returning an empty string.
  const trimmed = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.replace(/[,;:\-\u2014]$/, "")}\u2026`;
}
