"use client";

// Single "choices card" that holds the three per-booking decisions, in
// the order the parent makes them: Who's swimming → Length → Pool. Pool
// collapses to a one-line summary with a "Change ›" link that opens a
// small picker dialog so the row stays compact on a narrow phone.
//
// Design tokens only; the card is just a rounded border with dividers
// between sections. Behavior (nonce-driven swimmer-missing feedback,
// per-pick chip labels in Multiple / Recurring) is unchanged.

import { useEffect, useRef, useState } from "react";

interface Location {
  id: string;
  name: string;
  isHomePool: boolean;
}

interface Swimmer {
  id: string;
  firstName: string;
  lastName: string;
}

interface Props {
  locations: Location[];
  swimmers: Swimmer[];
  locationId: string | null;
  durationMinutes: 30 | 45 | 60;
  swimmerIds: string[];
  // Nonce that increments every time the parent asks us to replay the
  // "no swimmer picked" feedback. Each new value re-fires the scroll +
  // highlight + focus side effects so repeated taps on Confirm or Review
  // always get fresh feedback, not just the first.
  swimmerErrorNonce: number;
  // "Who's swimming" (Single) vs "Who's swimming in new picks" (Multiple +
  // Recurring, where each pick stores its own swimmers at tap time).
  swimmerLabel?: string;
  // Label for the length chips. In Multiple and Recurring the chips only set
  // the length for the NEXT pick, so the label makes that explicit; existing
  // picks keep their own length and get edited in the pick list / pattern
  // list.
  durationLabel?: string;
  isLoading: boolean;
  onLocationChange: (id: string) => void;
  onDurationChange: (d: 30 | 45 | 60) => void;
  onSwimmersChange: (ids: string[]) => void;
}

const DURATIONS: Array<30 | 45 | 60> = [30, 45, 60];

const LABEL = "text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2";

const CHIP_BASE =
  "min-h-[44px] px-3.5 rounded-full border text-sm font-semibold flex items-center gap-1.5 transition-colors duration-150 motion-reduce:transition-none disabled:opacity-40 disabled:cursor-default";

const CHIP_ACTIVE = "border-accent bg-accent/10 text-accent";
const CHIP_INACTIVE = "border-border text-text hover:bg-surface-soft";

// Length of the "please pick a swimmer" highlight pulse. The useEffect
// re-arms this timeout on every nonce bump so each tap replays the
// animation cleanly, respecting prefers-reduced-motion via the CSS
// transition-shadow + motion-reduce guard below.
const HIGHLIGHT_MS = 1600;

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="1.5,6 5,9.5 10.5,2.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="6" y1="1" x2="6" y2="11" />
      <line x1="1" y1="6" x2="11" y2="6" />
    </svg>
  );
}

