"use client";

import { useId, useState } from "react";
import { parseDigitsToSwimTime, parseSwimTime, formatSwimTime } from "@swim-app/shared";

interface SwimTimeInputProps {
  name: string;
  label?: string;
  initialTime?: string;
  disabled?: boolean;
  // Called with the normalized time string (e.g. "1:02.34") whenever the
  // parsed value changes. null when the input is empty or invalid.
  onParsedChange?: (timeString: string | null, timeHundredths: number | null) => void;
}

export default function SwimTimeInput({
  name,
  label = "Time",
  initialTime,
  disabled,
  onParsedChange,
}: SwimTimeInputProps) {
  const inputId = useId();

  // Store what the user has typed as a run of digits. If an initial time
  // (e.g. "1:02.34") is provided, derive the digit string so the preview and
  // backing field start populated.
  const [digits, setDigits] = useState<string>(() => initialTimeToDigits(initialTime));

  const parsed = digits.length > 0 ? parseDigitsToSwimTime(digits) : null;
  const invalid = digits.length > 0 && parsed === null;

  function handleChange(raw: string): void {
    const next = raw.replace(/\D/g, "").slice(0, 6);
    setDigits(next);
    if (onParsedChange) {
      if (next.length === 0) {
        onParsedChange(null, null);
      } else {
        const nextParsed = parseDigitsToSwimTime(next);
        onParsedChange(nextParsed?.timeString ?? null, nextParsed?.timeHundredths ?? null);
      }
    }
  }

  return (
    <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
      <label htmlFor={inputId} className="text-xs font-semibold text-text-secondary">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        value={digits}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="e.g. 10234"
        aria-describedby={`${inputId}-preview`}
        aria-invalid={invalid}
        className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base tabular-nums focus:outline focus:outline-2 focus:outline-focus-ring disabled:opacity-60"
      />
      {/* Hidden backing field — this is what the server action reads. */}
      <input type="hidden" name={name} value={parsed?.timeString ?? ""} />
      <p
        id={`${inputId}-preview`}
        className={
          invalid
            ? "text-xs font-semibold text-danger tabular-nums"
            : "text-xs text-text-secondary tabular-nums"
        }
        aria-live="polite"
      >
        {digits.length === 0
          ? "Type digits — the format fills in"
          : invalid
            ? "Invalid time (seconds must be under 60)"
            : parsed!.timeString}
      </p>
    </div>
  );
}

// "1:02.34" → "10234", "58.30" → "5830". Any shape parseSwimTime understands
// becomes the equivalent digit sequence; anything else becomes empty.
function initialTimeToDigits(initial: string | undefined): string {
  if (!initial) return "";
  const hundredths = parseSwimTime(initial);
  if (hundredths === null) return "";
  const canonical = formatSwimTime(hundredths);
  return canonical.replace(/\D/g, "");
}
