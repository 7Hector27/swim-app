"use client";

interface CoachingPriorityFieldProps {
  value: string;
  onChange: (value: string) => void;
  suggestion:
    | { status: "idle" | "loading" | "error" }
    | { status: "loaded"; chain: Array<{ slug: string }> | null };
  slugToName: Record<string, string>;
}

export default function CoachingPriorityField({ value, onChange, suggestion, slugToName }: CoachingPriorityFieldProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
        Coaching priority
      </legend>
      {suggestion.status === "loading" && (
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Loading suggestion…</p>
      )}
      {suggestion.status === "loaded" && suggestion.chain !== null && suggestion.chain.length > 0 && (
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          Suggestion: Focus on{" "}
          <strong style={{ color: "var(--color-text)" }}>
            {(() => {
              const lastSlug = suggestion.chain[suggestion.chain.length - 1]?.slug ?? "";
              return slugToName[lastSlug] ?? lastSlug;
            })()}
          </strong>
        </p>
      )}
      {suggestion.status === "loaded" && (suggestion.chain === null || suggestion.chain.length === 0) && (
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          All assessed skills are at expected levels
        </p>
      )}
      {suggestion.status === "error" && (
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          Not assessed yet — check individually
        </p>
      )}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        aria-required="true"
        placeholder="What is the main focus for this swimmer?"
        className="border rounded px-3 py-2 text-sm resize-y"
        style={{ borderColor: "var(--color-border)", color: "var(--color-text)", backgroundColor: "transparent" }}
      />
    </fieldset>
  );
}