export default function CalendarConfigRow({
  locations,
  swimmers,
  locationId,
  durationMinutes,
  swimmerIds,
  swimmerErrorNonce,
  swimmerLabel = "Who\u2019s swimming",
  durationLabel = "Length",
  isLoading,
  onLocationChange,
  onDurationChange,
  onSwimmersChange,
}: Props) {
  const swimmerSectionRef = useRef<HTMLDivElement>(null);
  const firstSwimmerChipRef = useRef<HTMLButtonElement>(null);
  const [highlight, setHighlight] = useState(false);
  const [poolPickerOpen, setPoolPickerOpen] = useState(false);
  const errorVisible = swimmerErrorNonce > 0 && swimmerIds.length === 0;

  useEffect(() => {
    if (swimmerErrorNonce === 0) return;
    if (swimmerIds.length !== 0) return;
    // Flip highlight off before on so a repeat tap with the same nonce-after-
    // selection pattern still restarts the transition. React batches both
    // state updates, so this still fires exactly once per nonce bump.
    setHighlight(false);
    swimmerSectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    firstSwimmerChipRef.current?.focus({ preventScroll: true });
    const start = requestAnimationFrame(() => setHighlight(true));
    const timer = setTimeout(() => setHighlight(false), HIGHLIGHT_MS);
    return () => {
      cancelAnimationFrame(start);
      clearTimeout(timer);
    };
  }, [swimmerErrorNonce, swimmerIds.length]);

  function toggleSwimmer(id: string) {
    if (swimmerIds.includes(id)) {
      onSwimmersChange(swimmerIds.filter((existing) => existing !== id));
    } else {
      onSwimmersChange([...swimmerIds, id]);
    }
  }

  const isFamilyLesson = swimmerIds.length >= 2;
  const selectedLocation =
    locations.find((location) => location.id === locationId) ?? null;
  const selectedLocationName =
    selectedLocation?.name ?? (locations.length > 0 ? locations[0]?.name ?? "" : "");
  const hasPoolRow = locations.length > 1;

  return (
    <div className="rounded-card border border-border bg-background">
      {swimmers.length > 0 && (
        <div
          ref={swimmerSectionRef}
          data-highlight={highlight ? "true" : undefined}
          data-testid="swimmer-picker"
          className={`p-4 tablet:p-5 transition-shadow duration-300 motion-reduce:transition-none ${
            highlight ? "ring-2 ring-danger bg-danger/5 rounded-card" : ""
          }`}
        >
          <p className={LABEL}>{swimmerLabel}</p>
          {swimmers.length > 1 && (
            <p className="text-xs text-text-secondary mb-2 -mt-1">
              Tap everyone who&rsquo;s swimming
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {swimmers.map((swimmer, index) => {
              const isActive = swimmerIds.includes(swimmer.id);
              return (
                <button
                  key={swimmer.id}
                  ref={index === 0 ? firstSwimmerChipRef : undefined}
                  type="button"
                  onClick={() => toggleSwimmer(swimmer.id)}
                  disabled={isLoading}
                  aria-pressed={isActive}
                  className={[
                    CHIP_BASE,
                    isActive
                      ? CHIP_ACTIVE
                      : "border-dashed border-border text-text-secondary hover:bg-surface-soft",
                  ].join(" ")}
                >
                  {isActive ? <CheckIcon /> : <PlusIcon />}
                  {swimmer.firstName} {swimmer.lastName}
                </button>
              );
            })}
          </div>
          {isFamilyLesson && (
            <p className="text-xs text-text-secondary mt-2">
              Family lesson &middot; {swimmerIds.length}
            </p>
          )}
          {errorVisible && (
            <p
              role="alert"
              className="text-sm font-semibold text-danger mt-2"
              data-testid="swimmer-error"
            >
              Pick who&rsquo;s swimming first.
            </p>
          )}
        </div>
      )}

      <div
        className={`p-4 tablet:p-5 ${swimmers.length > 0 ? "border-t border-border" : ""}`}
      >
        <p className={LABEL}>{durationLabel}</p>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => onDurationChange(minutes)}
              disabled={isLoading}
              className={`${CHIP_BASE} ${durationMinutes === minutes ? CHIP_ACTIVE : CHIP_INACTIVE}`}
            >
              {minutes} min
            </button>
          ))}
        </div>
      </div>

      {hasPoolRow && (
        <div className="border-t border-border p-4 tablet:p-5 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
              Pool
            </p>
            <p
              className="text-sm font-semibold text-text mt-1 truncate"
              data-testid="pool-row-selected"
            >
              {selectedLocationName || "No pool selected"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPoolPickerOpen(true)}
            disabled={isLoading}
            data-testid="pool-row-change"
            className="shrink-0 min-h-[44px] px-3 text-sm font-semibold text-link hover:text-link-hover disabled:opacity-40 disabled:cursor-default"
          >
            Change <span aria-hidden="true">›</span>
          </button>
        </div>
      )}

      {hasPoolRow && poolPickerOpen && (
        <PoolPickerDialog
          locations={locations}
          selectedId={locationId}
          onSelect={(id) => {
            onLocationChange(id);
            setPoolPickerOpen(false);
          }}
          onClose={() => setPoolPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ── Pool picker dialog ──────────────────────────────────────────────────
//
// Bottom-sheet on mobile, centered modal on tablet+. Keeps focus trapped
// via native <dialog>, dismisses on Escape or backdrop click, and emits
// the chosen pool id straight to the parent — the state machine upstream
// handles the fetch refresh.

interface PoolPickerDialogProps {
  locations: Location[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function PoolPickerDialog({
  locations,
  selectedId,
  onSelect,
  onClose,
}: PoolPickerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  function handleBackdrop(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleBackdrop}
      aria-labelledby="pool-picker-title"
      data-testid="pool-picker-dialog"
      className="bg-transparent p-0 m-0 inset-0 w-full h-full max-w-full max-h-full backdrop:bg-ink/60"
    >
      <div className="min-h-full flex items-end tablet:items-center justify-center p-0 tablet:p-4">
        <div className="w-full max-w-[420px] bg-background rounded-t-card tablet:rounded-card border border-border p-5 flex flex-col gap-3">
          <h2
            id="pool-picker-title"
            className="font-heading text-xl text-heading"
          >
            Pool
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {locations.map((location) => {
              const active = location.id === selectedId;
              return (
                <li key={location.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(location.id)}
                    aria-pressed={active}
                    className="w-full min-h-[48px] px-1 py-3 flex items-center gap-3 text-left transition-colors duration-150 motion-reduce:transition-none hover:bg-surface-soft"
                  >
                    <span
                      aria-hidden="true"
                      className={[
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
                        active ? "border-accent" : "border-border",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "block w-2.5 h-2.5 rounded-full transition-transform duration-150 motion-reduce:transition-none",
                          active ? "bg-accent scale-100" : "scale-0",
                        ].join(" ")}
                      />
                    </span>
                    <span className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-sm font-semibold text-text truncate">
                        {location.name}
                      </span>
                      {location.isHomePool && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary shrink-0">
                          Home
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] mt-1 text-sm font-semibold text-text-secondary hover:text-text"
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
