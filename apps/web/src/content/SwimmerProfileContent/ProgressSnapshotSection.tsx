import Link from "next/link";

import type {
  ParentSwimmerProgressResponse,
  ProgressCoachingPriority,
} from "@swim-app/shared";

import type { SectionResult } from "./SwimmerProfileContent";

interface ProgressSnapshotSectionProps {
  result: SectionResult<ParentSwimmerProgressResponse>;
  priority: ProgressCoachingPriority | null;
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
        <p className="text-sm font-semibold text-text">{priority.targetName}</p>
      ) : (
        <p className="text-xs text-text-secondary">
          No evaluations recorded yet. Check back after the next practice.
        </p>
      )}
    </section>
  );
}
