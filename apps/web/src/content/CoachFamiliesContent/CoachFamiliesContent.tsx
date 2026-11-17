"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  CashRefundNeedsAttentionEntry,
  CoachFamiliesSortKey,
  CoachHouseholdBalanceListResponse,
} from "@swim-app/shared";

import { formatDollars } from "@/lib/formatDollars";
import { markCashRefundHandledAction } from "./actions";

// Low-balance threshold: one 30-min 1-swimmer lesson. Anything under this
// means the next parent booking will trip the insufficient-funds flow.
// Matches the server-side threshold used to compute `lowBalanceCount`.
const LOW_BALANCE_THRESHOLD_CENTS = 6_000;

interface Props {
  // Current page from the server. `page.items` is at most pageSize (20)
  // rows; `page.total` is the full filtered roster size; `page.lowBalanceCount`
  // is the under-$60 tally across the same filter so the callout stays
  // consistent as the parent pages or searches.
  page: CoachHouseholdBalanceListResponse;
  sort: CoachFamiliesSortKey;
  search: string;
  // ADR 036 Phase 8 Part B: pre-fetched global needs-attention list.
  // Rendered as a section at the top of the page when non-empty. Hidden
  // entirely when empty — no "all clear" empty state.
  initialNeedsAttention: CashRefundNeedsAttentionEntry[];
}

function formatLastActivity(iso: string | null): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(date);
}

function formatAttentionDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(new Date(iso));
}

