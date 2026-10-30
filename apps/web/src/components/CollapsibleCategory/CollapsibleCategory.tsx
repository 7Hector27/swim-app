"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

interface CollapsibleCategoryProps {
  // Slugs for every skill rendered inside this category. If the current URL
  // hash is `#skill-<slug>` and the slug sits in this list, the details
  // auto-opens on mount and scrolls the target row into view.
  categorySlugs: string[];
  // Content for the <summary> row (caller controls chevron, name, meta).
  summary: ReactNode;
  className?: string;
  summaryClassName?: string;
  summaryStyle?: CSSProperties;
  children: ReactNode;
}

// Hash patterns we expand on. Keep this union with any route-level deep link
// (`#skill-<slug>` is the one the former wins list used, and any skill-row
// anchor added via `id="skill-<slug>"`).
const SKILL_HASH_PATTERN = /^skill-(.+)$/;

// A collapsible category wrapper for the two progress pages. Every category
// starts collapsed; the one whose slugs match the current URL hash opens on
// mount and scrolls to the targeted row. Lives in a client component so it
// can read `window.location.hash` without SSR divergence (initial render
// matches the server's "closed" state; the effect runs only on the client).
export default function CollapsibleCategory({
  categorySlugs,
  summary,
  className,
  summaryClassName,
  summaryStyle,
  children,
}: CollapsibleCategoryProps) {
  const [open, setOpen] = useState(false);

  // Open on hash match. Serialized set via JSON so the dependency array stays
  // stable across renders without pulling in a referential helper.
  const slugKey = categorySlugs.join("|");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const anchoredSlug = parseSkillHash(window.location.hash);
    if (!anchoredSlug) return;
    if (!categorySlugs.includes(anchoredSlug)) return;
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey]);

  // Scroll into view after `open` is applied so the row's layout box exists.
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    const anchoredSlug = parseSkillHash(window.location.hash);
    if (!anchoredSlug) return;
    if (!categorySlugs.includes(anchoredSlug)) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`skill-${anchoredSlug}`);
      if (target) target.scrollIntoView({ block: "start", behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slugKey]);

  return (
    <details
      className={className}
      open={open}
      onToggle={(event) => {
        const next = (event.target as HTMLDetailsElement).open;
        if (next !== open) setOpen(next);
      }}
    >
      <summary
        className={summaryClassName}
        {...(summaryStyle !== undefined && { style: summaryStyle })}
      >
        {summary}
      </summary>
      {children}
    </details>
  );
}

function parseSkillHash(rawHash: string): string | null {
  const normalized = rawHash.replace(/^#/, "");
  const match = SKILL_HASH_PATTERN.exec(normalized);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    // Malformed hash — ignore quietly rather than throwing on render.
    return null;
  }
}
