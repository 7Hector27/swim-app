"use client";

import { useEffect, useRef, useState } from "react";

// Count-up for the balance figure. Honors prefers-reduced-motion by
// jumping straight to the target. Retargeting mid-animation (for
// example when polling after a top-up returns a new balance) starts
// from the currently-displayed value instead of resetting to zero —
// without that, a second update would reset the counter to 0 and
// walk back up, which looks broken. Strong ease-out curve matches
// the rest of the balance page.

const EASE_OUT = (t: number): number => 1 - Math.pow(1 - t, 3);

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState<number>(() =>
    prefersReducedMotion() ? target : 0,
  );
  const targetRef = useRef(target);
  targetRef.current = target;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = valueRef.current;
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      const eased = EASE_OUT(t);
      const next = Math.round(from + (targetRef.current - from) * eased);
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}
