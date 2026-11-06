"use client";

import { isQuarterHour } from "@swim-app/shared";

import { QUARTER_HOUR_OPTIONS, formatTime12 } from "./timeOptions";

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className: string;
  required?: boolean;
  disabled?: boolean;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  placeholder?: string;
}

// Native <select> over <input type="time"> because iOS Safari ignores the
// step attribute on time inputs — a native picker is the only way to
// actually block 4:43 PM from being saved on an iPhone.
export default function TimeSelect({
  id,
  value,
  onChange,
  className,
  required = false,
  disabled = false,
  ariaDescribedBy,
  ariaInvalid,
  placeholder = "Pick a time",
}: Props) {
  const hasValue = value.length > 0;
  const needsCustomOption = hasValue && !isQuarterHour(value);

  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={required}
      disabled={disabled}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      className={className}
    >
      {!hasValue && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {needsCustomOption && <option value={value}>{formatTime12(value)}</option>}
      {QUARTER_HOUR_OPTIONS.map((option) => (
        <option key={option} value={option}>
          {formatTime12(option)}
        </option>
      ))}
    </select>
  );
}
