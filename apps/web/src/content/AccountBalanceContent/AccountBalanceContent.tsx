"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { redirectToPolicyUpdated } from "@/lib/policyAcceptanceRedirect";

import type {
  BalanceHistoryEntry,
  BalanceHistoryResponse,
  BalanceResponse,
  LessonDurationMinutes,
  PackageTier,
  SwimmerCount,
} from "@swim-app/shared";
import {
  LESSON_DURATION_MINUTES,
  PACKAGE_TIERS,
  SWIMMER_COUNTS,
  packagePrice,
  priceForLesson,
} from "@swim-app/shared";

import {
  fetchMoreHistoryAction,
  refreshBalanceAction,
  startLessonTopupAction,
  startPackageCheckoutAction,
} from "./actions";
import {
  formatApproxHours,
  formatDollars,
  formatHistoryDate,
  formatSignedDollars,
} from "./formatters";

interface AccountBalanceContentProps {
  balance: BalanceResponse | null;
  initialHistory: BalanceHistoryResponse | null;
  activeSwimmerCount: SwimmerCount;
  topupState: "success" | "cancelled" | null;
  // When the parent landed here via "Buy a package" from the booking
  // insufficient-balance modal, this is the relative path they should
  // return to after a successful checkout. Null when the balance page
  // was opened directly from the account nav.
  resumeBookingReturnTo: string | null;
}

export default function AccountBalanceContent({
  balance,
  initialHistory,
  activeSwimmerCount,
  topupState,
  resumeBookingReturnTo,
}: AccountBalanceContentProps) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[720px] px-4 py-8 tablet:py-12">
        <h1 className="text-text font-heading text-[2.125rem] tablet:text-[2.5rem] leading-tight mb-6">
          Balance
        </h1>

        {topupState ? <TopupResultBanner state={topupState} /> : null}

        {resumeBookingReturnTo ? (
          <div
            role="status"
            aria-live="polite"
            className="mb-6 rounded-card border border-divider-section bg-card text-text-on-section p-4"
          >
            <p className="font-body font-semibold">
              Add credit, then finish your booking.
            </p>
            <p className="font-body text-sm text-text-secondary-on-section mt-1">
              After checkout we&apos;ll bring you back to your pending lesson.
            </p>
          </div>
        ) : null}

        <BalanceCard balance={balance} topupState={topupState} />

        <PackagesSection
          defaultSwimmerCount={activeSwimmerCount}
          successReturnTo={resumeBookingReturnTo ?? "/account/balance"}
        />

        <LessonTopUpSection
          defaultSwimmerCount={activeSwimmerCount}
          successReturnTo={resumeBookingReturnTo ?? "/account/balance"}
        />

        <HistorySection initial={initialHistory} />
      </div>
    </main>
  );
}

// ── Toast / result banner ────────────────────────────────────────────────────

function TopupResultBanner({ state }: { state: "success" | "cancelled" }) {
  if (state === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mb-6 rounded-card border border-divider-section bg-card text-text-on-section p-4"
      >
        <p className="font-body font-semibold">Thanks — your balance is refreshing.</p>
        <p className="font-body text-sm text-text-secondary-on-section mt-1">
          If it doesn&apos;t update in a moment, refresh the page.
        </p>
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 rounded-card border border-border bg-surface-soft text-text p-4"
    >
      <p className="font-body font-semibold">Checkout cancelled.</p>
      <p className="font-body text-sm text-text-secondary mt-1">
        Your balance is unchanged.
      </p>
    </div>
  );
}

// ── Balance card ─────────────────────────────────────────────────────────────

function BalanceCard({
  balance,
  topupState,
}: {
  balance: BalanceResponse | null;
  topupState: "success" | "cancelled" | null;
}) {
  const [current, setCurrent] = useState(balance);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    // Light "balance may take a few seconds to update" polling when the
    // page lands with ?topup=success. Polls every 2s via the server
    // action (which fetches the authoritative balance with the session
    // token on the server side — no browser-visible endpoint). Stops
    // after 5 attempts or as soon as the balance changes from the
    // server-rendered snapshot (whichever is sooner).
    if (topupState !== "success") return;
    settledRef.current = false;
    let attempts = 0;
    const initialCents = balance?.balanceCents ?? 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      try {
        const next = await refreshBalanceAction();
        if (next) {
          setCurrent(next);
          if (next.balanceCents !== initialCents) {
            settledRef.current = true;
          }
        }
      } catch {
        // swallow — the refresh is best-effort
      }
      if ((settledRef.current || attempts >= 5) && pollRef.current) {
        clearInterval(pollRef.current);
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [topupState, balance]);

  const balanceCents = current?.balanceCents ?? 0;
  const approxHours = current?.approximatePrivateHours ?? 0;
  return (
    <section className="rounded-card border border-border bg-background p-6 mb-6 tablet:p-8">
      <p className="font-body text-sm font-semibold uppercase tracking-wide text-text-secondary">
        Lesson credit
      </p>
      <p
        className="font-heading text-[3rem] tablet:text-[3.75rem] leading-none mt-2 text-text"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {formatDollars(balanceCents)}
      </p>
      <p
        className="font-body text-sm text-text-secondary mt-2"
        title="Based on a single swimmer at the private rate ($120/hr). Mixed-sibling lessons can go further."
      >
        {formatApproxHours(approxHours)} of private lessons
      </p>
    </section>
  );
}

