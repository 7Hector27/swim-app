import Link from "next/link";

import type {
  ParentSwimmerProgressResponse,
  ParentScoreHistoryResponse,
} from "@swim-app/shared";

import InlineError from "@/components/InlineError";
import CategoryRadar from "@/content/SwimmerProgressContent/charts/CategoryRadar";

import type { SectionResult } from "./SwimmerProfileContent";

interface ProgressSnapshotSectionProps {
  result: SectionResult<ParentSwimmerProgressResponse>;
  scoreHistory: SectionResult<ParentScoreHistoryResponse>;
  swimmerId: string;
}

// The parent-side Progress card. Title, the category-rollup radar (tappable,
// deep-linking to the progress page), then the View progress button. When
// the swimmer has no evaluations yet, the card collapses to a single empty
// line — no radar, no button.
export default function ProgressSnapshotSection({
  result,
  scoreHistory,
  swimmerId,
}: ProgressSnapshotSectionProps) {
  if (!result.ok) {
    return (
      <section className="rounded-card border border-border p-5 flex flex-col gap-3">
        <h2 className="text-sm font-bold text-text">Progress</h2>
        <InlineError message="Couldn't load progress." reloadOnRetry />
      </section>
    );
  }

  // "No evaluations yet" is the whole card body. The score-history endpoint
  // emits one point per non-voided evaluation; an empty points[] means the
  // swimmer has never been evaluated.
  const hasAnyEvaluation = scoreHistory.ok && scoreHistory.data.points.length > 0;

  const progressHref = `/dashboard/swimmers/${swimmerId}/progress`;
  const categories = scoreHistory.ok ? latestCategorySnapshot(scoreHistory.data) : [];

  return (
    <section className="rounded-card border border-border p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-text">Progress</h2>
      </div>

      {!hasAnyEvaluation ? (
        <p className="text-xs text-text-secondary">No evaluations yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {categories.length > 0 && (
            <Link
              href={progressHref}
              aria-label="View progress"
              data-testid="progress-radar-link"
              className="block w-full rounded-[var(--radius-card)] transition-transform duration-150 active:scale-[0.98]"
              style={{ transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
            >
              <CategoryRadar categories={categories} />
            </Link>
          )}

          <Link
            href={progressHref}
            data-testid="progress-card-cta"
            className="rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm h-11 flex items-center justify-center self-start px-5 transition-transform duration-150 active:scale-[0.97]"
            style={{ transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
          >
            View progress
          </Link>
        </div>
      )}
    </section>
  );
}

// Pulls the latest score-history point's category rollups and shapes them for
// the radar component. Returns an empty list when the swimmer has no evals
// (points[] is empty), so the radar block gracefully doesn't render.
function latestCategorySnapshot(
  scoreHistory: ParentScoreHistoryResponse,
): Array<{ name: string; average: number | null; assessedCount: number }> {
  const latest = scoreHistory.points[scoreHistory.points.length - 1];
  if (!latest) return [];
  return latest.categoryRollups.map((rollup) => ({
    name: rollup.categoryName,
    average: rollup.average,
    assessedCount: rollup.assessedCount,
  }));
}
