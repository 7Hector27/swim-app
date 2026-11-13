"use client";

// Subtle one-shot acknowledgment when a swimmer's grade on this skill
// first crosses into 5 during the session. Lives in the skill row's
// legend alongside PrevBadge. Presence is controlled by the parent —
// mount triggers the @starting-style enter; the parent unmounts the
// badge after ~2s. Reduced motion drops the scale and keeps a short
// opacity fade.

import styles from "./EvaluateContent.module.css";

export default function MasteryBadge() {
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="mastery-badge"
      className={`${styles.masteryBadge} inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-bold uppercase tracking-wide`}
      style={{
        color: "var(--color-on-accent)",
        backgroundColor: "var(--color-accent)",
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2.5 6.5 4.5 8.5 9.5 3.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Mastered
    </span>
  );
}
