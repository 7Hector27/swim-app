import Link from "next/link";

import type { UpcomingLesson } from "@swim-app/shared";
import LessonStatusBadge from "@/components/LessonStatusBadge";

interface Props {
  lessons: UpcomingLesson[];
  total: number;
}

export default function UpcomingLessonsCard({ lessons, total }: Props) {
  if (lessons.length === 0) {
    return (
      <div className="rounded-card border border-border p-5 tablet:p-6">
        <h2 className="text-xl text-heading mb-4">Upcoming lessons</h2>
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <p className="text-sm text-text-secondary">No upcoming lessons booked yet.</p>
          <a
            href="/dashboard/book"
            className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90"
          >
            Book a lesson
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-border p-5 tablet:p-6">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-xl text-heading">Upcoming lessons ({total})</h2>
        {total > lessons.length && (
          <Link
            href="/dashboard/lessons"
            className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
          >
            See all
          </Link>
        )}
      </div>
      <div className="divide-y divide-border">
        {lessons.map((lesson) => (
          <LessonRow key={lesson.id} lesson={lesson} />
        ))}
      </div>
    </div>
  );
}

function LessonRow({ lesson }: { lesson: UpcomingLesson }) {
  const startsAt = new Date(lesson.startsAt);
  const endsAt = new Date(startsAt.getTime() + lesson.durationMinutes * 60 * 1000);

  const dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
  })
    .format(startsAt)
    .toUpperCase();

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    day: "numeric",
  }).format(startsAt);

  const timeRange = formatTimeRange(startsAt, endsAt);
  const swimmerNames = lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ");

  return (
    <Link
      href={`/dashboard/lessons/${lesson.id}`}
      className="flex items-start gap-4 py-4 -mx-5 px-5 tablet:-mx-6 tablet:px-6 hover:bg-surface-soft transition-colors duration-150"
    >
      <div className="text-center w-10 flex-shrink-0 pt-0.5">
        <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wide">
          {dayLabel}
        </p>
        <p className="text-2xl font-heading text-heading leading-none mt-0.5">{dateLabel}</p>
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-text text-base leading-snug">{timeRange}</p>
        <p className="text-sm text-text-secondary mt-0.5">{lesson.locationName}</p>
        <p className="text-sm text-text-secondary">{swimmerNames}</p>
        <div className="mt-1.5">
          <LessonStatusBadge status={lesson.status} viewer="parent" />
        </div>
      </div>
    </Link>
  );
}

function formatTimeRange(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const startParts = fmt.formatToParts(start);
  const endParts = fmt.formatToParts(end);
  const startPeriod = startParts.find((p) => p.type === "dayPeriod")?.value;
  const endPeriod = endParts.find((p) => p.type === "dayPeriod")?.value;
  const endStr = fmt.format(end);
  if (startPeriod !== undefined && startPeriod === endPeriod) {
    const startShort = startParts
      .filter((p) => p.type !== "dayPeriod")
      .map((p) => p.value)
      .join("")
      .trimEnd();
    return `${startShort} \u2013 ${endStr}`;
  }
  return `${fmt.format(start)} \u2013 ${endStr}`;
}
