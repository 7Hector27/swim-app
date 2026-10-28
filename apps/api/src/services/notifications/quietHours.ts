// Pure quiet-hours helpers. See ADR 031.
//
// Quiet hours are specified by the coach as two LA-local times
// (quiet_hours_start_local, quiet_hours_end_local). When end < start, the
// window crosses midnight (e.g. 21:00–07:00). The sender resolves "is
// current LA time inside the window" at send time, and computes
// `release_at` as the next end-of-quiet-hours wall time in LA, resolved
// to a UTC instant.

const LA_TZ = "America/Los_Angeles";

interface LaWallTime {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  hour: number; // 0–23
  minute: number; // 0–59
}

function laWallTime(instant: Date): LaWallTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const hourRaw = get("hour");
  // Intl's "en-US" + hour12:false sometimes emits "24" for midnight. Normalize.
  const hour = hourRaw === 24 ? 0 : hourRaw;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
  };
}

// Minutes since midnight for a wall time string "HH:MM" or "HH:MM:SS".
export function parseWallTimeMinutes(input: string): number {
  const [hh, mm] = input.split(":");
  return Number(hh) * 60 + Number(mm);
}

// True when `instant`'s LA wall time falls inside the window
// [startLocal, endLocal). When endLocal <= startLocal, the window crosses
// midnight and covers [startLocal, 24:00) ∪ [00:00, endLocal).
export function isInsideQuietHours(
  instant: Date,
  startLocal: string,
  endLocal: string,
  enabled: boolean,
): boolean {
  if (!enabled) return false;
  const now = laWallTime(instant);
  const nowMinutes = now.hour * 60 + now.minute;
  const startMinutes = parseWallTimeMinutes(startLocal);
  const endMinutes = parseWallTimeMinutes(endLocal);
  if (startMinutes === endMinutes) return false; // zero-width window
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Wraparound.
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

// Returns the UTC Date corresponding to the LA wall time
// (year/month/day/hour/minute). DST-aware.
function laWallTimeToUtc(wall: LaWallTime): Date {
  // Treat the wall time as if UTC, then shift by LA's offset at that
  // instant.
  const asIfUtc = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0),
  );
  const offsetMinutes = laOffsetMinutes(asIfUtc);
  return new Date(asIfUtc.getTime() + offsetMinutes * 60 * 1000);
}

function laOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(tzName);
  if (!match) return 480;
  const sign = match[1] === "-" ? 1 : -1;
  const hh = Number(match[2] ?? 0);
  const mm = Number(match[3] ?? 0);
  return sign * (hh * 60 + mm);
}

// Resolves the next occurrence of the LA wall-time `endLocal` after
// `now`. Used to compute `release_at` when a row is held.
export function nextLaWallTimeAfter(now: Date, endLocal: string): Date {
  const endMinutes = parseWallTimeMinutes(endLocal);
  const endHour = Math.floor(endMinutes / 60);
  const endMinute = endMinutes % 60;
  const todayLa = laWallTime(now);
  const todayCandidate = laWallTimeToUtc({
    year: todayLa.year,
    month: todayLa.month,
    day: todayLa.day,
    hour: endHour,
    minute: endMinute,
  });
  if (todayCandidate.getTime() > now.getTime()) return todayCandidate;
  // Roll to the next LA calendar day. We cannot blindly +1 to .day because
  // of month lengths — use UTC date arithmetic and then re-resolve.
  const tomorrowBase = new Date(todayCandidate.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowLa = laWallTime(tomorrowBase);
  return laWallTimeToUtc({
    year: tomorrowLa.year,
    month: tomorrowLa.month,
    day: tomorrowLa.day,
    hour: endHour,
    minute: endMinute,
  });
}

// Returns the LA calendar date (YYYY-MM-DD) for a given UTC instant.
export function laDateString(instant: Date): string {
  const wall = laWallTime(instant);
  const month = String(wall.month).padStart(2, "0");
  const day = String(wall.day).padStart(2, "0");
  return `${wall.year}-${month}-${day}`;
}

// Returns `true` when the LA wall-time of `instant` is at or past the
// coach's `summaryTimeLocal` on the same LA calendar day.
export function laTimeIsAtOrPast(instant: Date, summaryTimeLocal: string): boolean {
  const now = laWallTime(instant);
  const nowMinutes = now.hour * 60 + now.minute;
  const targetMinutes = parseWallTimeMinutes(summaryTimeLocal);
  return nowMinutes >= targetMinutes;
}

// LA wall-time formatted as "H:MM AM/PM". Used in daily summary bodies
// ("first at 7:30 at Egret Park").
export function laTimeDisplay(instant: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

// LA wall-time (hour+minute only) → the "HH:MM" form used by the
// quiet-hours start comparator.
export function laTimeHhmm(instant: Date): string {
  const wall = laWallTime(instant);
  return `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
}
