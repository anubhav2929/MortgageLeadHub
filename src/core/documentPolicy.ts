// What may be attached to a lead, and how large.
//
// Lives in core rather than beside the server action because a "use server"
// module may only export async functions — exporting a plain constant from
// there fails the build with a message that does not name the constant. It
// also belongs here on the merits: these are policy limits, and the upload
// form needs the same numbers the server enforces.

/**
 * Hard cap on inline document size.
 *
 * Files are stored as data URIs inside the record store, so an unbounded
 * upload would bloat every read of the whole database, not just this lead's.
 * 5 MB comfortably covers a scanned paystub or a signed PDF; anything larger
 * is a sign the deployment needs real blob storage, which is what
 * LeadDocument.storageRef exists for.
 */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/**
 * Formats accepted for upload. Deliberately a whitelist: an officer should
 * never be able to attach an executable to a lead record that other staff
 * will later click on.
 */
export const ALLOWED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** Approximate decoded byte length of a base64 data URI, without allocating
 *  the decoded buffer just to measure it. */
export function dataUriBytes(dataUri: string): number {
  const comma = dataUri.indexOf(",");
  const payload = comma === -1 ? dataUri : dataUri.slice(comma + 1);
  return Math.floor(payload.length * 0.75);
}
