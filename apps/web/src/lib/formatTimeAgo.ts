// Short "time ago" label used by the coach notification bell dropdown
// and the full /coach/notifications page. Pure — no imports, no React,
// no DOM — so both the client components can share it without one
// pulling in the other's module graph. See CLAUDE.md's rule on
// business logic living outside components.
//
// "just now" under a minute, Nm / Nh / Nd up to a week, then an LA
// Mon-DD date. Clamps negative diffs to 0 so a mild clock skew on the
// server doesn't surface as "-3m ago."

export function formatTimeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}
