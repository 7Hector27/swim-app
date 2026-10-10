"use client";

import { useEffect, useRef } from "react";

import styles from "./HeroBubbleBg.module.css";

// Fixed array — no Math.random at render so SSR and client produce identical HTML.
// phase (0–1): determines negative rise delay = -(phase × duration).
// Distributing phases evenly means bubbles are already at every height on first load.
// Bigger bubbles rise slower (duration scales with size) so the scene feels calm.
const bubbles = [
  { cx:  4, cy: 88, d: 10, duration: 10.0, phase: 0.00, opacity: 0.60, swayPx:  4, swayDuration: 3.2 },
  { cx: 12, cy: 72, d: 16, duration: 11.5, phase: 0.06, opacity: 0.70, swayPx:  6, swayDuration: 4.5 },
  { cx: 21, cy: 55, d:  8, duration:  9.5, phase: 0.13, opacity: 0.55, swayPx:  3, swayDuration: 2.8 },
  { cx: 28, cy: 80, d: 22, duration: 12.5, phase: 0.19, opacity: 0.65, swayPx:  8, swayDuration: 3.8 },
  { cx: 37, cy: 42, d: 12, duration: 10.5, phase: 0.25, opacity: 0.60, swayPx:  5, swayDuration: 2.5 },
  { cx: 45, cy: 65, d: 48, duration: 18.0, phase: 0.31, opacity: 0.45, swayPx: 16, swayDuration: 5.0 },
  { cx: 52, cy: 90, d: 10, duration: 10.0, phase: 0.38, opacity: 0.65, swayPx:  4, swayDuration: 3.5 },
  { cx: 60, cy: 35, d: 18, duration: 11.5, phase: 0.44, opacity: 0.70, swayPx:  7, swayDuration: 4.0 },
  { cx: 67, cy: 75, d: 24, duration: 13.0, phase: 0.50, opacity: 0.60, swayPx:  9, swayDuration: 4.6 },
  { cx: 74, cy: 50, d: 14, duration: 11.0, phase: 0.56, opacity: 0.65, swayPx:  5, swayDuration: 3.0 },
  { cx: 81, cy: 25, d: 32, duration: 15.0, phase: 0.63, opacity: 0.50, swayPx: 11, swayDuration: 5.0 },
  { cx: 88, cy: 62, d:  8, duration:  9.5, phase: 0.69, opacity: 0.60, swayPx:  3, swayDuration: 2.5 },
  { cx: 93, cy: 83, d: 20, duration: 12.0, phase: 0.75, opacity: 0.65, swayPx:  7, swayDuration: 3.8 },
  { cx: 97, cy: 45, d: 12, duration: 10.5, phase: 0.81, opacity: 0.70, swayPx:  4, swayDuration: 3.2 },
  { cx: 15, cy: 68, d: 28, duration: 14.0, phase: 0.88, opacity: 0.55, swayPx: 10, swayDuration: 4.8 },
  { cx: 50, cy: 30, d: 14, duration: 11.0, phase: 0.94, opacity: 0.65, swayPx:  5, swayDuration: 3.6 },
];

export default function HeroBubbleBg() {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  // Pause CSS animations when hero is offscreen — saves GPU work.
  // Sets --anim-state CSS variable which both .bubbleOuter and .bubbleInner inherit.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        container.style.setProperty(
          "--anim-state",
          entry !== undefined && entry.isIntersecting ? "running" : "paused",
        );
      },
      { threshold: 0 },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // rAF-throttled parallax on the whole layer — pointer:fine only, reduced-motion off.
  useEffect(() => {
    const layer = layerRef.current;
    const hero = containerRef.current?.parentElement;
    if (!layer || !hero) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isFinePointer = window.matchMedia("(pointer: fine)").matches;
    if (prefersReduced || !isFinePointer) return;

    let rafId = 0;
    let pendingX = 0;
    let pendingY = 0;

    function onMove(event: MouseEvent) {
      const rect = hero!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      pendingX = -((event.clientX - cx) / (rect.width / 2)) * 6;
      pendingY = -((event.clientY - cy) / (rect.height / 2)) * 4;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        if (layerRef.current) {
          layerRef.current.style.transform = `translate(${pendingX}px, ${pendingY}px)`;
        }
        rafId = 0;
      });
    }

    hero.addEventListener("mousemove", onMove);
    return () => {
      hero.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`absolute inset-0 pointer-events-none overflow-hidden ${styles.container}`}
    >
      <div ref={layerRef} className="absolute inset-0 will-change-transform">
        {bubbles.map((bubble, index) => (
          <div
            key={index}
            className={styles.bubbleOuter}
            style={{
              left:   `${bubble.cx}%`,
              width:  bubble.d,
              height: bubble.d,
              // Positioning: starts just below the container bottom edge
              "--b-bottom": `-${bubble.d}px`,
              // Reduced-motion static position
              "--cy": `${bubble.cy}%`,
              // Rise animation timing
              "--rise-duration": `${bubble.duration}s`,
              "--rise-delay":    `-${(bubble.phase * bubble.duration).toFixed(2)}s`,
              "--opacity":       String(bubble.opacity),
              // Sway — inherited by the inner child
              "--sway-px":       `${bubble.swayPx}px`,
              "--sway-duration": `${bubble.swayDuration}s`,
              // Alternate starting phase per bubble so neighbours don't sway in sync
              "--sway-delay": index % 2 === 0
                ? "0s"
                : `${(-bubble.swayDuration / 2).toFixed(2)}s`,
            } as React.CSSProperties}
          >
            <div className={styles.bubbleInner} />
          </div>
        ))}
      </div>
    </div>
  );
}
