// Build the coach-schedule link used by the account_deleted notification
// (bell + push) and the account_deleted email. Never links to a lesson,
// batch, or household — those are either gone or anonymized when this
// URL fires. See ADR 034.

const LA_TZ = "America/Los_Angeles";

// Returns `${siteUrl}/coach/schedule?view=day&date=YYYY-MM-DD` keyed on
// the first freed lesson's LA calendar date, or `${siteUrl}/coach/schedule`
// (which defaults to today in LA, day view) when `firstFreedLessonUtc` is
// null. YYYY-MM-DD is computed in LA to match the server page's handling
// of its `date` query param (todayLA + mondayOf both run in LA).
export function buildAccountDeletedScheduleUrl(
  siteUrl: string,
  firstFreedLessonUtc: Date | null,
): string {
  const base = siteUrl.replace(/\/+$/, "");
  if (firstFreedLessonUtc === null) {
    return `${base}/coach/schedule`;
  }
  return `${base}/coach/schedule?view=day&date=${toLaDateString(firstFreedLessonUtc)}`;
}

export function toLaDateString(utc: Date): string {
  // en-CA formats as YYYY-MM-DD out of the box.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(utc);
}
