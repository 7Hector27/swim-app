import { Suspense } from "react";

import BoardFilters from "@/components/BoardFilters";
import BoardTable from "@/components/BoardTable";
import type { PublicMasterRow } from "@swim-app/shared";

interface MasterBoardContentProps {
  standardsAvailable: boolean;
  rows: PublicMasterRow[];
  loadFailed?: boolean;
}

export default function MasterBoardContent({
  standardsAvailable,
  rows,
  loadFailed = false,
}: MasterBoardContentProps) {
  return (
    <div className="bg-section min-h-screen">
      <div className="mx-auto max-w-content px-page py-12 tablet:py-16">
        <nav aria-label="Breadcrumb" className="mb-8">
          <a
            href="/leaderboard"
            className="text-text-secondary-on-section text-sm hover:text-text-on-section transition-colors duration-150"
          >
            ← Leaderboards
          </a>
        </nav>

        <div className="flex flex-col gap-3 mb-8">
          <h1 className="text-text-on-section">Master Board</h1>
          <p className="text-text-secondary-on-section text-base">
            Personal bests from swimmers whose families opted in to public display.
          </p>
        </div>

        {!loadFailed && !standardsAvailable && (
          <div className="rounded-card bg-card border border-divider-section px-5 py-4 text-text-secondary-on-section text-sm mb-6">
            Standards coming soon
          </div>
        )}

        <div className="mb-6">
          <Suspense fallback={null}>
            <BoardFilters />
          </Suspense>
        </div>

        {loadFailed ? (
          <p className="text-text-secondary-on-section text-sm py-16 text-center">
            Couldn&apos;t load the leaderboard. Try again.
          </p>
        ) : (
          <BoardTable rows={rows} showStandard={standardsAvailable} />
        )}
      </div>
    </div>
  );
}
