// Grouped batch card summary for the coach pending list. See ADR 030.
//
// Why derive the pattern from the grouped lessons instead of the stored
// batch_mode-specific metadata: LessonResponse carries the mode flag but not
// the weekday/time pattern, so the component has no second source to fall
// back on. Dropping empty parts before joining keeps a long-tail batch (no
// listable pattern) from printing a dangling "," or "·".

import type { LessonResponse } from "@swim-app/shared";

// Cap on how many unique (weekday, time) entries we list inline. A weekly
// batch has 1 to a few entries; a multi-booking can have up to 20 random
// (weekday, time) picks. Past the cap we drop the pattern segment entirely
// rather than overflow the card.
const MAX_PATTERN_ENTRIES = 4;

export interface BuildBatchGroupSummaryInput {
  lessons: Pick<LessonResponse, "startsAt" | "durationMinutes">[];
  mode: "manual" | "weekly";
}

export function buildBatchGroupSummary(input: BuildBatchGroupSummaryInput): string {
  const { lessons, mode } = input;
  if (lessons.length === 0) return "";

  const sorted = [...lessons].sort((left, right) =>
    left.startsAt.localeCompare(right.startsAt),
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  const laWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
  });
  const laTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  });
  const laDateShort = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
  });

  // Collect unique (weekday, time) entries in encounter order. A Set keeps
  // de-dup cheap; the first-seen order gives Tue-then-Thu rather than
  // alphabetical.
  const patternSet = new Set<string>();
  const durations = new Set<number>();
  for (const lesson of sorted) {
    const start = new Date(lesson.startsAt);
    patternSet.add(`${laWeekday.format(start)} ${laTime.format(start)}`);
    durations.add(lesson.durationMinutes);
  }
  const patternLabel =
    patternSet.size <= MAX_PATTERN_ENTRIES ? [...patternSet].join(", ") : "";

  const durationLabel =
    durations.size === 1 ? `${[...durations][0]} min` : "mixed lengths";

  const firstDate = laDateShort.format(new Date(first.startsAt));
  const lastDate = laDateShort.format(new Date(last.startsAt));
  const dateRange = firstDate === lastDate ? firstDate : `${firstDate} to ${lastDate}`;

  const countLabel = `${sorted.length} ${mode === "weekly" ? "weekly " : ""}lesson${
    sorted.length === 1 ? "" : "s"
  }`;

  // The pattern and duration form one logical segment separated by a middle
  // dot. Empty parts drop out so an unknown pattern collapses to just the
  // duration (and vice versa) without a leading or trailing separator.
  const patternAndDuration = [patternLabel, durationLabel]
    .filter((part) => part.length > 0)
    .join(" \u00B7 ");

  return [countLabel, patternAndDuration, dateRange]
    .filter((part) => part.length > 0)
    .join(", ");
}
