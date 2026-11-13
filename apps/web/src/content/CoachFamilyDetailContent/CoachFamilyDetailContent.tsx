"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import type {
  BalanceHistoryEntry,
  BalanceHistoryResponse,
  BalanceResponse,
  CashOutBreakdown,
  NeedsManualRefundJob,
} from "@swim-app/shared";

import { formatDollars } from "@/lib/formatDollars";
import {
  executeCashOutAction,
  fetchCashOutPreviewAction,
  fetchMoreFamilyHistoryAction,
  markCashRefundHandledAction,
  refreshFamilyBalanceAction,
  submitCoachAdjustmentAction,
} from "./actions";

const LOW_BALANCE_THRESHOLD_CENTS = 6_000;

interface Props {
  householdId: string;
  householdName: string;
  memberFullNames: string[];
  activeSwimmerCount: number;
  initialBalance: BalanceResponse;
  initialHistory: BalanceHistoryResponse;
  // ADR 036 Phase 8 Part B: pre-fetched needs-manual-handling cash-
  // refund jobs for this family. Non-empty renders the "Refund needed
  // manually" banner above the balance card. Each entry has its own
  // Mark-as-refunded action.
  initialNeedsManualJobs: NeedsManualRefundJob[];
}

function formatHistoryDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(iso));
}

function formatSignedDollars(cents: number): string {
  if (cents > 0) return `+${formatDollars(cents)}`;
  if (cents < 0) return formatDollars(cents);
  return formatDollars(0);
}

function formatNeedsManualDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(new Date(iso));
}

