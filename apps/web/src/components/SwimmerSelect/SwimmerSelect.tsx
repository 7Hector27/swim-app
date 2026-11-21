"use client";

import { forwardRef, useId, useMemo } from "react";

import { buildSwimmerLabels, sortSwimmers, type DisambigSwimmer } from "./labels";

interface SwimmerSelectProps {
  swimmers: DisambigSwimmer[];
  value: string;
  onChange: (next: string) => void;
  label?: string;
  // Inline error message rendered under the field. When set, the field is
  // marked aria-invalid and focused by the parent as part of validation.
  error?: string | null;
  disabled?: boolean;
  placeholder?: string;
  // Optional: callers can override the id of the <select> so the parent can
  // target it with a label if they already render one.
  id?: string;
}

const SwimmerSelect = forwardRef<HTMLSelectElement, SwimmerSelectProps>(function SwimmerSelect(
  { swimmers, value, onChange, label = "Swimmer", error = null, disabled, placeholder = "Choose a swimmer", id },
  ref,
) {
  const localId = useId();
  const selectId = id ?? `${localId}-swimmer`;
  const describedBy = error !== null ? `${selectId}-error` : undefined;

  const sortedWithLabels = useMemo(() => {
    const sorted = sortSwimmers(swimmers);
    const labelMap = buildSwimmerLabels(sorted);
    return sorted.map((swimmer) => ({ swimmer, label: labelMap.get(swimmer.id) ?? "" }));
  }, [swimmers]);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="text-xs font-semibold text-text-secondary">
        {label}
      </label>
      <select
        ref={ref}
        id={selectId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={error !== null}
        aria-describedby={describedBy}
        className="h-11 min-h-[44px] px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring aria-[invalid=true]:border-danger disabled:opacity-60"
      >
        <option value="">{placeholder}</option>
        {sortedWithLabels.map((entry) => (
          <option key={entry.swimmer.id} value={entry.swimmer.id}>
            {entry.label}
          </option>
        ))}
      </select>
      {error !== null && (
        <p id={describedBy} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
});

export default SwimmerSelect;
