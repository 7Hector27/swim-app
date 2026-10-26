import type { Club, ParentSwimmer, UpcomingLesson } from "@swim-app/shared";

const LA = "America/Los_Angeles";

export function parentSwimmerAge(birthDate: string): number {
  const [year, month, day] = birthDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return 0;
  const now = new Date();
  let age = now.getFullYear() - year;
  const beforeBirthday =
    now.getMonth() + 1 < month ||
    (now.getMonth() + 1 === month && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

export function swimmerClubName(swimmer: ParentSwimmer, clubs: Club[]): string | null {
  const first = swimmer.clubs[0];
  if (!first) return null;
  if (first.otherClubName !== null) return first.otherClubName;
  if (first.clubId !== null) {
    const match = clubs.find((club) => club.id === first.clubId);
    return match ? match.name : null;
  }
  return null;
}

export function formatLessonDay(startsAt: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: LA, weekday: "short" })
    .format(new Date(startsAt))
    .toUpperCase();
}

export function formatLessonDate(startsAt: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: LA, day: "numeric" }).format(
    new Date(startsAt),
  );
}

export function formatLessonMonth(startsAt: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: LA, month: "short" })
    .format(new Date(startsAt))
    .toUpperCase();
}

export function formatLessonTime(startsAt: string, durationMinutes: number): string {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const fmt = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: LA,
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  return `${fmt(start)} to ${fmt(end)}`;
}

export function formatRelativeDay(sessionDate: string): string {
  const [y, m, d] = sessionDate.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return sessionDate;
  const date = new Date(Date.UTC(y, m - 1, d));
  const now = new Date();
  const nowUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((nowUtc - date.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  if (diff >= 7 && diff < 14) return "Last week";
  const sameYear = date.getUTCFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

export function filterLessonsForSwimmer(
  lessons: UpcomingLesson[],
  swimmerId: string,
): UpcomingLesson[] {
  return lessons.filter((lesson) =>
    lesson.swimmers.some((swimmer) => swimmer.swimmerId === swimmerId),
  );
}

const STROKE_LABEL: Record<string, string> = {
  free: "Free",
  back: "Back",
  breast: "Breast",
  fly: "Fly",
  im: "IM",
};

export function formatEventName(distance: number, stroke: string): string {
  const label = STROKE_LABEL[stroke] ?? stroke;
  return `${distance} ${label}`;
}

const COURSE_LABEL: Record<string, string> = {
  scy: "SCY",
  scm: "SCM",
  lcm: "LCM",
};

export function formatCourseLabel(course: string): string {
  return COURSE_LABEL[course] ?? course.toUpperCase();
}
