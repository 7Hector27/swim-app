// Date and address formatting helpers for the parent booking email payload.
// Keeps timezone logic out of the outbox write path so route handlers can
// stay single-purpose. See ADR 028.

export const LESSON_TIME_ZONE = "America/Los_Angeles";

// "Sat, Nov 1, 2026 at 10:30 AM" — matches the subject line format in
// docs/plans/parent-booking-emails.md. Uses the lesson's actual LA calendar
// time, independent of the server's TZ.
export function formatLessonTimeDisplay(date: Date): string {
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: LESSON_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: LESSON_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${datePart} at ${timePart}`;
}

export function buildDeepLink(siteUrl: string, lessonId: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}/dashboard/lessons/${lessonId}`;
}

// ADR 036 Phase 7 — balance-triggered emails CTA points at the family's
// balance page, where they can see the ledger entry the email describes.
export function buildBalancePageLink(siteUrl: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}/account/balance`;
}
