"use client";

import { useEffect, useRef, useState } from "react";

interface NavItem {
  id: string;
  label: string;
}

interface Props {
  items: NavItem[];
}

// Suppress observer-driven updates for this long after a click so the smooth
// scroll animation doesn't briefly re-highlight sections the page is passing
// through on its way to the clicked target.
const CLICK_SUPPRESS_MS = 800;

// Left-rail nav for /account on desktop. Each link scrolls to the section
// card's anchor. Hidden below the desktop breakpoint — mobile and tablet
// users read the stacked cards straight through. A scrollspy driven by
// IntersectionObserver keeps exactly one item active at a time.
export default function AccountSectionNav({ items }: Props) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");
  // Timestamp of the most recent click. Observer updates within
  // CLICK_SUPPRESS_MS are ignored so the clicked item stays active
  // throughout the smooth-scroll animation.
  const suppressUntilRef = useRef<number>(0);

  useEffect(() => {
    if (items.length === 0) return;
    const lastId = items[items.length - 1]!.id;

    // Read --header-height at runtime so the observer band matches the
    // sticky-top offset exactly. rootMargin only accepts a string with px
    // units, so the CSS variable is resolved once here.
    const rootStyles = getComputedStyle(document.documentElement);
    const headerHeight = parseFloat(rootStyles.getPropertyValue("--header-height")) || 64;
    // rem baseline from the root font-size — matches `1rem` in CSS.
    const remPx = parseFloat(rootStyles.fontSize) || 16;
    const topOffsetPx = Math.round(headerHeight + remPx);

    // A short last section may never enter the scrollspy's top band before
    // the page runs out of scrollable room. When the viewport is at the
    // bottom, force the last section active regardless of what the observer
    // sees.
    function isAtBottom(): boolean {
      // 2px slack for sub-pixel rounding.
      return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < suppressUntilRef.current) return;
        if (isAtBottom()) {
          setActiveId(lastId);
          return;
        }
        // The rootMargin below defines a thin band just below the header.
        // Any section whose top sits in that band is "intersecting" from
        // the observer's point of view; the topmost one wins.
        const intersecting = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const topmost = intersecting[0];
        if (topmost) setActiveId(topmost.target.id);
      },
      {
        // Band = (header + 1rem) from the top down to 60% from the top. A
        // section counts as active the moment its top passes under the
        // header. 60% keeps the active state tied to the section currently
        // sitting under the gaze, not whichever one happens to be scrolling
        // past the fold.
        rootMargin: `-${topOffsetPx}px 0px -60% 0px`,
        threshold: 0,
      },
    );

    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }

    // Bottom-of-page detection runs on scroll because a short last section
    // may never enter the observer band at all.
    function onScroll() {
      if (Date.now() < suppressUntilRef.current) return;
      if (isAtBottom()) setActiveId(lastId);
    }
    window.addEventListener("scroll", onScroll, { passive: true });

    // Prime on mount: if the page loads scrolled to the bottom (e.g. via
    // anchor) the fallback below wins immediately.
    if (isAtBottom()) setActiveId(lastId);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [items]);

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    // Mark the clicked item active immediately so the highlight follows
    // the user's intent without waiting for the smooth-scroll to settle.
    suppressUntilRef.current = Date.now() + CLICK_SUPPRESS_MS;
    setActiveId(id);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    // Keep the URL in sync so refresh/share retains the current section.
    history.replaceState(null, "", `#${id}`);
    // Move focus to the section heading so screen readers announce it.
    const heading = target.querySelector<HTMLElement>("h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }

  return (
    <nav
      aria-label="Account sections"
      className="hidden desktop:block sticky top-[calc(var(--header-height)+1rem)] self-start w-56 flex-shrink-0"
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={isActive ? "location" : undefined}
                onClick={(event) => handleClick(event, item.id)}
                className={[
                  "flex items-center min-h-[44px] px-3 rounded-button text-sm font-semibold",
                  "transition-colors duration-150 motion-reduce:transition-none",
                  isActive
                    ? "bg-surface-soft text-link"
                    : "text-text hover:text-link-hover hover:bg-surface-soft",
                ].join(" ")}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
