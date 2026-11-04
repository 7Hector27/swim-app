import Link from "next/link";

import type { UpcomingLesson } from "@swim-app/shared";

import InlineError from "@/components/InlineError";

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
}

const RECENT_LIMIT = 3;

export default function LessonsSection({
  upcoming,
  past,
  upcomingForSwimmer,
  pastForSwimmer,
}: LessonsSectionProps) {
  const upcomingSkipFirst = upcomingForSwimmer.slice(1);
  const hasUpcomingLater = upcomingSkipFirst.length > 0;
  const hasPast = pastForSwimmer.length > 0;
  // Trim to the N newest so the profile stays a snapshot; "See all lessons"
  // sends the parent to the full history. The parent lessons page doesn't
  // currently filter by swimmer id, so the link points at the unfiltered
  // list.
  const recentForSwimmer = pastForSwimmer.slice(0, RECENT_LIMIT);

  const bothFailed = !upcoming.ok && !past.ok;
  if (bothFailed) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-text">Lessons</h2>
        <InlineError message="Couldn't load lessons." reloadOnRetry />
      </section>
    );
  }

  const nothingToShow =
    upcoming.ok && past.ok && !hasUpcomingLater && !hasPast && upcomingForSwimmer.length === 0;
  if (nothingToShow) {
    // The next-lesson dark card above already surfaces the "no upcoming
    // lessons" state (and the Book CTA when the viewer can book), so the
    // old duplicate placeholder is gone. The lessons section only renders
    // the header + a muted hint about past lessons.
    return (
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-text">Lessons</h2>
        </div>
        <p className="text-xs text-text-secondary">No lesson history yet.</p>
      </section>
    );
  }

  // When there are no upcoming-later lessons but there's past history, the
  // Upcoming column is dropped — the dark Book card has already said "no
  // upcoming". The column still shows if the upcoming fetch itself failed,
  // so the scoped "Couldn't load upcoming lessons" message surfaces.
  const showUpcomingColumn = hasUpcomingLater || !upcoming.ok;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-text">Lessons</h2>
        {(hasPast || hasUpcomingLater) && (
          <Link
            href="/dashboard/lessons"
            data-testid="see-all-lessons-link"
            className="text-xs font-semibold text-link hover:text-link-hover"
          >
            See all lessons →
          </Link>
        )}
      </div>
      {/*
        Mobile: columns stack. Tablet+: side-by-side grid with eyebrow
        headers that only appear at tablet+. When Upcoming is empty the
        column is dropped entirely and Recent takes the full row.
      */}
      <div
        className={`flex flex-col gap-2 tablet:grid tablet:gap-6 ${
          showUpcomingColumn ? "tablet:grid-cols-2" : "tablet:grid-cols-1"
        }`}
      >
        {showUpcomingColumn && (
          <LessonsColumn
            title="Upcoming"
            failed={!upcoming.ok}
            lessons={upcomingSkipFirst}
            dim={false}
            emptyText="Nothing else scheduled."
          />
        )}
        <LessonsColumn
          title="Recent"
          failed={!past.ok}
          lessons={recentForSwimmer}
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
        <InlineError message={`Couldn't load ${title.toLowerCase()} lessons.`} reloadOnRetry />
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
