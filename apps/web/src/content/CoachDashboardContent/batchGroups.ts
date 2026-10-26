// Grouping logic for the coach pending list. See ADR 030.
//
// Why collapse single-lesson batches back into "solo": a batch whose other
// pending lessons were already handled individually looks identical to a
// non-batch request. Rendering it as a batch group would show "Approve all"
// over a single row, which reads as noise.

import type { LessonResponse } from "@swim-app/shared";

export type PendingGroup =
  | { kind: "solo"; lesson: LessonResponse }
  | { kind: "batch"; batchId: string; batchMode: "manual" | "weekly"; lessons: LessonResponse[] };

export function buildGroups(lessons: LessonResponse[]): PendingGroup[] {
  const soloList: LessonResponse[] = [];
  const batchMap = new Map<string, { mode: "manual" | "weekly"; lessons: LessonResponse[] }>();
  for (const lesson of lessons) {
    const batchId = lesson.batchId;
    const mode = lesson.batchMode;
    if (!batchId || !mode) {
      soloList.push(lesson);
      continue;
    }
    const existing = batchMap.get(batchId);
    if (existing) {
      existing.lessons.push(lesson);
    } else {
      batchMap.set(batchId, { mode, lessons: [lesson] });
    }
  }
  const groups: PendingGroup[] = [];
  for (const lesson of soloList) {
    groups.push({ kind: "solo", lesson });
  }
  for (const [batchId, entry] of batchMap) {
    if (entry.lessons.length === 1) {
      groups.push({ kind: "solo", lesson: entry.lessons[0]! });
    } else {
      groups.push({
        kind: "batch",
        batchId,
        batchMode: entry.mode,
        lessons: entry.lessons,
      });
    }
  }
  groups.sort((left, right) => firstStartsAt(left).localeCompare(firstStartsAt(right)));
  return groups;
}

export function firstStartsAt(group: PendingGroup): string {
  if (group.kind === "solo") return group.lesson.startsAt;
  return [...group.lessons].sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0]!.startsAt;
}
