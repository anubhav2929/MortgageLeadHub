/**
 * Renders admin-authored legal copy.
 *
 * Deliberately NOT dangerouslySetInnerHTML. This content is edited in the
 * admin panel and served to the public internet, so treating it as markup
 * would make any admin account — or anyone who compromises one — a stored-XSS
 * vector against every visitor, including borrowers mid-application.
 *
 * React escapes text children, so splitting on blank lines and rendering
 * paragraphs is safe by construction rather than by sanitiser. A line that
 * ends in a colon and is short enough to be a label becomes a heading, which
 * covers the only structure legal prose actually needs.
 */
export function LegalBody({ body }: { body: string }) {
  const blocks = body
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className="mt-8 space-y-6 text-[13.5px] leading-relaxed text-[var(--mkt-body)]">
      {blocks.map((block, i) => {
        const isHeading = block.length < 80 && !block.includes("\n") && /[:.]?$/.test(block) && block.endsWith(":");
        if (isHeading) {
          return (
            <h2 key={i} className="text-[15px] font-semibold text-[var(--mkt-ink)]">
              {block.replace(/:$/, "")}
            </h2>
          );
        }
        // Single newlines inside a block stay as line breaks rather than
        // collapsing, so lists an admin types actually look like lists.
        return (
          <p key={i} className="whitespace-pre-line">
            {block}
          </p>
        );
      })}
    </div>
  );
}
