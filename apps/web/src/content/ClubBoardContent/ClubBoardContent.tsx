import { Suspense } from "react";

import BoardFilters from "@/components/BoardFilters";
import BoardTable from "@/components/BoardTable";
import type { PublicBoardRow } from "@swim-app/shared";

interface ClubBoardContentProps {
  rows: PublicBoardRow[];
  loadFailed?: boolean;
}

export default function ClubBoardContent({ rows, loadFailed = false }: ClubBoardContentProps) {
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
          <h1 className="text-heading">Club Swim</h1>
          <p className="text-text-secondary text-base">
            Top times from the current club season.
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
        ) : (
          <BoardTable rows={rows} />
        )}
      </div>
    </div>
  );
}
