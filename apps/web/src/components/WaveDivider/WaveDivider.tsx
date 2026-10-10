type SurfaceColor = "background" | "section" | "surface-soft";

interface WaveDividerProps {
  from: SurfaceColor;
  to: SurfaceColor;
}

const surfaceVar: Record<SurfaceColor, string> = {
  background: "var(--color-background)",
  section: "var(--color-section)",
  "surface-soft": "var(--color-surface-soft)",
};

// Main wave contour: midpoint y=28, troughs y=56, peaks y=0
const MAIN_WAVE =
  "M0,28 C240,56 480,0 720,28 C960,56 1200,0 1440,28 L1440,56 L0,56 Z";

// Accent wave: same curve shifted up 8px so a stripe peeks from behind the main wave
const ACCENT_WAVE =
  "M0,20 C240,48 480,-8 720,20 C960,48 1200,-8 1440,20 L1440,56 L0,56 Z";

export default function WaveDivider({ from, to }: WaveDividerProps) {
  const fromColor = surfaceVar[from];
  const toColor = surfaceVar[to];
  const isDualWave = from === "background" && to === "section";

  return (
    <div
      aria-hidden="true"
      className="relative w-full overflow-hidden h-14 tablet:h-20 desktop:h-[110px]"
      style={{ background: fromColor }}
    >
      <svg
        viewBox="0 0 1440 56"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        className="absolute bottom-0 left-0 w-full h-full"
      >
        {isDualWave && (
          <path d={ACCENT_WAVE} fill="var(--color-accent)" />
        )}
        <path d={MAIN_WAVE} fill={toColor} />
      </svg>
    </div>
  );
}