export default function CoachFamiliesContent({
  page,
  sort,
  search,
  initialNeedsAttention,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNavTransition] = useTransition();

  // Local mirror of the search input so typing stays responsive without
  // round-tripping through the URL on every keystroke. The committed
  // value lives in `search` (from the server); we only push to the URL
  // when the parent presses Enter, submits the form, or clears the box.
  const [queryDraft, setQueryDraft] = useState(search);
  useEffect(() => {
    setQueryDraft(search);
  }, [search]);

  const [needsAttention, setNeedsAttention] = useState(initialNeedsAttention);
  const [markHandledForJobId, setMarkHandledForJobId] = useState<string | null>(null);

  function handleNeedsAttentionResolved(jobId: string): void {
    setNeedsAttention((prev) => prev.filter((entry) => entry.jobId !== jobId));
    setMarkHandledForJobId(null);
  }

  // Build an updated search-params string and push to the URL. Omitting a
  // value removes the key (e.g. page=1 is the default and stays off the
  // URL). The hook returns a ReadonlyURLSearchParams so we clone it.
  function pushParams(updates: Record<string, string | null>): void {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    const href = query === "" ? pathname : `${pathname}?${query}`;
    startNavTransition(() => {
      router.push(href);
    });
  }

  function handleSortChange(nextSort: CoachFamiliesSortKey): void {
    // Changing sort goes back to page 1 so the parent doesn't land past
    // the last page after re-ordering.
    pushParams({
      sort: nextSort === "activity_desc" ? null : nextSort,
      page: null,
    });
  }

  function handleSearchSubmit(): void {
    const trimmed = queryDraft.trim();
    pushParams({
      search: trimmed === "" ? null : trimmed,
      page: null,
    });
  }

  function handleClearSearch(): void {
    setQueryDraft("");
    pushParams({ search: null, page: null });
  }

  function goToPage(nextPage: number): void {
    pushParams({ page: nextPage === 1 ? null : String(nextPage) });
  }

  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));
  const currentPage = Math.min(Math.max(1, page.page), totalPages);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl tablet:text-4xl text-heading">
          Families
        </h1>
        <p className="text-sm text-text-secondary">
          Every household on the roster, with its current balance and the
          last ledger activity. Low-balance families bubble up first.
        </p>
      </header>

      {needsAttention.length > 0 && (
        <section
          aria-label="Refunds needing attention"
          data-testid="families-needs-attention"
          className="rounded-card border border-danger bg-surface-soft p-4 flex flex-col gap-3"
        >
          <h2 className="font-heading text-lg text-danger font-bold">
            Refunds needing attention
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {needsAttention.map((entry) => (
              <li
                key={entry.jobId}
                data-testid="families-needs-attention-row"
                className="flex items-start justify-between gap-3 py-2"
              >
                <div className="min-w-0 flex-1 text-sm text-text">
                  <p className="font-semibold truncate">
                    {entry.household !== null ? (
                      <Link
                        href={`/coach/families/${entry.household.id}`}
                        prefetch={false}
                        className="text-link hover:text-link-hover"
                      >
                        {entry.household.name}
                      </Link>
                    ) : (
                      <span data-testid="families-needs-attention-deleted">
                        Deleted family
                      </span>
                    )}
                  </p>
                  <p
                    className="text-xs text-text-secondary"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatDollars(entry.amountCents)} · {entry.reason} ·{" "}
                    {formatAttentionDate(entry.createdAt)}
                  </p>
                  {entry.stripePaymentIntentId !== null && (
                    <p className="text-xs text-text-secondary mt-1">
                      Stripe payment:{" "}
                      <code
                        data-testid="families-needs-attention-pi"
                        className="font-mono text-[11px] rounded bg-background px-1 py-0.5 border border-border"
                      >
                        {entry.stripePaymentIntentId}
                      </code>
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setMarkHandledForJobId(entry.jobId)}
                  data-testid="families-needs-attention-mark"
                  className="min-h-[44px] px-4 rounded-full border-2 border-button-outline text-button-outline text-sm font-bold shrink-0"
                >
                  Mark as refunded
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {page.lowBalanceCount > 0 && (
        <div
          role="status"
          data-testid="families-low-callout"
          className="rounded-card border border-danger/40 bg-danger/5 p-3 text-sm text-text flex items-center justify-between gap-3 flex-wrap"
        >
          <span>
            <span className="font-semibold text-danger">{page.lowBalanceCount}</span>{" "}
            {page.lowBalanceCount === 1 ? "family is" : "families are"} running low — less than
            one lesson in balance.
          </span>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSearchSubmit();
        }}
        className="flex gap-2 flex-wrap"
      >
        <label className="flex-1 min-w-[12rem] relative">
          <span className="sr-only">Search families</span>
          <input
            type="search"
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="Search by family or member name"
            data-testid="families-search-input"
            className="w-full min-h-[44px] px-3 pr-20 rounded-full border border-border bg-background text-text placeholder:text-text-secondary"
          />
          {search !== "" && (
            <button
              type="button"
              onClick={handleClearSearch}
              data-testid="families-search-clear"
              className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[32px] px-2 text-xs font-semibold text-text-secondary hover:text-text"
            >
              Clear
            </button>
          )}
        </label>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          Sort by
          <select
            value={sort}
            onChange={(event) =>
              handleSortChange(event.target.value as CoachFamiliesSortKey)
            }
            data-testid="families-sort-select"
            className="min-h-[44px] px-3 rounded-full border border-border bg-background text-text"
          >
            <option value="balance_asc">Balance (low → high)</option>
            <option value="name_asc">Family name</option>
            <option value="activity_desc">Last activity (newest)</option>
          </select>
        </label>
        {/* Search commits on Enter / Submit (keyboard a11y). The visible
            Clear button handles the opposite direction. */}
        <button type="submit" className="sr-only">
          Search
        </button>
      </form>

      {page.items.length === 0 ? (
        <p className="text-sm text-text-secondary py-8 text-center">
          {search === ""
            ? "No families on the roster yet."
            : "No families match that search."}
        </p>
      ) : (
        <ul
          className="flex flex-col divide-y divide-border rounded-card border border-border overflow-hidden bg-background"
          data-testid="families-list"
        >
          {page.items.map((family) => {
            const isLow = family.balanceCents < LOW_BALANCE_THRESHOLD_CENTS;
            return (
              <li key={family.householdId}>
                <Link
                  href={`/coach/families/${family.householdId}`}
                  prefetch={false}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-soft transition-colors duration-150 motion-reduce:transition-none"
                  data-testid="families-row"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-text truncate">
                      {family.householdName}
                    </p>
                    <p className="text-xs text-text-secondary truncate">
                      {family.memberFullNames.length > 0
                        ? family.memberFullNames.join(", ")
                        : "No members yet"}
                      {family.activeSwimmerCount > 0 && (
                        <>
                          {" · "}
                          {family.activeSwimmerCount} swimmer
                          {family.activeSwimmerCount === 1 ? "" : "s"}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className="font-semibold text-text"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {formatDollars(family.balanceCents)}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {isLow ? (
                        <span className="inline-flex items-center rounded-full border border-danger/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-danger">
                          Low
                        </span>
                      ) : (
                        formatLastActivity(family.lastActivityAt)
                      )}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Pager hides when there's only one page, including when the
          filtered set is empty. */}
      {totalPages > 1 && (
        <Pager
          currentPage={currentPage}
          totalPages={totalPages}
          onJump={goToPage}
        />
      )}

      {markHandledForJobId !== null && (
        <MarkCashRefundHandledModal
          jobId={markHandledForJobId}
          onResolved={handleNeedsAttentionResolved}
          onClose={() => setMarkHandledForJobId(null)}
        />
      )}
    </div>
  );
}

// ── Pager ──────────────────────────────────────────────────────────────
//
// Previous · [page numbers with ellipses on long rosters] · Next.
// Mobile-first: at <= 6 total pages we render the full list; at 7+ we
// elide the middle so the control stays on one line on a narrow phone.
// Hidden by the parent when totalPages === 1.

interface PagerProps {
  currentPage: number;
  totalPages: number;
  onJump: (page: number) => void;
}

function Pager({ currentPage, totalPages, onJump }: PagerProps) {
  const pages = buildPageList(currentPage, totalPages);

  return (
    <nav
      aria-label="Families pagination"
      data-testid="families-pager"
      className="flex items-center justify-between gap-2 flex-wrap"
    >
      <button
        type="button"
        onClick={() => onJump(currentPage - 1)}
        disabled={currentPage <= 1}
        data-testid="families-pager-prev"
        className="min-h-[44px] px-4 rounded-full border border-border text-sm font-semibold text-text hover:bg-surface-soft transition-colors duration-150 motion-reduce:transition-none active:scale-[0.97] motion-reduce:transform-none disabled:opacity-40 disabled:cursor-default"
      >
        Previous
      </button>

      <ol className="flex items-center gap-1" aria-label="Pages">
        {pages.map((entry, index) =>
          entry === "ellipsis" ? (
            <li
              key={`gap-${index}`}
              aria-hidden="true"
              className="px-1 text-sm text-text-secondary select-none"
            >
              …
            </li>
          ) : (
            <li key={entry}>
              <button
                type="button"
                onClick={() => onJump(entry)}
                aria-current={entry === currentPage ? "page" : undefined}
                data-testid={
                  entry === currentPage
                    ? "families-pager-current"
                    : `families-pager-page-${entry}`
                }
                className={[
                  "min-h-[36px] min-w-[36px] px-2 rounded-full text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none active:scale-[0.97] motion-reduce:transform-none",
                  entry === currentPage
                    ? "bg-heading text-background"
                    : "border border-border text-text hover:bg-surface-soft",
                ].join(" ")}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {entry}
              </button>
            </li>
          ),
        )}
      </ol>

      <button
        type="button"
        onClick={() => onJump(currentPage + 1)}
        disabled={currentPage >= totalPages}
        data-testid="families-pager-next"
        className="min-h-[44px] px-4 rounded-full border border-border text-sm font-semibold text-text hover:bg-surface-soft transition-colors duration-150 motion-reduce:transition-none active:scale-[0.97] motion-reduce:transform-none disabled:opacity-40 disabled:cursor-default"
      >
        Next
      </button>
    </nav>
  );
}

// Build a compact page list with first/last always shown and a window
// around the current page. Example at current=7, total=20:
// [1, "ellipsis", 6, 7, 8, "ellipsis", 20]
function buildPageList(
  currentPage: number,
  totalPages: number,
): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_unused, index) => index + 1);
  }
  const pages: Array<number | "ellipsis"> = [1];
  const windowStart = Math.max(2, currentPage - 1);
  const windowEnd = Math.min(totalPages - 1, currentPage + 1);
  if (windowStart > 2) pages.push("ellipsis");
  for (let page = windowStart; page <= windowEnd; page += 1) {
    pages.push(page);
  }
  if (windowEnd < totalPages - 1) pages.push("ellipsis");
  pages.push(totalPages);
  return pages;
}

// ── Mark-cash-refund-handled modal (shared with per-family banner) ─────

interface MarkCashRefundHandledModalProps {
  jobId: string;
  onResolved: (jobId: string) => void;
  onClose: () => void;
}

function MarkCashRefundHandledModal({
  jobId,
  onResolved,
  onClose,
}: MarkCashRefundHandledModalProps) {
  const [note, setNote] = useState("");
  const [submitting, startSubmitting] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmed = note.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 500 && !submitting;

  function handleSubmit(): void {
    if (!canSubmit) return;
    setErrorMessage(null);
    startSubmitting(async () => {
      const result = await markCashRefundHandledAction(jobId, { note: trimmed });
      if (result.kind === "ok") {
        onResolved(jobId);
        return;
      }
      if (result.kind === "not_found") {
        setErrorMessage("This refund entry no longer exists.");
        return;
      }
      if (result.kind === "invalid_state") {
        setErrorMessage("This refund was already resolved.");
        return;
      }
      setErrorMessage(result.message);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end tablet:items-center justify-center bg-ink/60 p-0 tablet:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="families-mark-handled-title"
      data-testid="families-mark-handled-modal"
    >
      <div className="w-full max-w-[480px] bg-background rounded-t-card tablet:rounded-card border border-border p-6 flex flex-col gap-4">
        <h2
          id="families-mark-handled-title"
          className="font-heading text-xl text-heading"
        >
          Mark as refunded
        </h2>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-text-secondary">
            How was this refunded?
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. refunded in Stripe on Nov 12. Don't include personal details."
            data-testid="families-mark-handled-note"
            className="px-3 py-2 rounded border border-border bg-background text-text placeholder:text-text-secondary resize-none"
          />
          <span className="text-xs text-text-secondary">
            Required. Jot down the resolution (Stripe refund id, Venmo, etc).
          </span>
        </label>
        {errorMessage !== null && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 min-h-[44px] rounded-full border border-border text-text font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="families-mark-handled-submit"
            className="flex-1 min-h-[44px] rounded-full bg-accent text-on-accent font-bold disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
