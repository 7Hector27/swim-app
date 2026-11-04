import type { ParentPersonalBestsResponse } from "@swim-app/shared";

import InlineError from "@/components/InlineError";

import type { SectionResult } from "./SwimmerProfileContent";
import { formatCourseLabel, formatEventName } from "./helpers";

interface PersonalBestsSectionProps {
  result: SectionResult<ParentPersonalBestsResponse>;
}

export default function PersonalBestsSection({ result }: PersonalBestsSectionProps) {
  if (!result.ok) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-text">Personal bests</h2>
        <InlineError message="Couldn't load personal bests." reloadOnRetry />
      </section>
    );
  }

  const personalBests = result.data.personalBests;

  if (personalBests.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-text">Personal bests</h2>
        <p className="text-xs text-text-secondary">
          No meet times recorded yet.
        </p>
      </section>
    );
  }

  const sorted = [...personalBests].sort(sortPersonalBests);

  return (
    <section aria-label="Personal bests" className="flex flex-col gap-3">
      <h2 className="text-sm font-bold text-text">Personal bests</h2>
      <div className="-mx-page overflow-x-auto tablet:mx-0 tablet:overflow-visible">
        <ul
          className="
            px-page flex gap-2 pb-1
            tablet:px-0 tablet:pb-0 tablet:grid tablet:grid-cols-3 tablet:gap-3
            desktop:grid-cols-4
          "
        >
          {sorted.map((pb) => (
            <li
              key={`${pb.eventDistance}-${pb.eventStroke}-${pb.course}`}
              className="flex-shrink-0 rounded-card border border-border px-4 py-3 min-w-[120px] tablet:min-w-0"
            >
              <p className="text-[11px] text-text-secondary">
                {formatEventName(pb.eventDistance, pb.eventStroke)}
              </p>
              <p className="font-heading text-base text-text tabular-nums mt-0.5">
                {pb.timeString}
              </p>
              <p className="text-[10px] text-text-secondary mt-0.5 uppercase tracking-wide">
                {formatCourseLabel(pb.course)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STROKE_ORDER: Record<string, number> = {
  free: 0,
  back: 1,
  breast: 2,
  fly: 3,
  im: 4,
};

function sortPersonalBests<T extends { eventDistance: number; eventStroke: string; course: string }>(
  a: T,
  b: T,
): number {
  const strokeDiff = (STROKE_ORDER[a.eventStroke] ?? 99) - (STROKE_ORDER[b.eventStroke] ?? 99);
  if (strokeDiff !== 0) return strokeDiff;
  const distDiff = a.eventDistance - b.eventDistance;
  if (distDiff !== 0) return distDiff;
  return a.course.localeCompare(b.course);
}
