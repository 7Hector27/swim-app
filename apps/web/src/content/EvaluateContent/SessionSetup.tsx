"use client";

import type { ScreensResponse } from "@swim-app/shared";
import type { SessionDraft } from "./helpers";
import { todayLA } from "./helpers";

const BREATHING_OPTIONS = [
  { value: "every_1", label: "Every stroke" },
  { value: "every_2", label: "Every 2" },
  { value: "every_3", label: "Every 3" },
  { value: "every_4", label: "Every 4" },
  { value: "every_5", label: "Every 5" },
  { value: "other", label: "Other" },
] as const;

interface SessionSetupProps {
  draft: SessionDraft;
  screens: ScreensResponse;
  onScreenChange: (screenSlug: string) => void;
  onChange: (patch: Partial<SessionDraft>) => void;
}

export default function SessionSetup({ draft, screens, onScreenChange, onChange }: SessionSetupProps) {
  const needsBreathing = draft.screenSlug === "freestyle" || draft.screenSlug === "butterfly";

  return (
    <>
      {/* Screen */}
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
          Screen
        </legend>
        <select
          value={draft.screenSlug}
          onChange={(event) => onScreenChange(event.target.value)}
          className="border rounded px-3 py-2 text-sm min-h-[44px] max-w-xs"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
        >
          <option value="">Select screen…</option>
          {screens.map((screen) => (
            <option key={screen.screenSlug} value={screen.screenSlug}>{screen.name}</option>
          ))}
        </select>
      </fieldset>

      {/* Breathing pattern — only for freestyle and butterfly */}
      {needsBreathing && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
            Breathing pattern
          </legend>
          <div className="flex gap-2 flex-wrap">
            {BREATHING_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ breathingPattern: value })}
                className="min-h-[44px] px-4 rounded border text-sm font-semibold transition-colors"
                style={{
                  borderColor: draft.breathingPattern === value ? "var(--color-accent)" : "var(--color-border)",
                  color: draft.breathingPattern === value ? "var(--color-accent)" : "var(--color-text-secondary)",
                  backgroundColor: "transparent",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {draft.breathingPattern === null && (
            <p role="alert" className="text-xs text-danger">
              Required before submitting
            </p>
          )}
        </fieldset>
      )}

      {/* Session date */}
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
          Session date
        </legend>
        <input
          type="date"
          value={draft.sessionDate}
          onChange={(event) => onChange({ sessionDate: event.target.value })}
          className="border rounded px-3 py-2 text-sm min-h-[44px] max-w-xs"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
        />
        {draft.sessionDate === todayLA() && (
          <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            Session date is today — change it if rating from memory.
          </p>
        )}
      </fieldset>

      {/* Context */}
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
          Context
        </legend>
        <div className="flex gap-2 flex-wrap">
          {(["drill", "practice", "race"] as const)
            .filter((ctx) => !(draft.screenSlug === "water-confidence" && ctx === "race"))
            .map((ctx) => (
            <button
              key={ctx}
              type="button"
              onClick={() => onChange({ context: ctx })}
              className="min-h-[44px] px-4 rounded border text-sm font-semibold capitalize transition-colors"
              style={{
                borderColor: draft.context === ctx ? "var(--color-accent)" : "var(--color-border)",
                color: draft.context === ctx ? "var(--color-accent)" : "var(--color-text-secondary)",
                backgroundColor: "transparent",
              }}
            >
              {ctx}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}
