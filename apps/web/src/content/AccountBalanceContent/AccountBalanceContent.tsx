"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { redirectToPolicyUpdated } from "@/lib/policyAcceptanceRedirect";

import type {
  BalanceHistoryResponse,
  BalanceResponse,
  LessonDurationMinutes,
  PackageTier,
  SwimmerCount,
} from "@swim-app/shared";
import {
  LESSON_DURATION_MINUTES,
  LESSON_TOPUP_MAX_QUANTITY,
  LESSON_TOPUP_MIN_QUANTITY,
  PACKAGE_TIERS,
  SWIMMER_COUNTS,
  packagePrice,
  priceForLesson,
} from "@swim-app/shared";

import {
  refreshBalanceAction,
  startLessonTopupAction,
  startPackageCheckoutAction,
} from "./actions";
import {
  formatApproxHours,
  formatDollars,
} from "./formatters";
import { HistoryRow } from "./HistoryRow";
import styles from "./AccountBalanceContent.module.css";
import { useCountUp } from "./useCountUp";

// 5-row preview + "View all transactions" link; the /account/balance/history
// page (ADR 036 Phase 8 Part B Stop 3 piece 7) handles pagination.
const HISTORY_PREVIEW_LIMIT = 5;

// Price of the cheapest private lesson (30 min × 1 swimmer). Balances
// below this threshold can't book anything, so the balance card drops
// the hours line in favor of an actionable sentence.
const MIN_LESSON_PRICE_CENTS = 6000;

// Shared button press feedback: 160ms transform scale(0.97) with the
// strong ease-out curve. Honors reduced motion via motion-reduce.
const PRESS_BUTTON_CLASS =
  "transition-[transform,opacity] duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] motion-reduce:transform-none";

const PACKAGE_COPY: Record<PackageTier, { name: string; hours: number; discount: number }> = {
  cannonball: { name: "Cannonball", hours: 10, discount: 10 },
  deep_end: { name: "Deep End", hours: 20, discount: 20 },
};

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
  const successReturnTo = resumeBookingReturnTo ?? "/account/balance";
  return (
    <main className={`${styles.base} min-h-screen bg-background`}>
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

        <BuyLessonsSection
          defaultSwimmerCount={activeSwimmerCount}
          successReturnTo={successReturnTo}
        />

        <PackagesSection
          defaultSwimmerCount={activeSwimmerCount}
          successReturnTo={successReturnTo}
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
    // Post-topup polling: /account/balance?topup=success → re-fetch
    // the authoritative balance every 2s for up to 10s. Stops as soon
    // as the server-rendered balance has moved from the snapshot that
    // landed with the page. Server action keeps the session token
    // off the browser.
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

  const targetCents = current?.balanceCents ?? 0;
  // Count-up animates from the previously-displayed value to the new
  // target. Mount counts from 0; a mid-session top-up counts from the
  // old balance to the new one. useCountUp jumps straight to target
  // under prefers-reduced-motion.
  const balanceCents = useCountUp(targetCents, 900);
  const approxHours = current?.approximatePrivateHours ?? 0;
  // Threshold copy: below the cheapest private lesson there's no
  // honest "hours of private lessons" to quote. Floor-rounding is
  // handled by the API's approximatePrivateHours; the UI simply
  // swaps the line below $60.
  const showHoursLine = targetCents >= MIN_LESSON_PRICE_CENTS;

  return (
    <section className="rounded-card border-2 border-border bg-surface-soft p-6 tablet:p-8 mb-6 relative overflow-hidden">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="font-body text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Lesson credit · pass
          </p>
          <p
            className="font-heading text-[2.5rem] tablet:text-[3.25rem] leading-none mt-2 text-heading"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatDollars(balanceCents)}
          </p>
          {showHoursLine ? (
            <p
              className="font-body text-sm text-text-secondary mt-1"
              title="Based on a single swimmer at the private rate ($120/hr). Mixed-sibling lessons can go further."
              data-testid="balance-hours-line"
            >
              {formatApproxHours(approxHours)} of private lessons
            </p>
          ) : (
            <p
              className="font-body text-sm text-text-secondary mt-1"
              data-testid="balance-not-enough"
            >
              Not quite enough for a 30-minute lesson
            </p>
          )}
        </div>
        <div
          aria-hidden="true"
          className="font-heading text-[2rem] text-accent leading-none opacity-70"
        >
          ✦
        </div>
      </div>
    </section>
  );
}

