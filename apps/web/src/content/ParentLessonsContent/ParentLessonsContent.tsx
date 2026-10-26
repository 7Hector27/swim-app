"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import type { UpcomingLesson } from "@swim-app/shared";
import LessonStatusBadge from "@/components/LessonStatusBadge";
import BatchModeBadge from "@/components/BatchModeBadge";

import { loadMoreUpcomingLessons } from "./actions";
import { groupLessonsByWeek, todayMondayLA } from "./weekGroups";
import { PAGE_SIZE } from "./constants";

interface Props {
  initialLessons: UpcomingLesson[];
  initialHasMore: boolean;
  past: UpcomingLesson[];
}

export default function ParentLessonsContent({ initialLessons, initialHasMore, past }: Props) {
  const [lessons, setLessons] = useState(initialLessons);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [offset, setOffset] = useState(PAGE_SIZE);
  const [loadError, setLoadError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [todayMonday] = useState(() => todayMondayLA());

  function handleShowMore() {
    setLoadError(false);
    startTransition(async () => {
      const result = await loadMoreUpcomingLessons(offset);
      if (result === null) {
        setLoadError(true);
        return;
      }
      const gotMore = result.length > PAGE_SIZE;
      const newLessons = gotMore ? result.slice(0, PAGE_SIZE) : result;
      setLessons((prev) => [...prev, ...newLessons]);
      setHasMore(gotMore);
      setOffset((prev) => prev + PAGE_SIZE);
    });
  }

  const groups = groupLessonsByWeek(lessons, todayMonday);

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          <h1 className="text-3xl tablet:text-4xl text-heading mb-8">Lessons</h1>

          <section className="mb-10">
            <h2 className="text-xl text-heading mb-6">Upcoming</h2>
            {groups.length === 0 ? (
              <p className="text-sm text-text-secondary">No upcoming lessons booked.</p>
            ) : (
              <div className="flex flex-col gap-8">
                {groups.map((group) => (
                  <div key={group.monday}>
                    <h3 className="text-sm font-semibold text-text-secondary mb-3">{group.label}</h3>
                    <ul className="flex flex-col gap-3">
                      {group.lessons.map((lesson) => (
                        <LessonRow key={lesson.id} lesson={lesson} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {loadError ? (
              <p className="mt-6 text-sm text-danger">
                Failed to load more lessons.{" "}
                <button
                  type="button"
                  onClick={handleShowMore}
                  className="font-semibold underline hover:opacity-80"
                >
                  Try again
                </button>
              </p>
            ) : hasMore && (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={handleShowMore}
                  disabled={isPending}
                  className="inline-flex items-center justify-center rounded-button border-2 border-button-outline text-button-outline font-bold text-sm px-5 h-11 transition-colors duration-150 hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPending ? "Loading…" : "Show more"}
                </button>
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xl text-heading mb-4">Past</h2>
            {past.length === 0 ? (
              <p className="text-sm text-text-secondary">No past lessons yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {past.map((lesson) => (
                  <LessonRow key={lesson.id} lesson={lesson} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function LessonRow({ lesson }: { lesson: UpcomingLesson }) {
  const startsAt = new Date(lesson.startsAt);
  const swimmerNames = lesson.swimmers.map((swimmer) => swimmer.firstName).join(", ");

  return (
    <li>
      <Link
        href={`/dashboard/lessons/${lesson.id}`}
        className="flex items-center justify-between rounded-card border border-border px-5 py-4 hover:border-accent transition-colors duration-150"
      >
        <div className="min-w-0">
          <p className="font-semibold text-text">{formatDateLabel(startsAt)}</p>
          <p className="text-sm text-text-secondary mt-0.5 truncate">
            {formatTime(startsAt)} · {lesson.durationMinutes} min
            {swimmerNames ? ` · ${swimmerNames}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          <BatchModeBadge mode={lesson.batchMode} />
          <LessonStatusBadge status={lesson.status} viewer="parent" />
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </Link>
    </li>
  );
}

function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
