"use client";

import { useEffect, useId, useRef, useState } from "react";
import { parseSwimTime } from "@swim-app/shared";

interface TimeInputProps {
  // Hundredths of a second. `null` means empty (distinct from 0).
  value: number | null;
  onChange: (next: number | null) => void;
  label?: string;
  disabled?: boolean;
  // The id applied to the minutes field so an external <label> can target it.
  id?: string;
  // Focuses the minutes box on mount (and on `focusKey` change).
  autoFocus?: boolean;
  // Changing this value re-focuses the minutes box. Used by callers that want
  // to return focus to the time field after a save.
  focusKey?: number | string;
  "aria-describedby"?: string;
}

type Field = "min" | "sec" | "hun";

// Split hundredths into the three displayed segments. Null stays null.
function splitHundredths(total: number | null): { min: string; sec: string; hun: string } {
  if (total === null) return { min: "", sec: "", hun: "" };
  const minutes = Math.floor(total / 6000);
  const remaining = total % 6000;
  const seconds = Math.floor(remaining / 100);
  const hundredths = remaining % 100;
  return {
    min: minutes === 0 ? "0" : String(minutes),
    sec: String(seconds).padStart(2, "0"),
    hun: String(hundredths).padStart(2, "0"),
  };
}

// Compose three segments back into hundredths. Empty in every box returns null.
function joinHundredths(min: string, sec: string, hun: string): number | null {
  if (min === "" && sec === "" && hun === "") return null;
  const m = min === "" ? 0 : parseInt(min, 10);
  const s = sec === "" ? 0 : parseInt(sec, 10);
  const h = hun === "" ? 0 : parseInt(hun, 10);
  if (Number.isNaN(m) || Number.isNaN(s) || Number.isNaN(h)) return null;
  // seconds must be under 60; hundredths under 100; minutes unlimited.
  if (s >= 60 || h >= 100 || m < 0 || s < 0 || h < 0) return null;
  return m * 6000 + s * 100 + h;
}

// If the user types or pastes something that looks like a full time
// (e.g. "1:02.34", "32.41", "10234", "1234"), expand it into the three
// segments. Otherwise returns null.
function expandFullTime(raw: string): { min: string; sec: string; hun: string } | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = parseSwimTime(trimmed);
  if (parsed !== null) return splitHundredths(parsed);
  // Fall back: all-digits input of at least 3 digits is parsed right-aligned,
  // mirroring parseDigitsToSwimTime (rightmost 2 = hun, next 2 = sec, rest = min).
  if (/^\d{3,}$/.test(trimmed)) {
    const padded = trimmed.padStart(3, "0");
    const hun = padded.slice(-2);
    const sec = padded.slice(-4, -2).padStart(2, "0");
    const minRaw = padded.slice(0, -4);
    const min = minRaw.length > 0 ? String(parseInt(minRaw, 10)) : "0";
    const result = joinHundredths(min, sec, hun);
    if (result !== null) return splitHundredths(result);
  }
  return null;
}

// Mod wrap: step a numeric value with wrap-around in [0, max).
function wrap(value: number, delta: number, max: number): number {
  if (max <= 0) return 0;
  const next = (value + delta) % max;
  return next < 0 ? next + max : next;
}

const SEC_MAX = 60;
const HUN_MAX = 100;
const MIN_MAX = 100; // caps nudging at 99 minutes. Typed values aren't capped.

