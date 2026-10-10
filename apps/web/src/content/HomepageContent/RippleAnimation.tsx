// translateX uses fixed px (not %) so narrow bars get the same travel as wide ones.
// scaleX differs between from/to so width also pulses gently.
const bars = [
  { width: "100%", color: "ink",    duration: 4.6, delay: 0,    xPx: 14, sxFrom: 1.02, sxTo: 0.98 },
  { width: "84%",  color: "accent", duration: 5.4, delay: -1.2, xPx: 18, sxFrom: 0.97, sxTo: 1.03 },
  { width: "92%",  color: "ink",    duration: 6.2, delay: -0.5, xPx: 12, sxFrom: 1.03, sxTo: 0.98 },
  { width: "66%",  color: "accent", duration: 5.0, delay: -2.1, xPx: 20, sxFrom: 0.96, sxTo: 1.04 },
  { width: "74%",  color: "ink",    duration: 6.6, delay: -0.8, xPx: 16, sxFrom: 1.04, sxTo: 0.97 },
  { width: "48%",  color: "accent", duration: 4.9, delay: -1.7, xPx: 22, sxFrom: 0.98, sxTo: 1.03 },
  { width: "54%",  color: "ink",    duration: 5.8, delay: -0.3, xPx: 14, sxFrom: 1.02, sxTo: 0.97 },
  { width: "30%",  color: "accent", duration: 6.1, delay: -2.4, xPx: 18, sxFrom: 0.97, sxTo: 1.03 },
];

export default function RippleAnimation() {
  return (
    <div className="flex flex-col items-center gap-[7px] w-full" aria-hidden="true">
      <style>{`
        @media (prefers-reduced-motion: reduce) { .ripple-bar { animation: none !important; } }
        ${bars
          .map(
            (bar, i) =>
              `@keyframes ripple-sway-${i} {
                from { transform: translateX(-${bar.xPx}px) scaleX(${bar.sxFrom}); }
                to   { transform: translateX(${bar.xPx}px)  scaleX(${bar.sxTo});   }
              }`,
          )
          .join(" ")}
      `}</style>
      {bars.map((bar, index) => (
        <div
          key={index}
          className={`ripple-bar h-[6px] rounded-[4px] ${bar.color === "accent" ? "bg-accent" : "bg-ink"}`}
          style={{
            width: bar.width,
            opacity: 1 - index * 0.1,
            animation: `ripple-sway-${index} ${bar.duration}s ${bar.delay}s ease-in-out infinite alternate`,
          }}
        />
      ))}
    </div>
  );
}
