import { bookingWindowEnd } from "@swim-app/shared";
import type { WeekDayAvailability } from "@swim-app/shared";
import { isApiBody } from "@/lib/mapZodErrors";

export type BookingState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "insufficient_balance";
      // Full 422 shape from the API — used by the modal to show the
      // shortfall and to pre-fill the top-up flow with the same lesson
      // inputs the parent just attempted.
      balanceCents: number;
      priceCents: number;
      shortfallCents: number;
      // The inputs the parent tried to book, so the modal's "add credit
      // for this lesson" CTA tops up at the exact price the booking
      // needs, and the resumed /book?resume=1 page re-prefills them.
      attempt: {
        startsAt: string;
        durationMinutes: 30 | 45 | 60;
        locationId: string;
        swimmerIds: string[];
      };
    }
  | { status: "success"; lessonId: string; autoApproved: boolean };

export function getMondayOfWeek(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00`);
  const dow = date.getDay();
  // Convert Sunday(0)..Saturday(6) to Mon=0..Sun=6
  const offsetFromMonday = (dow + 6) % 7;
  return addDaysToDateStr(dateStr, -offsetFromMonday);
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatWeekLabel(mondayStr: string): string {
  const sundayStr = addDaysToDateStr(mondayStr, 6);
  const monday = new Date(`${mondayStr}T12:00:00`);
  const sunday = new Date(`${sundayStr}T12:00:00`);

  const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short" });
  const month = monthFmt.format(monday);
  const startDay = monday.getDate();
  const endDay = sunday.getDate();
  const year = sunday.getFullYear();

  return `${month} ${startDay} \u2013 ${endDay}, ${year}`;
}

export function formatSlotTime(isoStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoStr));
}

export function formatSlotRange(isoStr: string, durationMinutes: number): string {
  const start = new Date(isoStr);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  const fmt = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);

  const startStr = fmt(start);
  const endStr = fmt(end);

  // Strip trailing AM/PM from start if same meridiem as end
  const startMeridiem = startStr.slice(-2);
  const endMeridiem = endStr.slice(-2);
  if (startMeridiem === endMeridiem) {
    return `${startStr.slice(0, -3)} \u2013 ${endStr}`;
  }
  return `${startStr} \u2013 ${endStr}`;
}

export function formatDayLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function buildGridRows(days: WeekDayAvailability[]): string[] {
  const rowSet = new Set<string>();

  for (const day of days) {
    for (const window of day.teachingWindows) {
      const [startHour, startMin] = window.start.split(":").map(Number);
      const [endHour, endMin] = window.end.split(":").map(Number);

      if (
        startHour === undefined ||
        startMin === undefined ||
        endHour === undefined ||
        endMin === undefined
      ) {
        continue;
      }

      let totalMinutes = startHour * 60 + startMin;
      const endTotalMinutes = endHour * 60 + endMin;

      while (totalMinutes < endTotalMinutes) {
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        rowSet.add(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
        totalMinutes += 15;
      }
    }
  }

  return Array.from(rowSet).sort();
}

export function getSlotHHMM(isoStr: string): string {
  const date = new Date(isoStr);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/^24:/, "00:");
}

export function isInSelectionSpan(
  rowHHMM: string,
  selectedStartHHMM: string,
  durationMinutes: number,
): boolean {
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  const rowMin = toMinutes(rowHHMM);
  const startMin = toMinutes(selectedStartHHMM);
  const endMin = startMin + durationMinutes;

  return rowMin >= startMin && rowMin < endMin;
}

export function isSlotInSelection(
  slotStartsAt: string,
  selectedStartsAt: string,
  durationMinutes: number,
): boolean {
  const slotMs = new Date(slotStartsAt).getTime();
  const startMs = new Date(selectedStartsAt).getTime();
  return slotMs >= startMs && slotMs < startMs + durationMinutes * 60 * 1000;
}

// Canonical one-line display for a lesson. Example output:
// "Tue, Oct 27 · 4:00 to 4:30 PM · 30 min". Shared by Single's bottom bar,
// the batch review sheet, the batch success screen, the Multiple pick list,
// the Recurring pattern list, and the Reschedule flows so one lesson reads
// the same everywhere.
export function formatSlotRangeWithDate(isoStr: string, durationMinutes: number): string {
  const start = new Date(isoStr);
  const laOptions = { timeZone: "America/Los_Angeles" } as const;

  const dayLabel = new Intl.DateTimeFormat("en-US", {
    ...laOptions,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);

  return `${dayLabel} \u00b7 ${formatRangeAndLength(start, durationMinutes)}`;
}

// Weekday-only canonical display for a recurring pattern entry (no specific
// date). Mirrors formatSlotRangeWithDate so a pattern pair reads the same
// as a per-date lesson, modulo the leading date vs. weekday.
export function formatPatternRangeAndLength(input: {
  weekday: number;
  timeOfDay: string;
  durationMinutes: number;
}): string {
  const [hourStr = "0", minuteStr = "0"] = input.timeOfDay.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  // Use a reference Monday (2023-01-02) so the Intl formatter resolves AM/PM
  // deterministically without pulling in the current date.
  const start = new Date(Date.UTC(2023, 0, 2 + ((input.weekday - 1) % 7), hour, minute));
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(start);
  return `${weekday} \u00b7 ${formatRangeAndLength(start, input.durationMinutes, { useUtc: true })}`;
}

function formatRangeAndLength(
  start: Date,
  durationMinutes: number,
  options: { useUtc?: boolean } = {},
): string {
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const fmt = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: options.useUtc === true ? "UTC" : "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  const startStr = fmt(start);
  const endStr = fmt(end);
  const startMeridiem = startStr.slice(-2);
  const endMeridiem = endStr.slice(-2);
  const rangeStr =
    startMeridiem === endMeridiem
      ? `${startStr.slice(0, -3)} to ${endStr}`
      : `${startStr} to ${endStr}`;
  return `${rangeStr} \u00b7 ${durationMinutes} min`;
}

export function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = h ?? 0;
  const min = m ?? 0;
  const meridiem = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const displayMin = String(min).padStart(2, "0");
  return `${displayHour}:${displayMin} ${meridiem}`;
}

export function isHourMark(hhmm: string): boolean {
  return hhmm.endsWith(":00");
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  not_a_lesson_day: "That day isn't available for lessons.",
  too_far: "You can only book lessons up to 10 weeks in advance.",
  slot_unavailable: "That time isn't available anymore. Pick another one.",
};

interface InsufficientBalanceBody {
  error: "insufficient_balance";
  balanceCents: number;
  priceCents: number;
  shortfallCents: number;
}

function isInsufficientBalanceBody(
  body: unknown,
): body is InsufficientBalanceBody {
  if (typeof body !== "object" || body === null) return false;
  const record = body as Record<string, unknown>;
  return (
    record.error === "insufficient_balance" &&
    typeof record.balanceCents === "number" &&
    typeof record.priceCents === "number" &&
    typeof record.shortfallCents === "number"
  );
}

export function tooSoonMessage(hours: number | null): string {
  if (hours === null) {
    // Server didn't echo a window on this response. Don't invent one —
    // give the parent the actionable half of the message with no number.
    return "That slot is too close to the lesson — to book, please text Jason.";
  }
  const unit = hours === 1 ? "hour" : "hours";
  return `That slot is less than ${hours} ${unit} away — to book, please text Jason.`;
}

// Last LA calendar date inside the rolling booking window. Delegates to the
// shared helper so client and server see the exact same window boundary.
export function maxBookableDateLA(bookingMaxAdvanceWeeks: number, nowMs: number): string {
  return bookingWindowEnd(new Date(nowMs), bookingMaxAdvanceWeeks);
}

export function firstAvailableDayInWeek(
  days: WeekDayAvailability[],
  fromDate: string,
): string | null {
  for (const day of days) {
    if (day.date < fromDate) continue;
    if (day.dayState !== "open") continue;
    if (day.openCount > 0) return day.date;
  }
  return null;
}

export function mapBookingApiResponse(
  status: number,
  body: unknown,
  attempt?: {
    startsAt: string;
    durationMinutes: 30 | 45 | 60;
    locationId: string;
    swimmerIds: string[];
  },
): Exclude<BookingState, { status: "idle" } | { status: "success"; lessonId: string; autoApproved: boolean }> {
  if (status === 403) {
    return {
      status: "error",
      message:
        "You don't have permission to book lessons. Ask the household owner for booking access.",
    };
  }

  if (status === 422 && isInsufficientBalanceBody(body) && attempt) {
    return {
      status: "insufficient_balance",
      balanceCents: body.balanceCents,
      priceCents: body.priceCents,
      shortfallCents: body.shortfallCents,
      attempt,
    };
  }

  if (status === 422 && isApiBody(body) && typeof body.error === "string") {
    if (body.error === "too_soon") {
      const bodyRecord = body as Record<string, unknown>;
      const raw = bodyRecord.bookingMinAdvanceHours;
      const hours = typeof raw === "number" ? raw : null;
      return { status: "error", message: tooSoonMessage(hours) };
    }
    const friendly = ERROR_CODE_MESSAGES[body.error];
    if (friendly) {
      return { status: "error", message: friendly };
    }
  }

  return { status: "error", message: "Something went wrong. Please try again." };
}
