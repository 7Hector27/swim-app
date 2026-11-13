"use client";

import { useTransition } from "react";

import { redirectToPolicyUpdated } from "@/lib/policyAcceptanceRedirect";
import { startBookingShortfallTopupAction } from "@/content/AccountBalanceContent/actions";
import { formatDollars } from "@/lib/formatDollars";
import type {
  BatchPatternPair,
  LessonDurationMinutes,
  SwimmerCount,
} from "@swim-app/shared";

type Duration = 30 | 45 | 60;

// Backwards-compatible single-attempt shape. Still used by the modal's
// `attempt` prop and by the single-mode "Finish your booking" resume
// banner — the stash itself now carries the broader mode-aware payload
// below, and this type maps 1:1 onto PendingSingleBooking (minus mode
// and stashedAt).
export interface PendingBooking {
  startsAt: string;
  durationMinutes: Duration;
  locationId: string;
  swimmerIds: string[];
}

// Full booking-mode-aware stash. Written before every Stripe redirect so
// the resume banner (single) or the calendar's resume effect (batch) can
// rehydrate the parent back into the picks they had queued up, from
// whichever path they took — "exact shortfall" top-up or "Buy a package."
export type PendingBookingState =
  | ({
      mode: "single";
      stashedAt: string;
    } & PendingBooking)
  | {
      mode: "multiple";
      stashedAt: string;
      locationId: string;
      picks: Array<{
        startsAt: string;
        durationMinutes: Duration;
        swimmerIds: string[];
      }>;
    }
  | {
      mode: "recurring";
      stashedAt: string;
      locationId: string;
      pattern: BatchPatternPair[];
      startDate: string;
      weeks: number;
    };

// sessionStorage key — read by the resume banner on /book?resume=1.
const PENDING_KEY = "axiom:pending-booking";
// Stash expires one hour after it was written so a parent who abandoned
// a Stripe redirect yesterday doesn't get yanked back into stale picks.
const PENDING_TTL_MS = 60 * 60 * 1000;

function isDuration(value: unknown): value is Duration {
  return value === 30 || value === 45 || value === 60;
}

function isLessonDuration(value: unknown): value is LessonDurationMinutes {
  return value === 30 || value === 45 || value === 60;
}

// Narrow sessionStorage payload → typed PendingBookingState. Returns
// null for malformed, missing, or expired data. The discriminator is
// the top-level `mode`; old payloads without a `mode` field are read
// as single-mode for backwards compatibility.
function parsePendingBooking(raw: string): PendingBookingState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;

  // TTL check (missing stashedAt → treat as fresh for legacy payloads
  // written before the TTL field was added).
  if (typeof record.stashedAt === "string") {
    const stashedMs = Date.parse(record.stashedAt);
    if (!Number.isFinite(stashedMs)) return null;
    if (Date.now() - stashedMs > PENDING_TTL_MS) return null;
  }
  const stashedAt =
    typeof record.stashedAt === "string"
      ? record.stashedAt
      : new Date().toISOString();

  const mode = record.mode;

  if (mode === "multiple") {
    if (typeof record.locationId !== "string") return null;
    if (!Array.isArray(record.picks)) return null;
    const picks: Array<{
      startsAt: string;
      durationMinutes: Duration;
      swimmerIds: string[];
    }> = [];
    for (const raw of record.picks) {
      if (typeof raw !== "object" || raw === null) return null;
      const pick = raw as Record<string, unknown>;
      if (typeof pick.startsAt !== "string") return null;
      if (!isDuration(pick.durationMinutes)) return null;
      if (!Array.isArray(pick.swimmerIds)) return null;
      const ids = pick.swimmerIds.filter((id): id is string => typeof id === "string");
      if (ids.length === 0) return null;
      picks.push({
        startsAt: pick.startsAt,
        durationMinutes: pick.durationMinutes,
        swimmerIds: ids,
      });
    }
    if (picks.length === 0) return null;
    return {
      mode: "multiple",
      stashedAt,
      locationId: record.locationId,
      picks,
    };
  }

  if (mode === "recurring") {
    if (typeof record.locationId !== "string") return null;
    if (typeof record.startDate !== "string") return null;
    if (typeof record.weeks !== "number" || !Number.isFinite(record.weeks)) {
      return null;
    }
    if (!Array.isArray(record.pattern)) return null;
    const pattern: BatchPatternPair[] = [];
    for (const raw of record.pattern) {
      if (typeof raw !== "object" || raw === null) return null;
      const pair = raw as Record<string, unknown>;
      if (typeof pair.weekday !== "number" || pair.weekday < 1 || pair.weekday > 7) {
        return null;
      }
      if (typeof pair.timeOfDay !== "string") return null;
      if (!isLessonDuration(pair.durationMinutes)) return null;
      if (!Array.isArray(pair.swimmerIds)) return null;
      const ids = pair.swimmerIds.filter((id): id is string => typeof id === "string");
      if (ids.length === 0) return null;
      pattern.push({
        weekday: pair.weekday,
        timeOfDay: pair.timeOfDay,
        durationMinutes: pair.durationMinutes,
        swimmerIds: ids,
      });
    }
    if (pattern.length === 0) return null;
    return {
      mode: "recurring",
      stashedAt,
      locationId: record.locationId,
      pattern,
      startDate: record.startDate,
      weeks: record.weeks,
    };
  }

  // Default + explicit "single". Legacy payloads (no `mode` field) ride
  // this branch too — they only ever carried a single-lesson shape.
  if (typeof record.startsAt !== "string") return null;
  if (!isDuration(record.durationMinutes)) return null;
  if (typeof record.locationId !== "string") return null;
  if (!Array.isArray(record.swimmerIds)) return null;
  return {
    mode: "single",
    stashedAt,
    startsAt: record.startsAt,
    durationMinutes: record.durationMinutes,
    locationId: record.locationId,
    swimmerIds: record.swimmerIds.filter((id): id is string => typeof id === "string"),
  };
}