export default function CoachFamilyDetailContent(props: Props) {
  const [balance, setBalance] = useState(props.initialBalance);
  const [entries, setEntries] = useState<BalanceHistoryEntry[]>(
    props.initialHistory.entries,
  );
  const [nextCursor, setNextCursor] = useState<string | null>(
    props.initialHistory.nextCursor,
  );
  const [loadingMore, startLoadingMore] = useTransition();
  const [pageError, setPageError] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [needsManualJobs, setNeedsManualJobs] = useState<NeedsManualRefundJob[]>(
    props.initialNeedsManualJobs,
  );
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [markHandledForJobId, setMarkHandledForJobId] = useState<string | null>(null);

  function handleNeedsManualResolved(jobId: string): void {
    setNeedsManualJobs((prev) => prev.filter((job) => job.id !== jobId));
    setMarkHandledForJobId(null);
  }

  async function handleCashOutCompleted(): Promise<void> {
    setCashOutOpen(false);
    const refreshed = await refreshFamilyBalanceAction(props.householdId);
    if (refreshed.ok) setBalance(refreshed.data);
    const historyReload = await fetchMoreFamilyHistoryAction(props.householdId, "");
    if (historyReload.ok) {
      setEntries(historyReload.data.entries);
      setNextCursor(historyReload.data.nextCursor);
    }
  }

  function handleLoadMore() {
    if (nextCursor === null || loadingMore) return;
    startLoadingMore(async () => {
      const result = await fetchMoreFamilyHistoryAction(
        props.householdId,
        nextCursor,
      );
      if (!result.ok) {
        setPageError(result.message);
        return;
      }
      setEntries((prev) => [...prev, ...result.data.entries]);
      setNextCursor(result.data.nextCursor);
    });
  }

  async function handleAdjustmentCommitted(nextBalanceCents: number) {
    setAdjustOpen(false);
    // Refresh both the headline balance and the history so the new row
    // shows up without a page reload.
    setBalance((prev) => ({ ...prev, balanceCents: nextBalanceCents }));
    const refreshed = await refreshFamilyBalanceAction(props.householdId);
    if (refreshed.ok) {
      setBalance(refreshed.data);
    }
    // Also reload the first page of history to pick up the new row.
    const historyReload = await fetchMoreFamilyHistoryAction(
      props.householdId,
      "",
    );
    if (historyReload.ok) {
      setEntries(historyReload.data.entries);
      setNextCursor(historyReload.data.nextCursor);
    }
  }

  const isLow = balance.balanceCents < LOW_BALANCE_THRESHOLD_CENTS;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/coach/families" className="text-link hover:text-link-hover">
          ← Families
        </Link>
      </div>

      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl tablet:text-4xl text-heading">
          {props.householdName}
        </h1>
        <p className="text-sm text-text-secondary">
          {props.memberFullNames.length > 0
            ? props.memberFullNames.join(", ")
            : "No members yet"}
          {props.activeSwimmerCount > 0 && (
            <>
              {" · "}
              {props.activeSwimmerCount} swimmer
              {props.activeSwimmerCount === 1 ? "" : "s"}
            </>
          )}
        </p>
      </header>

      {needsManualJobs.length > 0 && (
        <section
          aria-label="Refunds needing manual handling"
          data-testid="family-needs-manual-banner"
          className="rounded-card border border-danger bg-surface-soft p-4 flex flex-col gap-3"
        >
          <p className="text-sm font-heading text-danger font-bold">
            Refund needed manually
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {needsManualJobs.map((job) => (
              <li
                key={job.id}
                data-testid="family-needs-manual-entry"
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0 flex-1 text-sm text-text">
                  <p
                    className="font-semibold"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatDollars(job.amountCents)}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {job.reason} · {formatNeedsManualDate(job.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMarkHandledForJobId(job.id)}
                  data-testid="family-needs-manual-mark"
                  className="min-h-[44px] px-4 rounded-full border-2 border-button-outline text-button-outline text-sm font-bold"
                >
                  Mark as refunded
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-label="Family balance"
        data-testid="family-balance-card"
        className="rounded-card border border-border bg-background p-5 flex items-start justify-between gap-4 flex-wrap"
      >
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
            Current balance
          </p>
          <p
            className="font-heading text-3xl text-heading mt-1"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatDollars(balance.balanceCents)}
          </p>
          {isLow && (
            <p className="text-sm text-danger font-semibold mt-1">Running low</p>
          )}
          <p className="text-xs text-text-secondary mt-1">
            ≈ {balance.approximatePrivateHours}{" "}
            {balance.approximatePrivateHours === 1 ? "hour" : "hours"} of
            private lessons.
          </p>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setAdjustOpen(true)}
            data-testid="adjust-balance-open"
            className="min-h-[44px] px-4 rounded-full border-2 border-button-outline text-button-outline text-sm font-bold"
          >
            Adjust balance
          </button>
          {balance.balanceCents > 0 && (
            <button
              type="button"
              onClick={() => setCashOutOpen(true)}
              data-testid="refund-leftover-open"
              className="min-h-[44px] px-4 rounded-full border-2 border-button-outline text-button-outline text-sm font-bold"
            >
              Refund leftover balance
            </button>
          )}
        </div>
      </section>

      {pageError !== null && (
        <p role="alert" className="text-sm text-danger">
          {pageError}
        </p>
      )}

      <section
        aria-label="History"
        className="rounded-card border border-border bg-background overflow-hidden"
      >
        <header className="px-4 py-3 border-b border-border">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
            History
          </p>
        </header>
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-secondary text-center">
            No ledger activity yet.
          </p>
        ) : (
          <ul className="divide-y divide-border" data-testid="family-history-list">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text truncate">{entry.displayType}</p>
                  <p className="text-xs text-text-secondary">
                    {formatHistoryDate(entry.createdAt)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p
                    className={`text-sm font-semibold ${entry.amountCents < 0 ? "text-text" : "text-accent"}`}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatSignedDollars(entry.amountCents)}
                  </p>
                  <p
                    className="text-xs text-text-secondary"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatDollars(entry.runningBalanceCents)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {nextCursor !== null && (
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            data-testid="family-history-more"
            className="w-full min-h-[44px] text-sm font-semibold text-link border-t border-border hover:bg-surface-soft disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "See more"}
          </button>
        )}
      </section>

      {adjustOpen && (
        <AdjustBalanceModal
          householdId={props.householdId}
          balanceCents={balance.balanceCents}
          onCommitted={handleAdjustmentCommitted}
          onClose={() => setAdjustOpen(false)}
        />
      )}

      {cashOutOpen && (
        <CashOutModal
          householdId={props.householdId}
          onDone={handleCashOutCompleted}
          onClose={() => setCashOutOpen(false)}
        />
      )}

      {markHandledForJobId !== null && (
        <MarkCashRefundHandledModal
          jobId={markHandledForJobId}
          onResolved={handleNeedsManualResolved}
          onClose={() => setMarkHandledForJobId(null)}
        />
      )}
    </div>
  );
}

// ── Adjust-balance modal ──────────────────────────────────────────────────

interface AdjustBalanceModalProps {
  householdId: string;
  balanceCents: number;
  onCommitted: (nextBalanceCents: number) => void;
  onClose: () => void;
}

function AdjustBalanceModal({
  householdId,
  balanceCents,
  onCommitted,
  onClose,
}: AdjustBalanceModalProps) {
  type Step = "form" | "confirm";
  const [step, setStep] = useState<Step>("form");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [amountDollars, setAmountDollars] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, startSubmitting] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [shortfall, setShortfall] = useState<{
    balanceCents: number;
    shortfallCents: number;
  } | null>(null);

  const amountCents = (() => {
    const normalized = amountDollars.trim();
    if (normalized === "") return null;
    const cents = Math.round(parseFloat(normalized) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return null;
    return direction === "credit" ? cents : -cents;
  })();

  const canContinue =
    amountCents !== null &&
    amountCents !== 0 &&
    reason.trim().length > 0 &&
    !submitting;

  function handleContinue() {
    if (!canContinue) return;
    setErrorMessage(null);
    setShortfall(null);
    setStep("confirm");
  }

  function handleBack() {
    setStep("form");
    setErrorMessage(null);
  }

  function handleSubmit() {
    if (!canContinue || amountCents === null) return;
    setErrorMessage(null);
    setShortfall(null);
    startSubmitting(async () => {
      const result = await submitCoachAdjustmentAction(householdId, {
        amountCents,
        reason: reason.trim(),
      });
      if (result.kind === "ok") {
        onCommitted(result.data.balanceCents);
        return;
      }
      if (result.kind === "insufficient_balance") {
        setShortfall({
          balanceCents: result.balanceCents,
          shortfallCents: result.shortfallCents,
        });
        setStep("form");
        return;
      }
      setErrorMessage(result.message);
      setStep("form");
    });
  }

  const nextBalanceCents =
    amountCents !== null ? balanceCents + amountCents : balanceCents;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end tablet:items-center justify-center bg-ink/60 p-0 tablet:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adjust-balance-title"
      data-testid="adjust-balance-modal"
    >
      <div className="w-full max-w-[480px] bg-background rounded-t-card tablet:rounded-card border border-border p-6 flex flex-col gap-4">
        <h2
          id="adjust-balance-title"
          className="font-heading text-xl text-heading"
        >
          {step === "form" ? "Adjust balance" : "Confirm adjustment"}
        </h2>

        {step === "form" ? (
          <>
            <div
              role="radiogroup"
              aria-label="Direction"
              className="flex rounded-full border border-border overflow-hidden"
            >
              <button
                type="button"
                role="radio"
                aria-checked={direction === "credit"}
                onClick={() => setDirection("credit")}
                data-testid="adjust-direction-credit"
                className={`flex-1 min-h-[44px] text-sm font-semibold ${
                  direction === "credit"
                    ? "bg-heading text-background"
                    : "text-text"
                }`}
              >
                Credit (+)
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={direction === "debit"}
                onClick={() => setDirection("debit")}
                data-testid="adjust-direction-debit"
                className={`flex-1 min-h-[44px] text-sm font-semibold border-l border-border ${
                  direction === "debit"
                    ? "bg-heading text-background"
                    : "text-text"
                }`}
              >
                Debit (−)
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-text-secondary">
                Amount (US dollars)
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amountDollars}
                onChange={(event) => setAmountDollars(event.target.value)}
                placeholder="0.00"
                data-testid="adjust-amount"
                className="min-h-[44px] px-3 rounded border border-border bg-background text-text"
                style={{ fontVariantNumeric: "tabular-nums" }}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-text-secondary">
                Reason
              </span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={500}
                data-testid="adjust-reason"
                className="px-3 py-2 rounded border border-border bg-background text-text resize-none"
              />
              <span
                className="text-xs text-text-secondary"
                data-testid="adjust-reason-hint"
              >
                The family will see this reason.
              </span>
            </label>

            {shortfall !== null && (
              <p
                role="alert"
                data-testid="adjust-shortfall"
                className="text-sm text-danger"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                A debit of {formatDollars(-(amountCents ?? 0))} would drop
                balance below zero (current: {formatDollars(shortfall.balanceCents)}).
              </p>
            )}
            {errorMessage !== null && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[44px] rounded-full border border-border text-text font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleContinue}
                disabled={!canContinue}
                data-testid="adjust-continue"
                className="flex-1 min-h-[44px] rounded-full bg-accent text-on-accent font-bold disabled:opacity-60"
              >
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              className="rounded border border-border bg-surface-soft p-3 text-sm text-text flex flex-col gap-1"
              style={{ fontVariantNumeric: "tabular-nums" }}
              data-testid="adjust-confirm-summary"
            >
              <p>
                Current balance:{" "}
                <span className="font-semibold">{formatDollars(balanceCents)}</span>
              </p>
              <p>
                {direction === "credit" ? "Credit" : "Debit"}:{" "}
                <span className="font-semibold">
                  {formatDollars(Math.abs(amountCents ?? 0))}
                </span>
              </p>
              <p>
                New balance:{" "}
                <span className="font-semibold">
                  {formatDollars(nextBalanceCents)}
                </span>
              </p>
              <p className="text-xs text-text-secondary mt-1">
                Reason: {reason.trim()}
              </p>
            </div>
            {errorMessage !== null && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleBack}
                disabled={submitting}
                className="flex-1 min-h-[44px] rounded-full border border-border text-text font-semibold disabled:opacity-60"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                data-testid="adjust-confirm"
                className="flex-1 min-h-[44px] rounded-full bg-accent text-on-accent font-bold disabled:opacity-60"
              >
                {submitting ? "Saving…" : "Save adjustment"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Refund leftover balance modal (ADR 036 Phase 8 Part B) ──────────────

interface CashOutModalProps {
  householdId: string;
  onDone: () => void | Promise<void>;
  onClose: () => void;
}

function CashOutModal({ householdId, onDone, onClose }: CashOutModalProps) {
  type Step = "loading" | "breakdown" | "working" | "done" | "error";
  const [step, setStep] = useState<Step>("loading");
  const [preview, setPreview] = useState<CashOutBreakdown | null>(null);
  const [result, setResult] = useState<{ refundableCents: number; needsManualHandlingCents: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // One-shot preview fetch on open. Scoped to `householdId` — the
  // modal unmounts/re-mounts per open so one fetch per lifetime is
  // what we want.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetchCashOutPreviewAction(householdId);
      if (cancelled) return;
      if (!response.ok) {
        setErrorMessage(response.message);
        setStep("error");
        return;
      }
      setPreview(response.data);
      setStep("breakdown");
    })();
    return () => {
      cancelled = true;
    };
  }, [householdId]);

  async function handleConfirm(): Promise<void> {
    setStep("working");
    setErrorMessage(null);
    const response = await executeCashOutAction(householdId);
    if (!response.ok) {
      setErrorMessage(response.message);
      setStep("error");
      return;
    }
    setResult({
      refundableCents: response.data.breakdown.refundableCents,
      needsManualHandlingCents: response.data.needsManualHandlingCents,
    });
    setStep("done");
  }

  function handleClose(): void {
    void (async () => {
      if (step === "done") {
        await onDone();
        return;
      }
      onClose();
    })();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end tablet:items-center justify-center bg-ink/60 p-0 tablet:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cash-out-title"
      data-testid="cash-out-modal"
    >
      <div className="w-full max-w-[480px] bg-background rounded-t-card tablet:rounded-card border border-border p-6 flex flex-col gap-4">
        <h2 id="cash-out-title" className="font-heading text-xl text-heading">
          {step === "done" ? "Refund on the way" : "Refund leftover balance"}
        </h2>

        {step === "loading" && (
          <p className="text-sm text-text-secondary">Loading preview…</p>
        )}

        {step === "error" && (
          <>
            <p role="alert" className="text-sm text-danger">
              {errorMessage ?? "Something went wrong."}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 rounded-full border border-border text-text font-semibold"
              >
                Close
              </button>
            </div>
          </>
        )}

        {step === "breakdown" && preview !== null && (
          <>
            <dl
              data-testid="cash-out-breakdown"
              className="rounded border border-border bg-surface-soft p-3 text-sm text-text flex flex-col gap-1"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <div className="flex justify-between">
                <dt className="text-text-secondary">Paid</dt>
                <dd>{formatDollars(preview.totalCardPaidCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-secondary">Used on lessons</dt>
                <dd>{formatDollars(preview.netLessonSpendingCents)}</dd>
              </div>
              {preview.totalCashRefundedCents > 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-secondary">Previously refunded</dt>
                  <dd>{formatDollars(preview.totalCashRefundedCents)}</dd>
                </div>
              )}
              <div className="border-t border-border my-1" aria-hidden="true" />
              <div className="flex justify-between font-semibold">
                <dt>Refunded to card</dt>
                <dd data-testid="cash-out-refundable">
                  {formatDollars(preview.refundableCents)}
                </dd>
              </div>
              {preview.writeOffCents > 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-secondary">
                    Written off (bonus &amp; gifts)
                  </dt>
                  <dd data-testid="cash-out-writeoff">
                    {formatDollars(preview.writeOffCents)}
                  </dd>
                </div>
              )}
            </dl>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[44px] rounded-full border border-border text-text font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                data-testid="cash-out-confirm"
                disabled={preview.refundableCents === 0 && preview.writeOffCents === 0}
                className="flex-1 min-h-[44px] rounded-full bg-accent text-on-accent font-bold disabled:opacity-60"
              >
                Confirm refund
              </button>
            </div>
          </>
        )}

        {step === "working" && (
          <p className="text-sm text-text-secondary">Refunding…</p>
        )}

        {step === "done" && result !== null && (
          <>
            <p className="text-sm text-text" data-testid="cash-out-done">
              Done.{" "}
              <span
                className="font-semibold"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatDollars(result.refundableCents)}
              </span>{" "}
              on the way to the card.
            </p>
            {result.needsManualHandlingCents > 0 && (
              <p className="text-xs text-text-secondary">
                {formatDollars(result.needsManualHandlingCents)} needs manual
                handling — see the banner above.
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={handleClose}
                data-testid="cash-out-close"
                className="min-h-[44px] px-4 rounded-full bg-accent text-on-accent font-bold"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Mark-cash-refund-handled modal ───────────────────────────────────────

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
      aria-labelledby="mark-handled-title"
      data-testid="mark-handled-modal"
    >
      <div className="w-full max-w-[480px] bg-background rounded-t-card tablet:rounded-card border border-border p-6 flex flex-col gap-4">
        <h2 id="mark-handled-title" className="font-heading text-xl text-heading">
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
            data-testid="mark-handled-note"
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
            data-testid="mark-handled-submit"
            className="flex-1 min-h-[44px] rounded-full bg-accent text-on-accent font-bold disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