export default function TimeInput({
  value,
  onChange,
  label = "Time",
  disabled,
  id,
  autoFocus,
  focusKey,
  "aria-describedby": ariaDescribedBy,
}: TimeInputProps) {
  const groupId = useId();
  const minId = id ?? `${groupId}-min`;
  const secId = `${groupId}-sec`;
  const hunId = `${groupId}-hun`;

  // Local digit text per box. We keep the user's exact digits (including a
  // stray leading zero while they type) rather than reformatting on every
  // keystroke; the parent still receives a normalized hundredths number.
  const split = splitHundredths(value);
  const [minText, setMinTextState] = useState<string>(value === null ? "" : split.min);
  const [secText, setSecTextState] = useState<string>(value === null ? "" : split.sec);
  const [hunText, setHunTextState] = useState<string>(value === null ? "" : split.hun);

  // Refs mirror the latest text so blur handlers triggered by the imperative
  // focus() call during auto-advance don't read stale closure state.
  const minTextRef = useRef(minText);
  const secTextRef = useRef(secText);
  const hunTextRef = useRef(hunText);
  const setMinText = (next: string): void => { minTextRef.current = next; setMinTextState(next); };
  const setSecText = (next: string): void => { secTextRef.current = next; setSecTextState(next); };
  const setHunText = (next: string): void => { hunTextRef.current = next; setHunTextState(next); };

  // External value override: when `value` changes to something the local text
  // doesn't represent (e.g. after a programmatic reset), re-sync.
  const lastExternal = useRef<number | null>(value);
  useEffect(() => {
    if (value === lastExternal.current) return;
    lastExternal.current = value;
    const next = splitHundredths(value);
    setMinText(value === null ? "" : next.min);
    setSecText(value === null ? "" : next.sec);
    setHunText(value === null ? "" : next.hun);
  }, [value]);

  const minRef = useRef<HTMLInputElement>(null);
  const secRef = useRef<HTMLInputElement>(null);
  const hunRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) minRef.current?.focus();
  }, [autoFocus, focusKey]);

  function emit(next: { min: string; sec: string; hun: string }): void {
    const n = joinHundredths(next.min, next.sec, next.hun);
    lastExternal.current = n;
    onChange(n);
  }

  function setAll(next: { min: string; sec: string; hun: string }): void {
    setMinText(next.min);
    setSecText(next.sec);
    setHunText(next.hun);
    emit(next);
  }

  function handleTyped(field: Field, raw: string): void {
    // Strip non-digits defensively.
    const digits = raw.replace(/\D/g, "");

    // Full-time fills: if the raw contains a separator OR the user typed 3+
    // digits into a single box, treat as a full time and spread across boxes.
    const full = expandFullTime(raw);
    if (full && (raw.includes(":") || raw.includes(".") || raw.includes(",") || digits.length >= 3)) {
      setAll(full);
      // Move focus to the hundredths box so the user can continue typing.
      hunRef.current?.focus();
      hunRef.current?.select();
      return;
    }

    if (field === "min") {
      // Minutes box has no cap on how many digits; auto-advance when 2 digits
      // are typed in a row (to match the stated behaviour).
      const capped = digits.slice(0, 4);
      setMinText(capped);
      emit({ min: capped, sec: secText, hun: hunText });
      if (capped.length >= 2 && digits.length >= 2) {
        secRef.current?.focus();
        secRef.current?.select();
      }
      return;
    }

    if (field === "sec") {
      const capped = digits.slice(0, 2);
      setSecText(capped);
      emit({ min: minText, sec: capped, hun: hunText });
      if (capped.length === 2) {
        hunRef.current?.focus();
        hunRef.current?.select();
      }
      return;
    }

    // hundredths
    const capped = digits.slice(0, 2);
    setHunText(capped);
    emit({ min: minText, sec: secText, hun: capped });
  }

  function handleKeyDown(field: Field, event: React.KeyboardEvent<HTMLInputElement>): void {
    // Up/Down nudge with wrap; Shift+Arrow nudges by 10.
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      nudge(field, event.key === "ArrowUp" ? 1 : -1, event.shiftKey ? 10 : 1);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      // Only hop boxes at an input edge.
      const input = event.currentTarget;
      const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
      const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
      if (event.key === "ArrowRight" && atEnd) {
        event.preventDefault();
        if (field === "min") {
          secRef.current?.focus();
          secRef.current?.select();
        } else if (field === "sec") {
          hunRef.current?.focus();
          hunRef.current?.select();
        }
      } else if (event.key === "ArrowLeft" && atStart) {
        event.preventDefault();
        if (field === "hun") {
          secRef.current?.focus();
          secRef.current?.select();
        } else if (field === "sec") {
          minRef.current?.focus();
          minRef.current?.select();
        }
      }
      return;
    }
    if (event.key === "Backspace") {
      const input = event.currentTarget;
      // Jump to previous box if backspacing from an empty field.
      if (input.value === "") {
        if (field === "hun") {
          event.preventDefault();
          secRef.current?.focus();
          secRef.current?.select();
        } else if (field === "sec") {
          event.preventDefault();
          minRef.current?.focus();
          minRef.current?.select();
        }
      }
    }
  }

  function handlePaste(field: Field, event: React.ClipboardEvent<HTMLInputElement>): void {
    const text = event.clipboardData.getData("text");
    const full = expandFullTime(text);
    if (full) {
      event.preventDefault();
      setAll(full);
      hunRef.current?.focus();
      hunRef.current?.select();
    } else if (/^\d+$/.test(text.trim())) {
      // Plain digit paste into a single box: handled by handleTyped via onChange.
    }
    // Otherwise let the browser handle (onChange filters non-digits).
  }

  function handleWheel(field: Field, event: React.WheelEvent<HTMLInputElement>): void {
    if (document.activeElement !== event.currentTarget) return;
    if (event.deltaY === 0) return;
    event.preventDefault();
    nudge(field, event.deltaY < 0 ? 1 : -1, event.shiftKey ? 10 : 1);
  }

  function nudge(field: Field, direction: 1 | -1, step: number): void {
    const current = joinHundredths(minText, secText, hunText);
    const base = current === null ? { min: 0, sec: 0, hun: 0 } : {
      min: Math.floor(current / 6000),
      sec: Math.floor((current % 6000) / 100),
      hun: current % 100,
    };
    const delta = direction * step;
    if (field === "min") {
      const next = wrap(base.min, delta, MIN_MAX);
      setAll({
        min: String(next),
        sec: String(base.sec).padStart(2, "0"),
        hun: String(base.hun).padStart(2, "0"),
      });
      return;
    }
    if (field === "sec") {
      const next = wrap(base.sec, delta, SEC_MAX);
      setAll({
        min: String(base.min === 0 && minText === "" ? 0 : base.min),
        sec: String(next).padStart(2, "0"),
        hun: String(base.hun).padStart(2, "0"),
      });
      return;
    }
    const next = wrap(base.hun, delta, HUN_MAX);
    setAll({
      min: String(base.min === 0 && minText === "" ? 0 : base.min),
      sec: String(base.sec).padStart(2, "0"),
      hun: String(next).padStart(2, "0"),
    });
  }

  function handleBlur(field: Field): void {
    // Read latest values from refs so blur fired by an imperative focus()
    // call (auto-advance) sees the just-set value, not stale closure state.
    const latestMin = minTextRef.current;
    const latestSec = secTextRef.current;
    const latestHun = hunTextRef.current;
    if (field === "sec" && latestSec !== "" && latestSec.length < 2) {
      const padded = latestSec.padStart(2, "0");
      setSecText(padded);
      emit({ min: latestMin, sec: padded, hun: latestHun });
    } else if (field === "hun" && latestHun !== "" && latestHun.length < 2) {
      const padded = latestHun.padStart(2, "0");
      setHunText(padded);
      emit({ min: latestMin, sec: latestSec, hun: padded });
    }
  }

  const invalidSec = secText !== "" && parseInt(secText, 10) >= 60;
  const invalidHun = hunText !== "" && parseInt(hunText, 10) >= 100;

  return (
    <fieldset
      className="flex flex-col gap-1 border-0 p-0 m-0"
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
    >
      <legend className="text-xs font-semibold text-text-secondary">{label}</legend>
      <div className="flex items-end gap-1">
        <div className="flex flex-col gap-0.5">
          <label htmlFor={minId} className="sr-only">
            Minutes
          </label>
          <input
            ref={minRef}
            id={minId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            aria-label="Minutes"
            placeholder="0"
            value={minText}
            disabled={disabled}
            onChange={(event) => handleTyped("min", event.target.value)}
            onKeyDown={(event) => handleKeyDown("min", event)}
            onPaste={(event) => handlePaste("min", event)}
            onWheel={(event) => handleWheel("min", event)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => handleBlur("min")}
            className="h-11 w-12 min-w-[44px] px-1 rounded-lg border border-border bg-background text-text text-base tabular-nums text-center focus:outline focus:outline-2 focus:outline-focus-ring disabled:opacity-60"
          />
          <NudgeButtons {...(disabled !== undefined && { disabled })} onUp={() => nudge("min", 1, 1)} onDown={() => nudge("min", -1, 1)} label="minutes" />
        </div>
        <span aria-hidden="true" className="pb-11 tablet:pb-11 text-text-secondary font-semibold pb-[1.75rem]">:</span>
        <div className="flex flex-col gap-0.5">
          <label htmlFor={secId} className="sr-only">
            Seconds
          </label>
          <input
            ref={secRef}
            id={secId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            aria-label="Seconds"
            aria-invalid={invalidSec}
            placeholder="00"
            value={secText}
            disabled={disabled}
            onChange={(event) => handleTyped("sec", event.target.value)}
            onKeyDown={(event) => handleKeyDown("sec", event)}
            onPaste={(event) => handlePaste("sec", event)}
            onWheel={(event) => handleWheel("sec", event)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => handleBlur("sec")}
            className="h-11 w-12 min-w-[44px] px-1 rounded-lg border border-border bg-background text-text text-base tabular-nums text-center focus:outline focus:outline-2 focus:outline-focus-ring disabled:opacity-60 aria-[invalid=true]:border-danger"
          />
          <NudgeButtons {...(disabled !== undefined && { disabled })} onUp={() => nudge("sec", 1, 1)} onDown={() => nudge("sec", -1, 1)} label="seconds" />
        </div>
        <span aria-hidden="true" className="pb-[1.75rem] text-text-secondary font-semibold">.</span>
        <div className="flex flex-col gap-0.5">
          <label htmlFor={hunId} className="sr-only">
            Hundredths
          </label>
          <input
            ref={hunRef}
            id={hunId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            aria-label="Hundredths"
            aria-invalid={invalidHun}
            placeholder="00"
            value={hunText}
            disabled={disabled}
            onChange={(event) => handleTyped("hun", event.target.value)}
            onKeyDown={(event) => handleKeyDown("hun", event)}
            onPaste={(event) => handlePaste("hun", event)}
            onWheel={(event) => handleWheel("hun", event)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => handleBlur("hun")}
            className="h-11 w-12 min-w-[44px] px-1 rounded-lg border border-border bg-background text-text text-base tabular-nums text-center focus:outline focus:outline-2 focus:outline-focus-ring disabled:opacity-60 aria-[invalid=true]:border-danger"
          />
          <NudgeButtons {...(disabled !== undefined && { disabled })} onUp={() => nudge("hun", 1, 1)} onDown={() => nudge("hun", -1, 1)} label="hundredths" />
        </div>
      </div>
    </fieldset>
  );
}

function NudgeButtons({
  onUp,
  onDown,
  disabled,
  label,
}: {
  onUp: () => void;
  onDown: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      <button
        type="button"
        onClick={onDown}
        disabled={disabled}
        aria-label={`Decrease ${label}`}
        tabIndex={-1}
        className="h-6 w-6 rounded border border-border bg-background text-text-secondary text-xs font-bold leading-none hover:text-text focus:outline focus:outline-2 focus:outline-focus-ring disabled:opacity-60"
      >
        −
      </button>
      <button
        type="button"
        onClick={onUp}
        disabled={disabled}
        aria-label={`Increase ${label}`}
        tabIndex={-1}
        className="h-6 w-6 rounded border border-border bg-background text-text-secondary text-xs font-bold leading-none hover:text-text focus:outline focus:outline-2 focus:outline-focus-ring disabled:opacity-60"
      >
        +
      </button>
    </div>
  );
}