// Overload: callers may pass the legacy single-lesson shape (no mode /
// stashedAt) and have it stored as mode="single"; batch callers pass the
// full union variant directly.
export function stashPendingBooking(
  payload: PendingBooking | PendingBookingState,
): void {
  const stashedAt = new Date().toISOString();
  const withMeta: PendingBookingState =
    "mode" in payload
      ? { ...payload, stashedAt }
      : { mode: "single", stashedAt, ...payload };
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(withMeta));
  } catch {
    // Private mode / quota — the resume path silently no-ops.
  }
}

export function readPendingBooking(): PendingBookingState | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (raw === null) return null;
    const parsed = parsePendingBooking(raw);
    if (parsed === null) {
      // Malformed or expired — drop the stale entry so future reads
      // don't keep paying the parse cost.
      window.sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingBooking(): void {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

interface InsufficientBalanceModalProps {
  open: boolean;
  balanceCents: number;
  priceCents: number;
  shortfallCents: number;
  attempt: PendingBooking;
  onClose: () => void;
}

export default function InsufficientBalanceModal({
  open,
  balanceCents,
  priceCents,
  shortfallCents,
  attempt,
  onClose,
}: InsufficientBalanceModalProps) {
  const [pending, startTransition] = useTransition();

  if (!open) return null;

  function handleAddCredit() {
    // Store the attempt so /book?resume=1 can rehydrate it after the
    // parent returns from Stripe. successReturnTo lands them back here
    // with ?topup=success plus the resume marker.
    stashPendingBooking(attempt);
    const swimmerCount = Math.max(1, Math.min(4, attempt.swimmerIds.length)) as SwimmerCount;
    startTransition(async () => {
      const result = await startBookingShortfallTopupAction(
        attempt.durationMinutes,
        swimmerCount,
        "/dashboard/book?resume=1",
      );
      if (result.kind === "redirect") {
        window.location.href = result.url;
        return;
      }
      if (result.kind === "policy_acceptance_required") {
        redirectToPolicyUpdated();
        return;
      }
      // Fallback: couldn't start checkout — leave the modal open with
      // an error message visible to the parent.
      onClose();
      alert(result.message);
    });
  }

  function handleBuyPackage() {
    stashPendingBooking(attempt);
    window.location.href = "/account/balance?resume=book";
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end tablet:items-center justify-center bg-ink/60 p-0 tablet:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="insufficient-balance-title"
    >
      <div className="w-full max-w-[480px] bg-background rounded-t-card tablet:rounded-card border border-border p-6">
        <h2
          id="insufficient-balance-title"
          className="font-heading text-[1.5rem] leading-tight text-text"
        >
          Not enough balance
        </h2>
        <p
          className="font-body text-base text-text mt-3"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          This lesson costs <span className="font-bold">{formatDollars(priceCents)}</span>.
          Your balance is <span className="font-bold">{formatDollars(balanceCents)}</span>.
        </p>
        <p className="font-body text-sm text-text-secondary mt-2">
          Credit never expires — anything extra stays on your balance.
        </p>

        <p className="font-body text-xs text-text-secondary mt-6 text-center">
          Payments and refunds are covered by our{" "}
          <a href="/refund-policy" className="text-link underline hover:text-link-hover">
            Payments &amp; Refund Policy
          </a>
          .
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <button
            type="button"
            onClick={handleAddCredit}
            disabled={pending}
            className="w-full min-h-[52px] rounded-full bg-accent text-on-accent font-body font-bold text-base disabled:opacity-60"
          >
            {pending
              ? "Starting checkout…"
              : `Add ${formatDollars(priceCents)} of credit`}
          </button>
          <button
            type="button"
            onClick={handleBuyPackage}
            className="w-full min-h-[52px] rounded-full border-2 border-button-outline text-button-outline font-body font-bold text-base"
          >
            Buy a package
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] font-body text-sm text-text-secondary"
          >
            Not now
          </button>
        </div>

        <p
          className="font-body text-xs text-text-secondary mt-4"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          You&apos;d only need {formatDollars(shortfallCents)} more — adding a lesson&apos;s
          worth of credit covers it with the rest staying on your balance.
        </p>
      </div>
    </div>
  );
}
