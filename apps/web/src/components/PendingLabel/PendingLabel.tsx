"use client";

import styles from "./PendingLabel.module.css";

interface Props {
  isPending: boolean;
  label: string;
  pendingLabel: string;
}

// Button label with a short blur + opacity crossfade whenever isPending flips.
// The keyed inner span triggers @starting-style on each change, so the swap
// does not read as a flicker. Final text is always present in the DOM, so
// tests that match on either string still find it in the final state.
export default function PendingLabel({ isPending, label, pendingLabel }: Props) {
  const text = isPending ? pendingLabel : label;
  return (
    <span className={styles.wrapper}>
      <span key={text} className={styles.text}>
        {text}
      </span>
    </span>
  );
}
