"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Long text collapsed to a few lines with a Read more toggle.
 *
 * Clamped with CSS (`-webkit-line-clamp`) rather than by slicing the string.
 * That distinction matters more than it looks:
 *
 *  - The full text stays in the DOM, so a screen reader, Ctrl+F, and "print
 *    page" all see the complete wording. For a TCPA/FCRA consent disclosure
 *    that is the difference between "presented and collapsed for readability"
 *    and "not actually shown" — only the former is defensible.
 *  - No re-measure or layout thrash on toggle, and no truncation mid-word.
 *
 * The toggle is deliberately NOT rendered inside a <label>: a button nested in
 * a label steals the click and toggles the associated checkbox, so expanding a
 * disclosure would silently tick the consent box next to it.
 */
export function ReadMore({
  text,
  lines = 2,
  className = "",
  moreLabel = "Read more",
  lessLabel = "Show less",
}: {
  text: string;
  /** Lines shown while collapsed. */
  lines?: number;
  className?: string;
  moreLabel?: string;
  lessLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();

  // Short text needs no affordance — a Read more link that reveals half a line
  // is noise. Roughly 62 characters per clamped line at this size.
  const needsToggle = text.length > lines * 62;

  return (
    <div className={className}>
      <p
        id={id}
        className="text-xs leading-relaxed text-[var(--muted-foreground)]"
        style={
          expanded || !needsToggle
            ? undefined
            : {
                display: "-webkit-box",
                WebkitLineClamp: lines,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
        }
      >
        {text}
      </p>

      {needsToggle && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={(e) => {
            // Defence in depth: even outside a <label>, these blocks sit
            // inside clickable cards in the discovery queue.
            e.preventDefault();
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="focus-ring mt-1 inline-flex items-center gap-1 rounded-[var(--radius-sm)] text-xs font-medium text-[var(--primary)] hover:underline"
        >
          {expanded ? lessLabel : moreLabel}
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}
