import Link from "next/link";

import type {
  ParentSwimmerProgressResponse,
  ParentScoreHistoryResponse,
} from "@swim-app/shared";

import InlineError from "@/components/InlineError";
import CategoryRadar from "@/content/SwimmerProgressContent/charts/CategoryRadar";
import {
  firstScreenGroupSnapshot,
  latestScreenGroupSnapshot,
} from "@/lib/progressCharts";

import type { SectionResult } from "./SwimmerProfileContent";

interface ProgressSnapshotSectionProps {
  result: SectionResult<ParentSwimmerProgressResponse>;
  scoreHistory: SectionResult<ParentScoreHistoryResponse>;
  swimmerId: string;
}

// The parent-side Progress card. Title, the group-rollup radar (tappable,
// deep-linking to the progress page), then the View progress button. When
// the swimmer has no evaluations yet, the card collapses to a single
// empty line — no radar, no button.
//
// Data must match the progress page's Snapshot radar exactly: same
// CategoryRadar component, same screen-group rollups
// (`latestScreenGroupSnapshot`), and the same dashed first-evaluation
// overlay once the swimmer has more than one session. Keeping the
// profile card wired to the same helpers is the only way the two pages
// can't disagree.
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

  // "No evaluations yet" is the whole card body. The score-history
  // endpoint emits one point per non-voided evaluation; an empty
  // points[] means the swimmer has never been evaluated.
  const hasAnyEvaluation = scoreHistory.ok && scoreHistory.data.points.length > 0;

  const progressHref = `/dashboard/swimmers/${swimmerId}/progress`;
  const categories = scoreHistory.ok ? latestScreenGroupSnapshot(scoreHistory.data) : [];
  // Mirror the progress page: the dashed first-evaluation outline only
  // makes sense when the swimmer has more than one session — otherwise
  // it overlays an identical shape.
  const firstEvaluation =
    scoreHistory.ok && scoreHistory.data.points.length >= 2
      ? firstScreenGroupSnapshot(scoreHistory.data)
      : [];

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
              <CategoryRadar
                categories={categories}
                {...(firstEvaluation.length > 0 && { firstEvaluation })}
              />
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
