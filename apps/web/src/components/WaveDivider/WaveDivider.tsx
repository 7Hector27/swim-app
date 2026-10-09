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

export default function WaveDivider({ from, to }: WaveDividerProps) {
  const fromColor = surfaceVar[from];
  const toColor = surfaceVar[to];

  return (
    <div
      aria-hidden="true"
      className="relative w-full overflow-hidden h-14 tablet:h-20 desktop:h-[110px]"
      style={{ background: fromColor }}
    >
      <div className="absolute inset-0">
        <svg
          viewBox="0 0 1440 56"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          className="absolute bottom-0 left-0 w-full h-full"
        >
          <path
            d="M0,28 C240,56 480,0 720,28 C960,56 1200,0 1440,28 L1440,56 L0,56 Z"
            fill={toColor}
          />
          <path
            d="M0,38 C180,20 360,50 540,35 C720,20 900,48 1080,36 C1260,24 1380,44 1440,40 L1440,56 L0,56 Z"
            fill="var(--color-accent)"
            fillOpacity="0.10"
          />
        </svg>
      </div>
    </div>
  );
}