// ── Packages section ─────────────────────────────────────────────────────────

const TIER_COPY: Record<PackageTier, { name: string; hours: number; discount: number }> = {
  cannonball: { name: "Cannonball", hours: 10, discount: 10 },
  deep_end: { name: "Deep End", hours: 20, discount: 20 },
};

function PackagesSection({
  defaultSwimmerCount,
  successReturnTo,
}: {
  defaultSwimmerCount: SwimmerCount;
  successReturnTo: string;
}) {
  return (
    <section className="mb-6" aria-labelledby="packages-heading">
      <h2
        id="packages-heading"
        className="font-heading text-[1.5rem] tablet:text-[1.75rem] leading-tight mb-3 text-text"
      >
        Packages
      </h2>
      <p className="font-body text-sm text-text-secondary mb-4">
        Buy credit in bulk. Credit never expires.
      </p>
      <div className="flex flex-col gap-4">
        {PACKAGE_TIERS.map((tier) => (
          <PackageCard
            key={tier}
            tier={tier}
            defaultSwimmerCount={defaultSwimmerCount}
            successReturnTo={successReturnTo}
          />
        ))}
      </div>
    </section>
  );
}

function PackageCard({
  tier,
  defaultSwimmerCount,
  successReturnTo,
}: {
  tier: PackageTier;
  defaultSwimmerCount: SwimmerCount;
  successReturnTo: string;
}) {
  const [selected, setSelected] = useState<SwimmerCount>(defaultSwimmerCount);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const copy = TIER_COPY[tier];
  const { priceCents, creditCents } = packagePrice(tier, selected);
  const hoursLabel = copy.hours === 1 ? "hour" : "hours";

  function handleBuy() {
    setError(null);
    startTransition(async () => {
      const result = await startPackageCheckoutAction(
        tier,
        selected,
        successReturnTo,
      );
      if (result.kind === "redirect") {
        window.location.href = result.url;
        return;
      }
      if (result.kind === "policy_acceptance_required") {
        redirectToPolicyUpdated();
        return;
      }
      setError(result.message);
    });
  }

  return (
    <div className="rounded-card border border-border bg-background p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-heading text-[1.375rem] leading-tight text-text">{copy.name}</h3>
        <span className="font-body text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {copy.hours} {hoursLabel} · {copy.discount}% off
        </span>
      </div>

      <p
        className="font-body text-base text-text mt-3"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        Pay <span className="font-bold">{formatDollars(priceCents)}</span>, get{" "}
        <span className="font-bold">{formatDollars(creditCents)}</span> of lesson credit.
      </p>

      <div className="mt-4">
        <p className="font-body text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
          Swimmer count
        </p>
        <div className="flex gap-2" role="radiogroup" aria-label={`Swimmer count for ${copy.name}`}>
          {SWIMMER_COUNTS.map((count) => {
            const isSelected = count === selected;
            const isDefault = count === defaultSwimmerCount;
            return (
              <button
                key={count}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelected(count)}
                className={`flex-1 min-h-[44px] rounded-full font-body font-semibold text-sm ${
                  isSelected
                    ? "bg-accent text-on-accent"
                    : "border border-border text-text hover:bg-surface-soft"
                }`}
              >
                {count}
                {isDefault && !isSelected ? (
                  <span className="sr-only"> (your household)</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {selected === defaultSwimmerCount ? (
          <p className="font-body text-xs text-text-secondary mt-2">
            Matches your household&apos;s swimmer count.
          </p>
        ) : null}
      </div>

      <p className="font-body text-xs text-text-secondary mt-5 mb-2 text-center">
        Payments and refunds are covered by our{" "}
        <a href="/refund-policy" className="text-link underline hover:text-link-hover">
          Payments &amp; Refund Policy
        </a>
        .
      </p>
      <button
        type="button"
        onClick={handleBuy}
        disabled={pending}
        className="w-full min-h-[52px] rounded-full bg-accent text-on-accent font-body font-bold text-base disabled:opacity-60"
      >
        {pending ? "Starting checkout…" : `Buy ${copy.name}`}
      </button>
      {error ? (
        <p role="alert" className="font-body text-sm text-danger mt-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── Lesson top-up form ───────────────────────────────────────────────────────

function LessonTopUpSection({
  defaultSwimmerCount,
  successReturnTo,
}: {
  defaultSwimmerCount: SwimmerCount;
  successReturnTo: string;
}) {
  const [duration, setDuration] = useState<LessonDurationMinutes>(30);
  const [swimmerCount, setSwimmerCount] = useState<SwimmerCount>(defaultSwimmerCount);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const price = priceForLesson(duration, swimmerCount);

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      const result = await startLessonTopupAction(
        duration,
        swimmerCount,
        successReturnTo,
      );
      if (result.kind === "redirect") {
        window.location.href = result.url;
        return;
      }
      if (result.kind === "policy_acceptance_required") {
        redirectToPolicyUpdated();
        return;
      }
      setError(result.message);
    });
  }

  return (
    <section className="mb-6" aria-labelledby="topup-heading">
      <h2
        id="topup-heading"
        className="font-heading text-[1.5rem] tablet:text-[1.75rem] leading-tight mb-3 text-text"
      >
        Add credit for one lesson
      </h2>
      <div className="rounded-card border border-border bg-background p-5">
        <div className="flex flex-col gap-4">
          <div>
            <p className="font-body text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
              Length
            </p>
            <div className="flex gap-2" role="radiogroup" aria-label="Lesson length">
              {LESSON_DURATION_MINUTES.map((minutes) => {
                const isSelected = minutes === duration;
                return (
                  <button
                    key={minutes}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setDuration(minutes)}
                    className={`flex-1 min-h-[44px] rounded-full font-body font-semibold text-sm ${
                      isSelected
                        ? "bg-accent text-on-accent"
                        : "border border-border text-text hover:bg-surface-soft"
                    }`}
                  >
                    {minutes} min
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="font-body text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
              Swimmers
            </p>
            <div className="flex gap-2" role="radiogroup" aria-label="Swimmer count">
              {SWIMMER_COUNTS.map((count) => {
                const isSelected = count === swimmerCount;
                return (
                  <button
                    key={count}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSwimmerCount(count)}
                    className={`flex-1 min-h-[44px] rounded-full font-body font-semibold text-sm ${
                      isSelected
                        ? "bg-accent text-on-accent"
                        : "border border-border text-text hover:bg-surface-soft"
                    }`}
                  >
                    {count}
                  </button>
                );
              })}
            </div>
          </div>

          <p
            className="font-body text-base text-text"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            One {duration}-min lesson for {swimmerCount} {swimmerCount === 1 ? "swimmer" : "swimmers"}:{" "}
            <span className="font-bold">{formatDollars(price)}</span>
          </p>

          <p className="font-body text-xs text-text-secondary text-center">
            Payments and refunds are covered by our{" "}
            <a href="/refund-policy" className="text-link underline hover:text-link-hover">
              Payments &amp; Refund Policy
            </a>
            .
          </p>
          <button
            type="button"
            onClick={handleAdd}
            disabled={pending}
            className="w-full min-h-[52px] rounded-full bg-accent text-on-accent font-body font-bold text-base disabled:opacity-60"
          >
            {pending ? "Starting checkout…" : `Add ${formatDollars(price)} of credit`}
          </button>
          {error ? (
            <p role="alert" className="font-body text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ── History section ──────────────────────────────────────────────────────────

function HistorySection({ initial }: { initial: BalanceHistoryResponse | null }) {
  const [entries, setEntries] = useState<BalanceHistoryEntry[]>(initial?.entries ?? []);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleLoadMore() {
    if (!cursor) return;
    setError(null);
    startTransition(async () => {
      const result = await fetchMoreHistoryAction(cursor);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setEntries((prev) => [...prev, ...result.data.entries]);
      setCursor(result.data.nextCursor);
    });
  }

  return (
    <section aria-labelledby="history-heading">
      <h2
        id="history-heading"
        className="font-heading text-[1.5rem] tablet:text-[1.75rem] leading-tight mb-3 text-text"
      >
        History
      </h2>
      {entries.length === 0 ? (
        <p className="font-body text-sm text-text-secondary">
          Nothing yet. Add credit above to get started.
        </p>
      ) : (
        <ul className="rounded-card border border-border bg-background divide-y divide-border">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-4 px-4 py-3 min-h-[56px]"
            >
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm font-semibold text-text truncate">
                  {entry.displayType}
                </p>
                <p className="font-body text-xs text-text-secondary">
                  {formatHistoryDate(entry.createdAt)}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={`font-body text-sm font-bold ${
                    entry.amountCents > 0
                      ? "text-success"
                      : entry.amountCents < 0
                        ? "text-text"
                        : "text-text-secondary"
                  }`}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatSignedDollars(entry.amountCents)}
                </p>
                <p
                  className="font-body text-xs text-text-secondary"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatDollars(entry.runningBalanceCents)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={pending}
          className="mt-4 w-full min-h-[44px] rounded-full border-2 border-button-outline text-button-outline font-body font-bold text-sm disabled:opacity-60"
        >
          {pending ? "Loading…" : "Load more"}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="font-body text-sm text-danger mt-2">
          {error}
        </p>
      ) : null}
    </section>
  );
}
