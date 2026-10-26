import Link from "next/link";

import type { UpcomingLesson } from "@swim-app/shared";

import {
  formatLessonDate,
  formatLessonDay,
  formatLessonMonth,
  formatLessonTime,
  formatRelativeDay,
} from "./helpers";

interface NextLessonSectionProps {
  lesson: UpcomingLesson | null;
  upcomingFailed: boolean;
  canBook: boolean;
}

export default function NextLessonSection({
  lesson,
  upcomingFailed,
  canBook,
}: NextLessonSectionProps) {
  if (upcomingFailed) {
    return (
      <section
        aria-label="Next lesson"
        className="rounded-card bg-section text-text-on-section px-5 py-4"
      >
        <p className="text-sm text-text-secondary-on-section">
          Couldn't load the next lesson. Please refresh.
        </p>
      </section>
    );
  }

  if (!lesson) {
    return (
      <section
        aria-label="Next lesson"
        className="rounded-card bg-section text-text-on-section px-5 py-6 flex flex-col gap-3"
      >
        <p className="text-sm text-text-secondary-on-section">
          No upcoming lessons booked yet.
        </p>
        {canBook && (
          <Link
            href="/dashboard/book"
            className="rounded-button bg-accent-on-section text-on-accent font-bold text-sm h-11 flex items-center justify-center self-start px-5 transition-transform duration-150 active:scale-[0.97]"
          >
            Book a lesson
          </Link>
        )}
      </section>
    );
  }

  return (
    <section
      aria-label="Next lesson"
      className="rounded-card bg-section text-text-on-section px-5 py-5 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-eyebrow font-bold text-accent-on-section uppercase tracking-wide">
          Next lesson
        </span>
        <span className="text-xs text-text-secondary-on-section">
          {formatRelativeDay(lesson.startsAt.slice(0, 10))}
        </span>
      </div>
      <div>
        <p className="text-xs text-text-secondary-on-section">
          {formatLessonDay(lesson.startsAt)} {formatLessonMonth(lesson.startsAt)}{" "}
          {formatLessonDate(lesson.startsAt)}
        </p>
        <p className="font-heading text-3xl mt-1 tabular-nums">
          {formatLessonTime(lesson.startsAt, lesson.durationMinutes)}
        </p>
        <p className="text-sm text-text-secondary-on-section mt-1">{lesson.locationName}</p>
        <p className="text-xs text-text-secondary-on-section mt-0.5">
          {lesson.durationMinutes} min · {lesson.type}
          {lesson.status === "pending" ? " · pending approval" : ""}
        </p>
      </div>
    </section>
  );
}
