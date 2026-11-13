"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type {
  CashRefundNeedsAttentionEntry,
  CoachHouseholdBalanceSummary,
} from "@swim-app/shared";

import { formatDollars } from "@/lib/formatDollars";
import { markCashRefundHandledAction } from "./actions";

// Low-balance threshold: one 30-min 1-swimmer lesson. Anything under this
// means the next parent booking will trip the insufficient-funds flow.
const LOW_BALANCE_THRESHOLD_CENTS = 6_000;

type SortKey = "balance_asc" | "name_asc" | "activity_desc";

interface Props {
  families: CoachHouseholdBalanceSummary[];
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
  families,
  initialNeedsAttention,
}: Props) {
  // Default to last-activity descending: the roster reads like a timeline
  // ("who did I hear from most recently?"). The Low-balance callout at
  // the top still answers "who's running low?" at a glance, so the sort
  // doesn't have to lead with balance.
  const [sortKey, setSortKey] = useState<SortKey>("activity_desc");
  const [query, setQuery] = useState("");
  const [needsAttention, setNeedsAttention] = useState(initialNeedsAttention);
  const [markHandledForJobId, setMarkHandledForJobId] = useState<string | null>(null);

  function handleNeedsAttentionResolved(jobId: string): void {
    setNeedsAttention((prev) => prev.filter((entry) => entry.jobId !== jobId));
    setMarkHandledForJobId(null);
  }

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed === "") return families;
    return families.filter((family) => {
      if (family.householdName.toLowerCase().includes(trimmed)) return true;
      return family.memberFullNames.some((name) =>
        name.toLowerCase().includes(trimmed),
      );
    });
  }, [families, query]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    switch (sortKey) {
      case "balance_asc":
        list.sort((a, b) => a.balanceCents - b.balanceCents);
        break;
      case "name_asc":
        list.sort((a, b) => a.householdName.localeCompare(b.householdName));
        break;
      case "activity_desc":
        list.sort((a, b) => {
          const aAt = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
          const bAt = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
          return bAt - aAt;
        });
        break;
    }
    return list;
  }, [filtered, sortKey]);

  const lowCount = useMemo(
    () => families.filter((family) => family.balanceCents < LOW_BALANCE_THRESHOLD_CENTS).length,
    [families],
  );

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

      {lowCount > 0 && (
        <div
          role="status"
          data-testid="families-low-callout"
          className="rounded-card border border-danger/40 bg-danger/5 p-3 text-sm text-text flex items-center justify-between gap-3 flex-wrap"
        >
          <span>
            <span className="font-semibold text-danger">{lowCount}</span>{" "}
            {lowCount === 1 ? "family is" : "families are"} running low — less than
            one lesson in balance.
          </span>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <label className="flex-1 min-w-[12rem]">
          <span className="sr-only">Search families</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by family or member name"
            className="w-full min-h-[44px] px-3 rounded-full border border-border bg-background text-text placeholder:text-text-secondary"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          Sort by
          <select
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
            className="min-h-[44px] px-3 rounded-full border border-border bg-background text-text"
          >
            <option value="balance_asc">Balance (low → high)</option>
            <option value="name_asc">Family name</option>
            <option value="activity_desc">Last activity (newest)</option>
          </select>
        </label>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-text-secondary py-8 text-center">
          No families match that search.
        </p>
      ) : (
        <ul
          className="flex flex-col divide-y divide-border rounded-card border border-border overflow-hidden bg-background"
          data-testid="families-list"
        >
          {sorted.map((family) => {
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
            data-testid="families-mark-handled-note"
            className="px-3 py-2 rounded border border-border bg-background text-text resize-none"
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
