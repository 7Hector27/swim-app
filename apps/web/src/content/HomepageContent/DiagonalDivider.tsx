type Surface = "background" | "section" | "surface-soft";

interface DiagonalDividerProps {
  from: Surface;
  to: Surface;
  direction?: "ascending" | "descending";
}

const surfaceClass: Record<Surface, string> = {
  background: "bg-background",
  section: "bg-section",
  "surface-soft": "bg-surface-soft",
};

// ascending (/): from-color is thick on left, thin on right — line rises L→R
// descending (\): from-color is thin on left, thick on right — line falls L→R
const clipPath: Record<"ascending" | "descending", string> = {
  ascending: "polygon(0% 0%, 100% 0%, 100% 20%, 0% 80%)",
  descending: "polygon(0% 0%, 100% 0%, 100% 80%, 0% 20%)",
};

export default function DiagonalDivider({
  from,
  to,
  direction = "ascending",
}: DiagonalDividerProps) {
  return (
    <div
      className={`relative overflow-hidden ${surfaceClass[to]}`}
      style={{ height: "clamp(52px, 6vw, 96px)" }}
      aria-hidden="true"
    >
      <div
        className={`absolute inset-0 ${surfaceClass[from]}`}
        style={{ clipPath: clipPath[direction] }}
      />
    </div>
  );
}
