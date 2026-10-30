"use client";

import type { ScreensResponse } from "@swim-app/shared";
import type { EvaluateFieldIssue, SessionDraft } from "./helpers";
import { DOM_IDS, todayLA } from "./helpers";

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
  issues?: EvaluateFieldIssue[];
  // ADR 032: in edit mode the screen is immutable at the DB layer. We hide
  // the select and show the resolved screen name as a read-only pill.
  screenLockedName?: string;
}

export default function SessionSetup({
  draft,
  screens,
  onScreenChange,
  onChange,
  issues = [],
  screenLockedName,
}: SessionSetupProps) {
  const needsBreathing = draft.screenSlug === "freestyle" || draft.screenSlug === "butterfly";
  const screenIssue = issues.find((issue) => issue.field === "screenSlug");
  const breathingIssue = issues.find((issue) => issue.field === "breathingPattern");
  const sessionDateIssue = issues.find((issue) => issue.field === "sessionDate");
  const contextIssue = issues.find((issue) => issue.field === "context");

  return (
    <>
      {/* Screen */}
      <fieldset id={DOM_IDS.screenSlug} className="flex flex-col gap-2">
        <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
          Screen
        </legend>
        {screenLockedName !== undefined ? (
          <span
            data-testid="session-setup-screen-pill"
            className="inline-flex items-center min-h-[44px] px-3 py-1 rounded-[var(--radius-button)] border text-sm font-semibold max-w-fit"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
              backgroundColor: "var(--color-background)",
            }}
          >
            {screenLockedName}
          </span>
        ) : (
          <>
            <select
              value={draft.screenSlug}
              onChange={(event) => onScreenChange(event.target.value)}
              aria-invalid={screenIssue !== undefined || undefined}
              aria-describedby={screenIssue ? `${DOM_IDS.screenSlug}-error` : undefined}
              className="border rounded px-3 py-2 text-sm min-h-[44px] max-w-xs"
              style={{
                borderColor: screenIssue ? "var(--color-danger)" : "var(--color-border)",
                color: "var(--color-text)",
                backgroundColor: "transparent",
              }}
            >
              <option value="">Select screen...</option>
              {screens.map((screen) => (
                <option key={screen.screenSlug} value={screen.screenSlug}>{screen.name}</option>
              ))}
            </select>
            {screenIssue && (
              <p id={`${DOM_IDS.screenSlug}-error`} className="text-xs" style={{ color: "var(--color-danger)" }}>
                {screenIssue.message}
              </p>
            )}
          </>
        )}
      </fieldset>

      {/* Breathing pattern (freestyle, butterfly) */}
      {needsBreathing && (
        <fieldset id={DOM_IDS.breathingPattern} className="flex flex-col gap-2">
          <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
            Breathing pattern
          </legend>
          <div
            className="flex gap-2 flex-wrap"
            role="group"
            aria-invalid={breathingIssue !== undefined || undefined}
            aria-describedby={breathingIssue ? `${DOM_IDS.breathingPattern}-error` : undefined}
          >
            {BREATHING_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ breathingPattern: value })}
                className="min-h-[44px] px-4 rounded border text-sm font-semibold transition-colors"
                style={{
                  borderColor: draft.breathingPattern === value
                    ? "var(--color-accent)"
                    : breathingIssue
                      ? "var(--color-danger)"
                      : "var(--color-border)",
                  color: draft.breathingPattern === value ? "var(--color-accent)" : "var(--color-text-secondary)",
                  backgroundColor: "transparent",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {breathingIssue && (
            <p id={`${DOM_IDS.breathingPattern}-error`} className="text-xs" style={{ color: "var(--color-danger)" }}>
              {breathingIssue.message}
            </p>
          )}
        </fieldset>
      )}

      {/* Session date */}
      <fieldset id={DOM_IDS.sessionDate} className="flex flex-col gap-2">
        <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
          Session date
        </legend>
        <input
          type="date"
          value={draft.sessionDate}
          onChange={(event) => onChange({ sessionDate: event.target.value })}
          aria-invalid={sessionDateIssue !== undefined || undefined}
          aria-describedby={sessionDateIssue ? `${DOM_IDS.sessionDate}-error` : undefined}
          className="border rounded px-3 py-2 text-sm min-h-[44px] max-w-xs"
          style={{
            borderColor: sessionDateIssue ? "var(--color-danger)" : "var(--color-border)",
            color: "var(--color-text)",
            backgroundColor: "transparent",
          }}
        />
        {sessionDateIssue && (
          <p id={`${DOM_IDS.sessionDate}-error`} className="text-xs" style={{ color: "var(--color-danger)" }}>
            {sessionDateIssue.message}
          </p>
        )}
        {!sessionDateIssue && draft.sessionDate === todayLA() && (
          <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            Session date is today. Change it if rating from memory.
          </p>
        )}
      </fieldset>

      {/* Context */}
      <fieldset id={DOM_IDS.context} className="flex flex-col gap-2">
        <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
          Context
        </legend>
        <div
          className="flex gap-2 flex-wrap"
          role="group"
          aria-invalid={contextIssue !== undefined || undefined}
          aria-describedby={contextIssue ? `${DOM_IDS.context}-error` : undefined}
        >
          {(["drill", "practice", "race"] as const)
            .filter((ctx) => !(draft.screenSlug === "water-confidence" && ctx === "race"))
            .map((ctx) => (
            <button
              key={ctx}
              type="button"
              onClick={() => onChange({ context: ctx })}
              className="min-h-[44px] px-4 rounded border text-sm font-semibold capitalize transition-colors"
              style={{
                borderColor: draft.context === ctx
                  ? "var(--color-accent)"
                  : contextIssue
                    ? "var(--color-danger)"
                    : "var(--color-border)",
                color: draft.context === ctx ? "var(--color-accent)" : "var(--color-text-secondary)",
                backgroundColor: "transparent",
              }}
            >
              {ctx}
            </button>
          ))}
        </div>
        {contextIssue && (
          <p id={`${DOM_IDS.context}-error`} className="text-xs" style={{ color: "var(--color-danger)" }}>
            {contextIssue.message}
          </p>
        )}
      </fieldset>
    </>
  );
}
