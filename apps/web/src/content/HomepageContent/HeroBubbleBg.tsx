"use client";

import { useEffect, useRef } from "react";

// Fixed array — no Math.random at render so SSR and client match exactly.
// diameter in px, cx/cy as % of container, duration in seconds.
const bubbles = [
  { cx:  8, cy: 90, d: 12, delay:  0.0, duration: 13, drift:  6 },
  { cx: 18, cy: 78, d:  8, delay:  2.5, duration: 17, drift:  4 },
  { cx: 32, cy: 85, d: 20, delay:  1.0, duration: 14, drift:  8 },
  { cx: 45, cy: 92, d: 14, delay:  4.0, duration: 11, drift:  5 },
  { cx: 55, cy: 80, d:  8, delay:  6.0, duration: 16, drift:  6 },
  { cx: 68, cy: 88, d: 24, delay:  3.0, duration: 12, drift:  9 },
  { cx: 78, cy: 75, d: 16, delay:  5.5, duration: 15, drift:  7 },
  { cx: 88, cy: 93, d: 10, delay:  1.5, duration: 17, drift:  4 },
  { cx: 92, cy: 82, d: 32, delay:  7.0, duration: 13, drift: 10 },
  { cx: 22, cy: 70, d: 18, delay:  8.0, duration: 14, drift:  8 },
  { cx: 38, cy: 87, d:  8, delay:  2.0, duration: 16, drift:  5 },
  { cx: 62, cy: 73, d: 48, delay:  9.0, duration: 18, drift: 12 },
  { cx: 75, cy: 95, d: 14, delay:  4.5, duration: 15, drift:  6 },
  { cx: 85, cy: 68, d: 10, delay:  6.5, duration: 17, drift:  4 },
  { cx: 12, cy: 96, d: 22, delay:  3.5, duration: 12, drift:  9 },
];

export default function HeroBubbleBg() {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  // Pause animations when hero is offscreen (same pattern as old HeroWaterBg).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const state =
          entry !== undefined && entry.isIntersecting ? "running" : "paused";
        container
          .querySelectorAll<HTMLElement>(".bubble")
          .forEach((el) => {
            el.style.animationPlayState = state;
          });
      },
      { threshold: 0 },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Desktop parallax: rAF-throttled, pointer:fine only, disabled under prefers-reduced-motion.
  useEffect(() => {
    const layer = layerRef.current;
    const hero = containerRef.current?.parentElement;
    if (!layer || !hero) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const isFinePointer = window.matchMedia("(pointer: fine)").matches;
    if (prefersReduced || !isFinePointer) return;

    let rafId = 0;
    let pendingX = 0;
    let pendingY = 0;

    function onMove(event: MouseEvent) {
      const rect = hero!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      // Map ±half-width/height → ±6px shift (opposite direction = depth illusion).
      pendingX = -((event.clientX - cx) / (rect.width / 2)) * 6;
      pendingY = -((event.clientY - cy) / (rect.height / 2)) * 4;

      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        // layer was narrowed to non-null above; re-check for TypeScript in closures.
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
      className="absolute inset-0 pointer-events-none overflow-hidden"
    >
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes bubble-rise {
            0%   { transform: translateY(0)     translateX(0px); opacity: 0; }
            8%   { opacity: 0.9; }
            92%  { opacity: 0.9; }
            100% { transform: translateY(-110%) translateX(var(--drift)); opacity: 0; }
          }
        }
      `}</style>

      <div ref={layerRef} className="absolute inset-0 will-change-transform">
        {bubbles.map((b, i) => (
          <div
            key={i}
            className="bubble absolute rounded-full"
            style={{
              width:  b.d,
              height: b.d,
              left:   `${b.cx}%`,
              top:    `${b.cy}%`,
              // accent-tinted fill + slightly lighter ring
              background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
              outline: "1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)",
              opacity: 0.7 - i * 0.02,
              // CSS custom prop for the drift direction so keyframe can read it.
              "--drift": `${i % 2 === 0 ? b.drift : -b.drift}px`,
              animationName: "bubble-rise",
              animationDuration: `${b.duration}s`,
              animationDelay: `${b.delay}s`,
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
              animationPlayState: "running",
            } as React.CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
