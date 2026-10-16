"use client";

import type { CategoriesResponse } from "@swim-app/shared";
import type { SessionDraft } from "./helpers";
import { todayLA } from "./helpers";

interface SessionSetupProps {
  draft: SessionDraft;
  categories: CategoriesResponse;
  onCategoryChange: (categoryId: string) => void;
  onChange: (patch: Partial<SessionDraft>) => void;
}

export default function SessionSetup({ draft, categories, onCategoryChange, onChange }: SessionSetupProps) {
  return (
    <>
      {/* Category */}
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
          Category
        </legend>
        <select
          value={draft.categoryId}
          onChange={(event) => onCategoryChange(event.target.value)}
          className="border rounded px-3 py-2 text-sm min-h-[44px] max-w-xs"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
        >
          <option value="">Select category…</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
      </fieldset>

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
          {(["drill", "practice", "race"] as const).map((ctx) => (
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
