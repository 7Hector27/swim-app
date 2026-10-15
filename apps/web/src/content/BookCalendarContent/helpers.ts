import { isApiBody } from "@/lib/mapZodErrors";
import type { WeekDayAvailability } from "@swim-app/shared";

export type BookingState =
  | { status: "idle" }
  | { status: "error"; message: string }
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
  too_soon: "That slot is less than 16 hours away — to book, please text Jason.",
  too_far: "You can only book lessons up to 10 weeks in advance.",
  slot_unavailable: "That slot was just taken. Please pick another time.",
};

export function mapBookingApiResponse(
  status: number,
  body: unknown,
): { status: "error"; message: string } {
  if (status === 403) {
    return {
      status: "error",
      message:
        "You don't have permission to book lessons. Ask the household owner for booking access.",
    };
  }

  if (status === 422 && isApiBody(body) && typeof body.error === "string") {
    const friendly = ERROR_CODE_MESSAGES[body.error];
    if (friendly) {
      return { status: "error", message: friendly };
    }
  }

  return { status: "error", message: "Something went wrong. Please try again." };
}
