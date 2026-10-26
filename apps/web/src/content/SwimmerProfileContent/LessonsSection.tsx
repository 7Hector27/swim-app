import Link from "next/link";

import type { UpcomingLesson } from "@swim-app/shared";

import type { SectionResult } from "./SwimmerProfileContent";
import {
  formatLessonDate,
  formatLessonDay,
  formatLessonMonth,
  formatLessonTime,
} from "./helpers";

interface LessonsSectionProps {
  upcoming: SectionResult<UpcomingLesson[]>;
  past: SectionResult<UpcomingLesson[]>;
  upcomingForSwimmer: UpcomingLesson[];
  pastForSwimmer: UpcomingLesson[];
  canBook: boolean;
}

export default function LessonsSection({
  upcoming,
  past,
  upcomingForSwimmer,
  pastForSwimmer,
  canBook,
}: LessonsSectionProps) {
  const upcomingSkipFirst = upcomingForSwimmer.slice(1);
  const hasUpcomingLater = upcomingSkipFirst.length > 0;
  const hasPast = pastForSwimmer.length > 0;

  const bothFailed = !upcoming.ok && !past.ok;
  if (bothFailed) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-text">Lessons</h2>
        <p className="text-xs text-text-secondary">
          Couldn't load lessons. Please refresh.
        </p>
      </section>
    );
  }

  const nothingToShow =
    upcoming.ok && past.ok && !hasUpcomingLater && !hasPast && upcomingForSwimmer.length === 0;
  if (nothingToShow) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-text">Lessons</h2>
        {canBook ? (
          <div className="rounded-card border border-border px-4 py-4 flex flex-col items-start gap-3">
            <p className="text-xs text-text-secondary">
              No lessons scheduled yet.
            </p>
            <Link
              href="/dashboard/book"
              className="rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm h-11 flex items-center justify-center px-5 transition-transform duration-150 active:scale-[0.97]"
            >
              Book a lesson
            </Link>
          </div>
        ) : (
          <p className="text-xs text-text-secondary">No lessons scheduled yet.</p>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-bold text-text">Lessons</h2>
      {/*
        Mobile: both columns stack into one gap-2 flex column, forming a single
        continuous list (past rows dimmed). Tablet+: side-by-side grid with
        eyebrow headers that only appear at tablet+.
      */}
      <div className="flex flex-col gap-2 tablet:grid tablet:grid-cols-2 tablet:gap-6">
        <LessonsColumn
          title="Upcoming"
          failed={!upcoming.ok}
          lessons={upcomingSkipFirst}
          dim={false}
          emptyText="Nothing else scheduled."
        />
        <LessonsColumn
          title="Recent"
          failed={!past.ok}
          lessons={pastForSwimmer}
          dim
          emptyText="No recent lessons."
        />
      </div>
    </section>
  );
}

interface LessonsColumnProps {
  title: string;
  failed: boolean;
  lessons: UpcomingLesson[];
  dim: boolean;
  emptyText: string;
}

function LessonsColumn({ title, failed, lessons, dim, emptyText }: LessonsColumnProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="hidden tablet:block text-eyebrow font-semibold text-text-secondary uppercase tracking-wide">
        {title}
      </h3>
      {failed ? (
        <div className="rounded-card border border-border px-4 py-3">
          <p className="text-xs text-text-secondary">
            Couldn't load {title.toLowerCase()} lessons.
          </p>
        </div>
      ) : lessons.length === 0 ? (
        /*
          Mobile: hide empty-column placeholders. The other column's rows plus
          the top-level "Lessons" heading already convey "that's all there is."
          Tablet+: show the placeholder so the two-column grid stays balanced.
        */
        <div className="hidden tablet:block rounded-card border border-border px-4 py-3">
          <p className="text-xs text-text-secondary">{emptyText}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {lessons.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} dim={dim} />
          ))}
        </ul>
      )}
    </div>
  );
}

interface LessonRowProps {
  lesson: UpcomingLesson;
  dim: boolean;
}

function LessonRow({ lesson, dim }: LessonRowProps) {
  const statusLabel =
    lesson.status === "pending"
      ? "Pending approval"
      : lesson.status === "approved"
        ? "Approved"
        : "Completed";
  const monthLabel = dim ? formatLessonMonth(lesson.startsAt) : formatLessonDay(lesson.startsAt);
  return (
    <li
      className={`
        flex items-center gap-3 rounded-card border border-border px-4 py-3
        transition-[opacity,background-color] duration-150
        hover:bg-surface-soft
        ${dim ? "opacity-70 hover:opacity-100" : ""}
      `}
    >
      <Link
        href={`/dashboard/lessons/${lesson.id}`}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <div className="text-center w-10 flex-shrink-0">
          <p className="text-[10px] font-bold text-text-secondary tracking-wide">
            {monthLabel}
          </p>
          <p className="font-heading text-xl text-heading leading-none mt-0.5">
            {formatLessonDate(lesson.startsAt)}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-text">
            {formatLessonTime(lesson.startsAt, lesson.durationMinutes)}
          </p>
          <p className="text-xs text-text-secondary">{statusLabel}</p>
        </div>
      </Link>
    </li>
  );
}
