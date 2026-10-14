import Link from "next/link";

import type { UpcomingLesson } from "@swim-app/shared";

interface Props {
  lessons: UpcomingLesson[];
}

export default function UpcomingLessonsCard({ lessons }: Props) {
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
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl text-heading">Upcoming lessons</h2>
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
  }).format(startsAt).toUpperCase();

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    day: "numeric",
  }).format(startsAt);

  const timeRange = `${formatTime(startsAt)} to ${formatTime(endsAt)}`;
  const swimmerNames = lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ");
  const lessonType = lesson.type === "private" ? "private lesson" : "family lesson";
  const title = `${swimmerNames}, ${lessonType}`;
  const timeDetail = `${timeRange} at ${lesson.locationName}`;

  return (
    <div className="flex items-center gap-4 py-4">
      <div className="text-center w-9 flex-shrink-0">
        <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wide">
          {dayLabel}
        </p>
        <p className="text-xl font-heading text-heading leading-tight">{dateLabel}</p>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text">{title}</p>
        <p className="text-xs text-text-secondary mt-0.5">{timeDetail}</p>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {lesson.status === "approved" ? (
          <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-success/10 text-success">
            Confirmed
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-surface-soft text-text-secondary border border-border">
            Pending
          </span>
        )}
        <Link
          href={`/dashboard/lessons/${lesson.id}`}
          className="text-xs font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          Change
        </Link>
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
