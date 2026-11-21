import { Suspense } from "react";

import BoardFilters from "@/components/BoardFilters";
import BoardTable from "@/components/BoardTable";
import type { PublicMasterRow } from "@swim-app/shared";

interface MasterBoardContentProps {
  rows: PublicMasterRow[];
  loadFailed?: boolean;
}

export default function MasterBoardContent({ rows, loadFailed = false }: MasterBoardContentProps) {
  // Only show the Standard column if at least one row carries one. Standards
  // are optional now (ADR 023 decided) — the master board ranks by time when
  // no standard is defined for the event list.
  const showStandard = rows.some((row) => row.standard !== null);

  return (
    <div className="bg-background">
      <div className="mx-auto max-w-content px-page py-12 tablet:py-16">
        <nav aria-label="Breadcrumb" className="mb-8">
          <a
            href="/leaderboard"
            className="text-text-secondary text-sm hover:text-text transition-colors duration-150"
          >
            ← Leaderboards
          </a>
        </nav>

        <div className="flex flex-col gap-3 mb-8">
          <h1 className="text-heading">Master Board</h1>
          <p className="text-text-secondary text-base">
            Personal bests from swimmers whose families opted in to public display.
          </p>
        </div>

        <div className="mb-6">
          <Suspense fallback={null}>
            <BoardFilters />
          </Suspense>
        </div>

        {loadFailed ? (
          <p className="text-text-secondary text-sm py-16 text-center">
            Couldn&apos;t load the leaderboard. Try again.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-text-secondary text-sm py-16 text-center">
            Not enough results yet. Check back after the next meet.
          </p>
        ) : (
          <BoardTable rows={rows} showStandard={showStandard} />
        )}
      </div>
    </div>
  );
}
