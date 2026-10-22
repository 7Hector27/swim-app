"use client";

import { useEffect, useRef, useState } from "react";
import type { CoachHouseholdSearchResult } from "@swim-app/shared";
import { COACH_HOUSEHOLD_SEARCH_MIN_LENGTH } from "@swim-app/shared";
import { searchHouseholdsAction } from "./actions";
import { activeSwimmers, familyDisplayName } from "./helpers";

interface Props {
  initialHouseholds: CoachHouseholdSearchResult[];
  initialQuery?: string;
  selectedHousehold: CoachHouseholdSearchResult | null;
  selectedSwimmerIds: string[];
  onSelectHousehold: (household: CoachHouseholdSearchResult) => void;
  onToggleSwimmer: (swimmerId: string) => void;
  onContinue: () => void;
}

const DEBOUNCE_MS = 220;
const MAX_SWIMMERS = 4;

export default function Step1HouseholdPicker({
  initialHouseholds,
  initialQuery = "",
  selectedHousehold,
  selectedSwimmerIds,
  onSelectHousehold,
  onToggleSwimmer,
  onContinue,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [households, setHouseholds] = useState<CoachHouseholdSearchResult[]>(initialHouseholds);
  const [isSearching, setIsSearching] = useState(false);
  const searchTokenRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < COACH_HOUSEHOLD_SEARCH_MIN_LENGTH) {
      setHouseholds([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const token = ++searchTokenRef.current;
    const timer = setTimeout(async () => {
      const result = await searchHouseholdsAction(trimmed);
      // Ignore stale responses from a prior keystroke.
      if (token !== searchTokenRef.current) return;
      setHouseholds(result ?? []);
      setIsSearching(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const canContinue =
    selectedHousehold !== null && selectedSwimmerIds.length > 0;

  const trimmed = query.trim();
  const emptySearch =
    trimmed.length >= COACH_HOUSEHOLD_SEARCH_MIN_LENGTH && !isSearching && households.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <label htmlFor="household-search" className="sr-only">
        Search families
      </label>
      <input
        id="household-search"
        type="search"
        inputMode="search"
        autoComplete="off"
        placeholder="Search by swimmer or family name"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-12 px-4 rounded-button border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
      />

      {isSearching && (
        <p className="text-sm text-text-secondary" aria-live="polite">
          Searching…
        </p>
      )}

      {trimmed.length > 0 && trimmed.length < COACH_HOUSEHOLD_SEARCH_MIN_LENGTH && (
        <p className="text-sm text-text-secondary">Keep typing: at least 2 characters.</p>
      )}

      {emptySearch && (
        <p className="text-sm text-text-secondary">
          No households found. Try a swimmer&apos;s first name.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {households.map((household) => {
          const isSelected = selectedHousehold?.householdId === household.householdId;
          const active = activeSwimmers(household);
          const archivedCount = household.swimmers.length - active.length;
          return (
            <li key={household.householdId}>
              <button
                type="button"
                onClick={() => onSelectHousehold(household)}
                aria-pressed={isSelected}
                className={`w-full text-left rounded-card border p-4 transition-colors duration-150 motion-reduce:transition-none ${
                  isSelected
                    ? "border-accent bg-accent/5"
                    : "border-border bg-background hover:bg-surface-soft"
                }`}
              >
                <p className="font-semibold text-text text-base">
                  {familyDisplayName(household)}
                </p>
                {household.memberFullNames.length > 0 && (
                  <p className="text-sm text-text-secondary mt-0.5">
                    {household.memberFullNames.join(", ")}
                  </p>
                )}
                <p className="text-sm text-text-secondary mt-1">
                  {active.length === 0
                    ? "No active swimmers"
                    : active.map((swimmer) => swimmer.firstName).join(", ")}
                  {archivedCount > 0 && (
                    <span className="text-text-secondary">
                      {" "}
                      · {archivedCount} archived
                    </span>
                  )}
                </p>
              </button>

              {isSelected && (
                <div className="mt-3 flex flex-col gap-3 p-4 rounded-card border border-border bg-surface-soft">
                  <p className="text-sm font-semibold text-text">
                    Pick swimmer{active.length > 1 ? "s" : ""} (up to {MAX_SWIMMERS})
                  </p>
                  {active.length === 0 ? (
                    <p className="text-sm text-text-secondary">
                      This household has no active swimmers.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {household.swimmers.map((swimmer) => {
                        const isActiveSwimmer = swimmer.archivedAt === null;
                        const picked = selectedSwimmerIds.includes(swimmer.id);
                        const disabled =
                          !isActiveSwimmer ||
                          (!picked && selectedSwimmerIds.length >= MAX_SWIMMERS);
                        return (
                          <button
                            key={swimmer.id}
                            type="button"
                            onClick={() => onToggleSwimmer(swimmer.id)}
                            disabled={disabled}
                            aria-pressed={picked}
                            className={`min-h-[40px] px-3 rounded-button border text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none active:scale-[0.97] disabled:cursor-not-allowed ${
                              !isActiveSwimmer
                                ? "border-border text-text-secondary opacity-60 line-through"
                                : picked
                                  ? "bg-accent text-on-accent border-accent"
                                  : "bg-background border-border text-text hover:bg-background"
                            } ${disabled && isActiveSwimmer ? "opacity-50" : ""}`}
                          >
                            {swimmer.firstName}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-4 flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="inline-flex items-center justify-center min-h-[52px] px-6 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 motion-reduce:transition-none hover:opacity-90 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
