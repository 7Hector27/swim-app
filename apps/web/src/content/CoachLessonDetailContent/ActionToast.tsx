"use client";

import { useEffect, useState } from "react";

import styles from "./ActionToast.module.css";

// Confirmation toast shown after the approve / decline / no-show
// server actions redirect back to the lesson detail page with
// ?action=<kind>. Mounts on page load, renders at the bottom of the
// viewport with a short slide-up + fade (220ms enter / 180ms exit via
// data-state attribute). Transitions, not keyframes — if the coach
// chains actions back-to-back the second toast retargets smoothly
// instead of restarting from zero. Auto-dismisses after 2.6 seconds.
// Reduced motion drops the translate and keeps opacity.
//
// No undo affordance per spec. Live region so screen readers announce
// the outcome.

const COPY: Record<ActionToastKind, string> = {
  approved: "Lesson approved.",
  declined: "Lesson declined.",
  no_show: "Marked as no-show.",
};

export type ActionToastKind = "approved" | "declined" | "no_show";

export default function ActionToast({ action }: { action: ActionToastKind }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 2600);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      data-state={visible ? "open" : "closed"}
      data-testid="coach-action-toast"
      className={`${styles.toast} pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4`}
    >
      <p className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-heading text-background font-body font-semibold text-sm px-5 py-3 shadow-lg">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3.5 8.5 7 12l6-7"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {COPY[action]}
      </p>
    </div>
  );
}
