import type { UpcomingLesson } from "@swim-app/shared";

import { addDays, mondayOf } from "@/lib/calendarDate";

export interface WeekGroup {
  monday: string;
  label: string;
  lessons: UpcomingLesson[];
}

export function lessonDateLA(startsAt: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(startsAt));
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

export function todayMondayLA(): string {
  return mondayOf(lessonDateLA(new Date().toISOString()));
}

export function weekGroupLabel(monday: string, todayMonday: string): string {
  if (monday === todayMonday) return "This week";
  if (monday === addDays(todayMonday, 7)) return "Next week";
  const [year, month, day] = monday.split("-").map(Number) as [number, number, number];
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return `Week of ${dateLabel}`;
}

export function groupLessonsByWeek(lessons: UpcomingLesson[], todayMonday: string): WeekGroup[] {
  const groupMap = new Map<string, WeekGroup>();
  for (const lesson of lessons) {
    const monday = mondayOf(lessonDateLA(lesson.startsAt));
    if (!groupMap.has(monday)) {
      groupMap.set(monday, { monday, label: weekGroupLabel(monday, todayMonday), lessons: [] });
    }
    groupMap.get(monday)!.lessons.push(lesson);
  }
  return Array.from(groupMap.values());
}
