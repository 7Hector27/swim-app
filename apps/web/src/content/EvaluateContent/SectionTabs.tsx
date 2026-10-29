"use client";

import { useEffect, useRef, useState } from "react";

interface SectionTabsProps {
  sections: Array<{ name: string; count: number; completed: number }>;
  activeIndex: number;
  onSelect: (index: number) => void;
}

// Sticky horizontal pill strip. Hides the native scrollbar via the
// `scrollbar-none` utility (kept fully scrollable by touch, trackpad, wheel,
// and keyboard). When the strip overflows, a subtle edge fade appears on
// whichever side has more hidden content. Changing `activeIndex` scrolls
// the active tab into view (nearest, so an already-visible tab doesn't
// jump) and honors prefers-reduced-motion.

export default function SectionTabs({ sections, activeIndex, onSelect }: SectionTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [fadeSide, setFadeSide] = useState<"left" | "right" | null>(null);

  // Observe scroll + resize to decide which edge (if any) gets the fade.
  // The strip is static for most sessions, but ResizeObserver covers the
  // case of orientation change on phone and content reflow.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function recompute() {
      if (!el) return;
      const hiddenLeft = el.scrollLeft;
      const hiddenRight = el.scrollWidth - el.clientWidth - el.scrollLeft;
      // 1px tolerance for subpixel rounding on some browsers.
      if (hiddenLeft <= 1 && hiddenRight <= 1) {
        setFadeSide(null);
      } else if (hiddenLeft > hiddenRight) {
        setFadeSide("left");
      } else {
        setFadeSide("right");
      }
    }

    recompute();
    el.addEventListener("scroll", recompute, { passive: true });
    // ResizeObserver covers orientation change and content reflow. jsdom
    // (used in unit tests) doesn't ship it; guarding keeps the component
    // test-friendly without breaking real browsers.
    const ResizeObserverCtor =
      typeof window !== "undefined"
        ? (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
        : undefined;
    const observer = ResizeObserverCtor ? new ResizeObserverCtor(recompute) : null;
    observer?.observe(el);

    return () => {
      el.removeEventListener("scroll", recompute);
      observer?.disconnect();
    };
  }, [sections.length]);

  // Scroll the active tab into view whenever the selection changes — from
  // a tap, a keyboard move, OR the pre-save validation jump switching the
  // section for the coach. Skip the first mount so landing on a page
  // doesn't jiggle the strip (and so tests don't see a spurious scroll).
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const tab = tabRefs.current[activeIndex];
    if (!tab) return;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    tab.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [activeIndex]);

  return (
    <div className="sticky top-0 z-20 bg-background border-b border-border -mx-page">
      <nav
        aria-label="Evaluation sections"
        ref={scrollRef}
        className="scrollbar-none overflow-x-auto px-page relative"
      >
        <ul className="flex gap-1 w-max min-w-full">
          {sections.map((section, index) => {
            const selected = index === activeIndex;
            const done = section.completed > 0;
            return (
              <li key={section.name}>
                <button
                  type="button"
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  aria-current={selected ? "step" : undefined}
                  onClick={() => onSelect(index)}
                  className="relative px-4 h-12 min-w-[88px] inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-150 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring"
                  style={{ color: selected ? "var(--color-text)" : "var(--color-text-secondary)" }}
                >
                  <span className="font-semibold text-sm">{section.name}</span>
                  <span
                    className="tabular-nums text-[10px] font-bold px-1.5 h-5 rounded-full inline-flex items-center"
                    style={{
                      backgroundColor: done ? "var(--color-accent)" : "transparent",
                      color: done ? "var(--color-on-accent)" : "var(--color-text-secondary)",
                      border: done ? "none" : "1px solid var(--color-border)",
                    }}
                  >
                    {section.completed}/{section.count}
                  </span>
                  {selected && (
                    <span
                      aria-hidden
                      className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full"
                      style={{ backgroundColor: "var(--color-accent)" }}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Edge fade: shown on the side with more hidden content so the coach
          can see there's more to scroll to. Sits outside the scroll area so
          it stays pinned when the user scrolls. Pointer events pass through
          so taps on the first/last tab under the fade still register. */}
      {fadeSide === "left" && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-12"
          style={{
            background:
              "linear-gradient(to right, var(--color-background), transparent)",
          }}
        />
      )}
      {fadeSide === "right" && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-12"
          style={{
            background:
              "linear-gradient(to left, var(--color-background), transparent)",
          }}
        />
      )}
    </div>
  );
}
