import type {
  Club,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
  UpcomingLesson,
} from "@swim-app/shared";

const LA = "America/Los_Angeles";

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

export function nextLessonForSwimmer(
  lessons: UpcomingLesson[],
  swimmerId: string,
): UpcomingLesson | null {
  const forThisSwimmer = lessons
    .filter((lesson) => lesson.swimmers.some((swimmer) => swimmer.swimmerId === swimmerId))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return forThisSwimmer[0] ?? null;
}

export function formatNextLessonLine(lesson: UpcomingLesson): string {
  const date = new Date(lesson.startsAt);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: LA, weekday: "short" }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: LA,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${day} at ${time}`;
}

export function latestEvaluationDate(
  progress: ParentSwimmerProgressResponse | null,
): string | null {
  if (!progress) return null;
  const candidates: string[] = [];
  for (const note of progress.latestCoachingNotes) candidates.push(note.sessionDate);
  if (progress.latestCoachingPriority) candidates.push(progress.latestCoachingPriority.sessionDate);
  for (const skill of progress.skills) {
    for (const point of skill.history) candidates.push(point.sessionDate);
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((max, current) => (current > max ? current : max));
}

// `now` is passed in by the server so this stays deterministic across
// server render and any later rerun. Caller is responsible for providing
// a stable "now" (typically `new Date()` at the start of the request).
export function formatRelativeDay(sessionDate: string, now: Date): string {
  const [year, month, day] = sessionDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return sessionDate;
  const sessionUtc = Date.UTC(year, month - 1, day);
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffDays = Math.round((nowUtc - sessionUtc) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
  if (diffDays >= 7 && diffDays < 14) return "last week";
  if (diffDays >= 14 && diffDays < 60) return `${Math.round(diffDays / 7)} weeks ago`;
  const sessionDateObj = new Date(sessionUtc);
  const sameYear = sessionDateObj.getUTCFullYear() === now.getUTCFullYear();
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(sessionDateObj);
}
