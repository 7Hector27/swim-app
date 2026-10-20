// DST-safe: all arithmetic operates on UTC integer day offsets, never on hours or timezone-aware timestamps.

export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function mondayOf(dateStr: string): string {
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay(); // 0=Sun, 1=Mon
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// "Today", "Tomorrow", or "Monday, October 19"
export function dayViewLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return "Today";
  if (dateStr === addDays(todayStr, 1)) return "Tomorrow";
  const [year, month, day] = dateStr.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

// "Mon 19" for column headers
export function shortDayLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

// "Oct 19 to 25" or "Oct 26 to Nov 1"
export function weekRangeLabel(monday: string): string {
  const sunday = addDays(monday, 6);
  const [my, mm, md] = monday.split("-").map(Number) as [number, number, number];
  const [sy, sm, sd] = sunday.split("-").map(Number) as [number, number, number];
  const monFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const sunFmt = mm === sm
    ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", day: "numeric" })
    : new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  return `${monFmt.format(new Date(Date.UTC(my, mm - 1, md)))} to ${sunFmt.format(new Date(Date.UTC(sy, sm - 1, sd)))}`;
}
