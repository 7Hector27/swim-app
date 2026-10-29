import Link from "next/link";

import type {
  LatestCoachingPriority,
  ParentSwimmerProgressResponse,
} from "@swim-app/shared";

import type { SectionResult } from "./SwimmerProfileContent";
import { formatRelativeDay } from "./helpers";

interface ProgressSnapshotSectionProps {
  result: SectionResult<ParentSwimmerProgressResponse>;
  priority: LatestCoachingPriority | null;
  swimmerId: string;
}

export default function ProgressSnapshotSection({
  result,
  priority,
  swimmerId,
}: ProgressSnapshotSectionProps) {
  if (!result.ok) {
    return (
      <section className="rounded-card border border-border p-5 flex flex-col gap-3">
        <h2 className="text-sm font-bold text-text">Current focus</h2>
        <p className="text-xs text-text-secondary">
          Couldn't load progress. Please refresh.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-border p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-text">Current focus</h2>
        {priority && (
          <Link
            href={`/dashboard/swimmers/${swimmerId}/progress`}
            className="text-xs font-semibold text-link hover:text-link-hover"
          >
            See all →
          </Link>
        )}
      </div>
      {priority ? (
        <div className="flex flex-col gap-1" data-testid="current-focus-priority">
          <p className="text-sm font-semibold text-text">{priority.text}</p>
          <p className="text-xs text-text-secondary">
            From {formatRelativeDay(priority.sessionDate)}
          </p>
        </div>
      ) : (
        <p className="text-xs text-text-secondary">
          No evaluations recorded yet. Check back after the next practice.
        </p>
      )}
    </section>
  );
}
