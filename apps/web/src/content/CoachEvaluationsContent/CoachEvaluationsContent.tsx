"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { CoachSwimmerDetail, GetEvaluationsItem } from "@swim-app/shared";

import EvaluationsList from "@/components/EvaluationsList";
import { fetchSwimmerEvaluations } from "@/lib/api/evaluations";

interface CoachEvaluationsContentProps {
  swimmer: CoachSwimmerDetail;
  accessToken: string;
  initialEvaluations: GetEvaluationsItem[];
  initialNextCursor: string | null;
}

const PAGE_LIMIT = 20;

export default function CoachEvaluationsContent({
  swimmer,
  accessToken,
  initialEvaluations,
  initialNextCursor,
}: CoachEvaluationsContentProps) {
  const [items, setItems] = useState<GetEvaluationsItem[]>(initialEvaluations);
  const [cursor, setCursor] = useState<string | null>(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setLoadError(null);
    const result = await fetchSwimmerEvaluations(swimmer.id, accessToken, {
      cursor,
      limit: PAGE_LIMIT,
    });
    if (!result.ok) {
      setLoadError("Couldn't load more. Try again.");
      setLoading(false);
      return;
    }
    setItems((previous) => [...previous, ...result.data.evaluations]);
    setCursor(result.data.nextCursor);
    setLoading(false);
  }, [cursor, loading, swimmer.id, accessToken]);

  const returnTo = `/coach/swimmers/${swimmer.id}/evaluations`;

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-8">
        <div className="mx-auto max-w-content flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Link
              href={`/coach/swimmers/${swimmer.id}`}
              className="text-sm text-link hover:text-link-hover"
            >
              ‹ {swimmer.firstName} {swimmer.lastName}
            </Link>
            <h1 className="text-heading text-text">
              Evaluations
            </h1>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-text-secondary">No evaluations yet.</p>
          ) : (
            <EvaluationsList
              swimmerId={swimmer.id}
              evaluations={items}
              returnTo={returnTo}
            />
          )}

          {cursor && (
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loading}
                className="min-h-[44px] px-5 rounded-[var(--radius-button)] text-sm font-semibold border transition-transform duration-150 active:scale-[0.97]"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text)",
                  transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
                }}
                data-testid="coach-evaluations-load-more"
              >
                {loading ? "Loading..." : "Load more"}
              </button>
              {loadError && (
                <p className="text-xs" style={{ color: "var(--color-danger)" }}>
                  {loadError}
                </p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
