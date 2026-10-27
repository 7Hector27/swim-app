"use client";

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
  isLoading: boolean;
  showSwimmerError: boolean;
  // Label for the length chips. In Multiple and Recurring the chips only set
  // the length for the NEXT pick, so the label makes that explicit; existing
  // picks keep their own length and get edited in the pick list / pattern
  // list.
  durationLabel?: string;
  onLocationChange: (id: string) => void;
  onDurationChange: (d: 30 | 45 | 60) => void;
  onSwimmersChange: (ids: string[]) => void;
}

const DURATIONS: Array<30 | 45 | 60> = [30, 45, 60];

const LABEL = "text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1.5";

const CHIP_BASE =
  "min-h-[44px] px-3.5 rounded-full border text-sm font-semibold flex items-center gap-1.5 transition-colors duration-150 motion-reduce:transition-none disabled:opacity-40 disabled:cursor-default";

const CHIP_ACTIVE = "border-accent bg-accent/10 text-accent";
const CHIP_INACTIVE = "border-border text-text hover:bg-surface-soft";

// Length of the "please pick a swimmer" highlight pulse. Matches the
// transition declared in the section className below.
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
  isLoading,
  showSwimmerError,
  durationLabel = "Length",
  onLocationChange,
  onDurationChange,
  onSwimmersChange,
}: Props) {
  const swimmerSectionRef = useRef<HTMLDivElement>(null);
  const swimmerErrorRef = useRef<HTMLParagraphElement>(null);
  const [highlight, setHighlight] = useState(false);

  useEffect(() => {
    if (!showSwimmerError || swimmerIds.length !== 0) return;
    // scrollIntoView is missing in some test environments; guard it so the
    // highlight + focus still run.
    swimmerSectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    swimmerErrorRef.current?.focus({ preventScroll: true });
    setHighlight(true);
    const timer = setTimeout(() => setHighlight(false), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [showSwimmerError, swimmerIds.length]);

  function toggleSwimmer(id: string) {
    if (swimmerIds.includes(id)) {
      onSwimmersChange(swimmerIds.filter((existing) => existing !== id));
    } else {
      onSwimmersChange([...swimmerIds, id]);
    }
  }

  const isFamilyLesson = swimmerIds.length >= 2;

  return (
    <div className="flex flex-col gap-4">
      {locations.length > 1 && (
        <div>
          <p className={LABEL}>Pool</p>
          <select
            value={locationId ?? ""}
            onChange={(event) => onLocationChange(event.target.value)}
            disabled={isLoading}
            className={`${CHIP_BASE} appearance-none bg-background pr-7 cursor-pointer border-border text-text`}
            aria-label="Pool location"
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
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

      {swimmers.length > 0 && (
        <div
          ref={swimmerSectionRef}
          data-highlight={highlight ? "true" : undefined}
          data-testid="swimmer-picker"
          className={`rounded-card -mx-2 px-2 py-2 transition-shadow duration-300 motion-reduce:transition-none ${
            highlight
              ? "ring-2 ring-danger bg-danger/5"
              : "ring-0 bg-transparent"
          }`}
        >
          <p className={LABEL}>Who&rsquo;s swimming</p>
          {swimmers.length > 1 && (
            <p className="text-xs text-text-secondary mb-2">Tap everyone who&rsquo;s swimming</p>
          )}
          <div className="flex flex-wrap gap-2">
            {swimmers.map((swimmer) => {
              const isActive = swimmerIds.includes(swimmer.id);
              return (
                <button
                  key={swimmer.id}
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
              Family lesson · {swimmerIds.length}
            </p>
          )}
          {showSwimmerError && swimmerIds.length === 0 && (
            <p
              ref={swimmerErrorRef}
              role="alert"
              tabIndex={-1}
              style={{ outline: "none" }}
              className="text-sm font-semibold text-danger mt-2"
              data-testid="swimmer-error"
            >
              Pick who&rsquo;s swimming first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
