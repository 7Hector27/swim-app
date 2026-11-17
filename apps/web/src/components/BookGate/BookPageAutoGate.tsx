"use client";

// Opens the no-swimmers modal automatically when /dashboard/book is
// loaded directly with no swimmers on the account. The nav + dashboard
// Book links already route through BookLink and surface this modal
// before navigating; this mount-time hook is the belt-and-suspenders
// guard for the typed-URL / bookmarked-route case.
//
// Viewers never trigger — the gate's evaluate() returns null for them.
// If the balance is low but there IS a swimmer, we don't auto-open the
// low-funds modal here — the booking page shows its own low-funds
// banner inline, and we want the parent to be able to browse times
// without an interruption they can't see coming.

import { useEffect } from "react";

import { useBookGate } from "./BookGate";

export default function BookPageAutoGate() {
  const { swimmerCount, isViewer, openGate } = useBookGate();

  useEffect(() => {
    if (isViewer) return;
    if (swimmerCount === 0) openGate("no_swimmers");
  }, [isViewer, swimmerCount, openGate]);

  return null;
}