// ── Buy single lessons ───────────────────────────────────────────────────────

function BuyLessonsSection({
  defaultSwimmerCount,
  successReturnTo,
}: {
  defaultSwimmerCount: SwimmerCount;
  successReturnTo: string;
}) {
  const [duration, setDuration] = useState<LessonDurationMinutes>(30);
  const [swimmerCount, setSwimmerCount] = useState<SwimmerCount>(defaultSwimmerCount);
  const [quantity, setQuantity] = useState<number>(1);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const perLessonCents = priceForLesson(duration, swimmerCount);
  const totalCents = perLessonCents * quantity;
  const totalHours = (duration * quantity) / 60;

  const nudgeTier: PackageTier | null =
    totalHours >= 20 ? "deep_end" : totalHours >= 10 ? "cannonball" : null;
  const nudge = nudgeTier
    ? (() => {
        const { priceCents, creditCents } = packagePrice(nudgeTier, swimmerCount);
        return {
          tier: nudgeTier,
          name: PACKAGE_COPY[nudgeTier].name,
          thresholdHours: PACKAGE_COPY[nudgeTier].hours,
          priceCents,
          creditCents,
        };
      })()
    : null;

  function handleQuantityChange(next: number) {
    if (!Number.isFinite(next)) return;
    const clamped = Math.min(
      LESSON_TOPUP_MAX_QUANTITY,
      Math.max(LESSON_TOPUP_MIN_QUANTITY, Math.round(next)),
    );
    setQuantity(clamped);
  }

  function handleBuy() {
    setError(null);
    startTransition(async () => {
      const result = await startLessonTopupAction(
        duration,
        swimmerCount,
        quantity,
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
    <section className="mb-6" aria-labelledby="buy-lessons-heading">
      <h2
        id="buy-lessons-heading"
        className="font-heading text-[1.5rem] tablet:text-[1.75rem] leading-tight mb-3 text-heading"
      >
        Enter a heat
      </h2>
      <div className="rounded-card border border-border bg-background p-5 tablet:p-6 flex flex-col gap-5">
        <SegmentPills
          label="Length"
          ariaLabel="Lesson length"
          options={LESSON_DURATION_MINUTES.map((minutes) => ({
            value: minutes,
            label: `${minutes} min`,
          }))}
          selected={duration}
          onChange={setDuration}
        />
        <SegmentPills
          label="Swimmers"
          ariaLabel="Swimmer count"
          options={SWIMMER_COUNTS.map((count) => ({ value: count, label: String(count) }))}
          selected={swimmerCount}
          onChange={setSwimmerCount}
        />

        <div>
          <label
            htmlFor="buy-lessons-quantity"
            className="font-body text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2 block"
          >
            Lessons · {quantity} of {LESSON_TOPUP_MAX_QUANTITY}
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => handleQuantityChange(quantity - 1)}
              disabled={quantity <= LESSON_TOPUP_MIN_QUANTITY}
              className={`min-h-[44px] min-w-[44px] rounded-full border border-border text-text font-body font-bold text-lg disabled:opacity-40 ${PRESS_BUTTON_CLASS}`}
            >
              −
            </button>
            <input
              id="buy-lessons-quantity"
              data-testid="buy-lessons-quantity"
              type="number"
              inputMode="numeric"
              min={LESSON_TOPUP_MIN_QUANTITY}
              max={LESSON_TOPUP_MAX_QUANTITY}
              value={quantity}
              onChange={(event) => handleQuantityChange(Number(event.target.value))}
              className="flex-1 min-w-0 min-h-[44px] rounded-button border border-border bg-background text-text font-body font-semibold text-base text-center focus:outline-none focus:ring-2 focus:ring-focus-ring"
              style={{ fontVariantNumeric: "tabular-nums" }}
            />
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => handleQuantityChange(quantity + 1)}
              disabled={quantity >= LESSON_TOPUP_MAX_QUANTITY}
              className={`min-h-[44px] min-w-[44px] rounded-full border border-border text-text font-body font-bold text-lg disabled:opacity-40 ${PRESS_BUTTON_CLASS}`}
            >
              +
            </button>
          </div>
        </div>

        {/* Summary line + big Total block. The summary is the plain
            narrative ("6 × 60-minute lessons for 2 swimmers"), the
            Total is the number that drives the Pay button. Both update
            when any pill or the quantity moves — the dollar figure is
            keyed so the valuePulse re-fires on each change. */}
        <div className="flex items-baseline justify-between gap-4 border-t border-border pt-4">
          <div className="min-w-0 flex-1">
            <p
              className="font-body text-xs font-semibold uppercase tracking-wide text-text-secondary"
            >
              Total
            </p>
            <p
              className="font-body text-sm text-text mt-1 leading-snug"
              data-testid="buy-lessons-total"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {quantity} × {duration}-minute {quantity === 1 ? "lesson" : "lessons"} for{" "}
              {swimmerCount} {swimmerCount === 1 ? "swimmer" : "swimmers"}
            </p>
          </div>
          <p
            className="font-heading text-[2rem] leading-none text-heading shrink-0"
            style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.01em" }}
          >
            <span key={totalCents} className={styles.valuePulse}>
              {formatDollars(totalCents)}
            </span>
          </p>
        </div>

        {nudge !== null ? (
          <div
            key={nudge.tier}
            role="status"
            data-testid="buy-lessons-package-nudge"
            className={`${styles.nudgeEnter} rounded-card border border-accent/40 bg-surface-soft p-4`}
          >
            <p
              className="font-body text-sm text-text leading-snug"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              Buying {nudge.thresholdHours}+ hours?{" "}
              <span className="font-bold text-text">{nudge.name}</span> gets you{" "}
              <span className="font-bold text-text">{formatDollars(nudge.creditCents)}</span> of credit for{" "}
              <span className="font-bold text-accent">{formatDollars(nudge.priceCents)}</span>.
            </p>
          </div>
        ) : null}

        <RefundPolicyLine />

        <button
          type="button"
          onClick={handleBuy}
          disabled={pending}
          data-testid="buy-lessons-submit"
          className={`w-full min-h-[52px] rounded-full bg-button-primary-background text-button-primary-text font-body font-bold text-base tracking-wide disabled:opacity-60 ${PRESS_BUTTON_CLASS}`}
        >
          {pending ? "Starting checkout…" : `Take your mark · ${formatDollars(totalCents)}`}
        </button>

        {error ? (
          <p role="alert" className="font-body text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

// ── Packages section ─────────────────────────────────────────────────────────

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
        className="font-heading text-[1.5rem] tablet:text-[1.75rem] leading-tight mb-3 text-heading"
      >
        Premium passes
      </h2>
      <p className="font-body text-sm text-text-secondary mb-4">
        Buy credit in bulk. Credit never expires.
      </p>
      <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4">
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
  const copy = PACKAGE_COPY[tier];
  const { priceCents, creditCents } = packagePrice(tier, selected);

  function handleBuy() {
    setError(null);
    startTransition(async () => {
      const result = await startPackageCheckoutAction(tier, selected, successReturnTo);
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
    <div className="rounded-card bg-section text-text-on-section border border-divider-section p-5 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-[1.5rem] leading-tight text-text-on-section">
          {copy.name}
        </h3>
        <span className="font-body text-[10px] font-bold uppercase tracking-[0.2em] text-accent-on-section">
          {copy.discount}% off
        </span>
      </div>
      <p
        className="font-body text-xs uppercase tracking-[0.15em] text-text-secondary-on-section"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {copy.hours} hours
      </p>

      <OnSectionPills
        label="Swimmers"
        ariaLabel={`Swimmer count for ${copy.name}`}
        options={SWIMMER_COUNTS.map((count) => ({ value: count, label: String(count) }))}
        selected={selected}
        onChange={setSelected}
      />

      <div
        className="flex items-baseline gap-2 flex-wrap"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        <span
          key={`price-${priceCents}`}
          className={`${styles.valuePulse} font-heading text-[1.875rem] leading-none text-text-on-section`}
        >
          {formatDollars(priceCents)}
        </span>
        <span
          key={`credit-${creditCents}`}
          className={`${styles.valuePulse} font-body text-xs text-text-secondary-on-section`}
        >
          → {formatDollars(creditCents)}
        </span>
      </div>

      <p className="font-body text-[11px] text-text-secondary-on-section">
        Payments and refunds are covered by our{" "}
        <a href="/refund-policy" className="text-accent-on-section underline">
          Payments &amp; Refund Policy
        </a>
        .
      </p>

      <button
        type="button"
        onClick={handleBuy}
        disabled={pending}
        className={`mt-auto w-full min-h-[44px] rounded-full bg-accent-on-section text-on-accent font-body font-bold text-sm tracking-wide disabled:opacity-60 ${PRESS_BUTTON_CLASS}`}
      >
        {pending ? "Starting checkout…" : `Buy ${copy.name}`}
      </button>

      {error ? (
        <p role="alert" className="font-body text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ── History section (preview) ────────────────────────────────────────────────

// ADR 036 Phase 8 Part B Stop 3 piece 7: the balance page shows at most
// 5 rows; anything more lives on the dedicated /account/balance/history
// page. "View all transactions" appears whenever the household has more
// than 5 entries — the first fetched page overflowed the cap, or the
// first page carries a non-null nextCursor (API page size is 20, so the
// cap is always hit before the cursor runs out).
function HistorySection({ initial }: { initial: BalanceHistoryResponse | null }) {
  const entries = initial?.entries ?? [];
  const preview = entries.slice(0, HISTORY_PREVIEW_LIMIT);
  const hasMore = entries.length > HISTORY_PREVIEW_LIMIT || (initial?.nextCursor ?? null) !== null;

  return (
    <section aria-labelledby="history-heading">
      <h2
        id="history-heading"
        className="font-heading text-[1.5rem] tablet:text-[1.75rem] leading-tight mb-3 text-heading"
      >
        Recent activity
      </h2>
      {preview.length === 0 ? (
        <p className="font-body text-sm text-text-secondary">
          Nothing yet. Add credit above to get started.
        </p>
      ) : (
        <ul className="rounded-card border border-border bg-background divide-y divide-border">
          {preview.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      {hasMore ? (
        <Link
          href="/account/balance/history"
          data-testid="view-all-transactions"
          className="mt-4 inline-flex items-center justify-center w-full min-h-[44px] rounded-full border-2 border-button-outline text-button-outline font-body font-bold text-sm transition-opacity hover:opacity-80"
        >
          View all transactions
        </Link>
      ) : null}
    </section>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function SegmentPills<T extends number>({
  label,
  ariaLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="font-body text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
        {label}
      </p>
      <div className="flex gap-2" role="radiogroup" aria-label={ariaLabel}>
        {options.map((option) => {
          const isSelected = option.value === selected;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(option.value)}
              className={`flex-1 min-h-[44px] rounded-full font-body font-semibold text-sm ${PRESS_BUTTON_CLASS} ${
                isSelected
                  ? "bg-accent text-on-accent"
                  : "border border-border text-text hover:bg-surface-soft"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Dark-surface variant for the package cards' swimmer picker. Flips to
// on-section tokens so the pills stay legible on the dark panel.
function OnSectionPills<T extends number>({
  label,
  ariaLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="font-body text-[11px] font-semibold uppercase tracking-[0.15em] text-text-secondary-on-section mb-2">
        {label}
      </p>
      <div role="radiogroup" aria-label={ariaLabel} className="flex gap-2">
        {options.map((option) => {
          const isSelected = option.value === selected;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(option.value)}
              className={`flex-1 min-h-[44px] rounded-full font-body font-bold text-sm border ${PRESS_BUTTON_CLASS} ${
                isSelected
                  ? "bg-accent-on-section text-on-accent border-accent-on-section"
                  : "bg-transparent text-text-on-section border-divider-section"
              }`}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RefundPolicyLine() {
  return (
    <p className="font-body text-xs text-text-secondary text-center">
      Payments and refunds are covered by our{" "}
      <a href="/refund-policy" className="text-link underline hover:text-link-hover">
        Payments &amp; Refund Policy
      </a>
      .
    </p>
  );
}
