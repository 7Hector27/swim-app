"use client";

import PendingLabel from "@/components/PendingLabel";
import { lessonPrice } from "@/lib/pricing";
import { formatDollars } from "@/lib/formatDollars";

interface Swimmer {
  id: string;
  firstName: string;
}

interface Props {
  selectedStartsAt: string | null;
  tooSoon: boolean;
  durationMinutes: 30 | 45 | 60;
  swimmerIds: string[];
  // All household swimmers, used to resolve first names for the mobile
  // summary ("Lily & Timmy"). Falls back to "N swimmer(s)" when the list
  // isn't supplied (older callers) or a name can't be resolved.
  swimmers?: readonly Swimmer[];
  needsApproval: boolean;
  bookingMinAdvanceHours: number | null;
  // Household balance in cents, authoritative server value. `null` when
  // the server fetch failed — the bar hides the balance line rather than
  // guessing.
  balanceCents?: number | null;
  // Server-pricing total for the current selection in cents. Zero when
  // the parent hasn't picked a swimmer or slot yet.
  totalPriceCents?: number;
  onConfirm: () => void;
  isConfirming: boolean;
  // ADR 036 Phase 8 Part B Stop 3 piece 4: inline "Add funds" link on
  // the balance line. When provided, clicking it stashes the parent's
  // current picks (via the caller-owned helper) and sends them to
  // /account/balance so they can come back to the same picks after
  // paying. Omit the prop to hide the link.
  onAddFunds?: () => void;
}

const LA_TZ = "America/Los_Angeles";

// "Fri, Nov 21" — compact date header for the mobile summary. Keeping it
// short-weekday / short-month so the line never risks wrapping under the
// price on a narrow phone.
function formatDateOnly(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

// "10:45 to 11:15 AM · 30 min" — drops the start-side meridiem when both
// ends share one so the line reads as a single range, not two timestamps.
function formatTimeRangeAndLength(iso: string, durationMinutes: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const fmt = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: LA_TZ,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  const startStr = fmt(start);
  const endStr = fmt(end);
  const startMeridiem = startStr.slice(-2);
  const endMeridiem = endStr.slice(-2);
  const range =
    startMeridiem === endMeridiem
      ? `${startStr.slice(0, -3)} to ${endStr}`
      : `${startStr} to ${endStr}`;
  return `${range} \u00b7 ${durationMinutes} min`;
}

// "Lily", "Lily & Timmy", "Lily, Timmy & Jack" — Oxford-style conjunction
// on three+ so the line reads naturally. Returns null when we can't build
// a name list (no swimmer ids given); the caller swaps in the fallback.
function joinFirstNames(
  swimmerIds: string[],
  swimmers: readonly Swimmer[] | undefined,
): string | null {
  if (swimmers === undefined || swimmerIds.length === 0) return null;
  const byId = new Map(swimmers.map((swimmer) => [swimmer.id, swimmer.firstName]));
  const names = swimmerIds
    .map((id) => byId.get(id))
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  const head = names.slice(0, -1).join(", ");
  const tail = names[names.length - 1]!;
  return `${head} & ${tail}`;
}

export default function BottomBar({
  selectedStartsAt,
  tooSoon,
  durationMinutes,
  swimmerIds,
  swimmers,
  needsApproval,
  bookingMinAdvanceHours,
  balanceCents = null,
  totalPriceCents = 0,
  onConfirm,
  isConfirming,
  onAddFunds,
}: Props) {
  const hasSelection = selectedStartsAt !== null;
  const hasSwimmers = swimmerIds.length > 0;
  const confirmEnabled = hasSelection && !tooSoon && !isConfirming;
  // No number echoed on the current response → drop the hour count from
  // the label rather than falling back to a stale default.
  const tooSoonLabel =
    bookingMinAdvanceHours === null
      ? "Too close to the lesson"
      : `Less than ${bookingMinAdvanceHours} ${bookingMinAdvanceHours === 1 ? "hour" : "hours"} away`;

  const dateLabel = hasSelection && !tooSoon ? formatDateOnly(selectedStartsAt) : null;
  const timeRangeLabel =
    hasSelection && !tooSoon ? formatTimeRangeAndLength(selectedStartsAt, durationMinutes) : null;
  const firstNamesLabel = joinFirstNames(swimmerIds, swimmers);
  const swimmerCountFallback = hasSwimmers
    ? `${swimmerIds.length} swimmer${swimmerIds.length === 1 ? "" : "s"}`
    : null;
  const swimmerLabel = firstNamesLabel ?? swimmerCountFallback;
  const priceLabel =
    hasSelection && !tooSoon && hasSwimmers
      ? `$${lessonPrice(durationMinutes, swimmerIds.length)}`
      : null;

  // Soft hint shown next to the Confirm button. When no swimmer is picked
  // the button stays enabled; clicking scrolls to Who's swimming instead.
  const reason: string | null = (() => {
    if (isConfirming) return null;
    if (!hasSelection) return "Pick a time first.";
    if (tooSoon) return `${tooSoonLabel}.`;
    if (!hasSwimmers) return "Pick who's swimming first.";
    return null;
  })();

  // Pre-submit shortfall guard. When balance is known and the current
  // selection already exceeds it, show the "short by" line; the server
  // still gets the final say via 422 insufficient_balance, which opens
  // the modal.
  const showBalanceLine =
    balanceCents !== null && hasSelection && !tooSoon && hasSwimmers;
  const isShort =
    showBalanceLine && totalPriceCents > (balanceCents ?? 0);
  const shortfallCents = isShort
    ? totalPriceCents - (balanceCents ?? 0)
    : 0;

  // Mobile: show the balance/add-funds line only when the current selection
  // is short — it's the one thing the parent needs to act on. On tablet+
  // keep the existing informational line so nothing regresses on desktop.
  const showMobileBalanceLine = showBalanceLine && isShort;

  return (
    <div
      role="region"
      aria-label="Booking selection"
      className="sticky bottom-[calc(var(--tab-bar-height)_+_env(safe-area-inset-bottom,_0px)_+_1rem)] tablet:bottom-4 z-10 mx-4 tablet:mx-0"
    >
      <div className="bg-heading text-background rounded-[16px] px-5 py-4 flex flex-col tablet:flex-row tablet:items-center gap-3 tablet:gap-4 transition-colors duration-200 motion-reduce:transition-none shadow-lg">
        <div className="flex-1 min-w-0">
          {/* No-selection + too-soon fall back to the pre-redesign single-
              line summary since there's no date / time range / swimmers to
              lay out yet. */}
          {!hasSelection || tooSoon ? (
            <>
              <p
                className={`text-sm font-semibold ${
                  hasSelection && !tooSoon ? "text-background" : "opacity-60"
                }`}
              >
                {tooSoon ? tooSoonLabel : "SELECTED TIME"}
              </p>
              <p className="text-xs opacity-70 mt-0.5">
                {tooSoon ? "Text Jason to book this one." : "No time picked yet"}
              </p>
            </>
          ) : (
            // Mobile three-line stack (date + price, time range, names);
            // tablet+ keeps it compact on one row since horizontal room
            // isn't the problem up there. Everything wraps instead of
            // truncating so a narrow iPhone doesn't lose any of the
            // summary.
            <div className="flex flex-col gap-1 tablet:flex-row tablet:items-baseline tablet:gap-3">
              <div className="flex items-baseline justify-between gap-3 tablet:flex-1 tablet:min-w-0">
                <p
                  className="text-sm font-bold text-background whitespace-normal break-words"
                  data-testid="single-date"
                >
                  {dateLabel}
                </p>
                {priceLabel !== null && (
                  <p
                    className="text-sm font-semibold shrink-0"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                    data-testid="single-price"
                  >
                    {priceLabel}
                  </p>
                )}
              </div>
              <p
                className="text-xs opacity-80 whitespace-normal break-words"
                data-testid="single-time-range"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {timeRangeLabel}
              </p>
              {swimmerLabel !== null && (
                <p
                  className="text-xs opacity-80 whitespace-normal break-words"
                  data-testid="single-swimmers"
                >
                  {swimmerLabel}
                </p>
              )}
            </div>
          )}
          {/* Tablet+ keeps the full balance / add-funds line as before. */}
          {showBalanceLine && (
            <p
              className="text-xs opacity-70 mt-0.5 hidden tablet:block"
              data-testid="single-balance-line"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              Balance: {formatDollars(balanceCents ?? 0)}
              {isShort && (
                <>
                  {" · "}
                  <span className="font-semibold">
                    Short by {formatDollars(shortfallCents)}
                  </span>
                </>
              )}
              {onAddFunds !== undefined && (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={onAddFunds}
                    data-testid="single-add-funds"
                    className="underline hover:opacity-80 font-semibold"
                  >
                    Add funds
                  </button>
                </>
              )}
            </p>
          )}
          {/* Mobile: only short-balance surfaces here. */}
          {showMobileBalanceLine && (
            <p
              className="text-xs mt-1 tablet:hidden whitespace-normal break-words"
              data-testid="single-balance-line-mobile"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <span className="font-semibold">
                Short by {formatDollars(shortfallCents)}
              </span>
              {onAddFunds !== undefined && (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={onAddFunds}
                    data-testid="single-add-funds-mobile"
                    className="underline hover:opacity-80 font-semibold"
                  >
                    Add funds
                  </button>
                </>
              )}
            </p>
          )}
          {needsApproval && hasSelection && !tooSoon && (
            <p className="text-xs opacity-70 mt-1 whitespace-normal break-words">
              Jason will confirm this one.
            </p>
          )}
        </div>

        <div className="flex flex-col items-stretch tablet:items-end gap-1 tablet:flex-shrink-0">
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmEnabled}
            data-testid="confirm-single"
            className="w-full tablet:w-auto min-h-[48px] tablet:min-h-[44px] px-5 rounded-button bg-button-primary-background text-button-primary-text text-sm font-semibold transition-opacity hover:opacity-90 active:scale-[0.97] transition-[opacity,transform] motion-reduce:transform-none disabled:opacity-40 disabled:cursor-default"
          >
            <PendingLabel
              isPending={isConfirming}
              label="Confirm booking"
              pendingLabel="Booking…"
            />
          </button>
          {reason !== null && (
            <p
              className="text-[11px] text-background/70 text-center tablet:text-right tablet:max-w-[12rem]"
              data-testid="single-disabled-reason"
            >
              {reason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
