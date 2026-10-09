"use client";

import { useEffect, useRef } from "react";

export default function HeroWaterBg() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const animatedElements =
          container.querySelectorAll<HTMLElement>(".hero-animated");
        const state =
          entry !== undefined && entry.isIntersecting ? "running" : "paused";
        animatedElements.forEach((element) => {
          element.style.animationPlayState = state;
        });
      },
      { threshold: 0 },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const laneCount = 7;
  const bubbles = [
    { cx: 8, cy: 95, r: 5, delay: 0, duration: 13 },
    { cx: 18, cy: 110, r: 3, delay: 2.5, duration: 17 },
    { cx: 32, cy: 80, r: 4, delay: 1, duration: 14 },
    { cx: 45, cy: 100, r: 6, delay: 4, duration: 11 },
    { cx: 55, cy: 90, r: 3, delay: 6, duration: 16 },
    { cx: 68, cy: 115, r: 5, delay: 3, duration: 12 },
    { cx: 78, cy: 85, r: 4, delay: 5.5, duration: 15 },
    { cx: 88, cy: 105, r: 3, delay: 1.5, duration: 17 },
    { cx: 92, cy: 95, r: 6, delay: 7, duration: 13 },
    { cx: 22, cy: 70, r: 4, delay: 8, duration: 14 },
    { cx: 38, cy: 88, r: 3, delay: 2, duration: 16 },
    { cx: 62, cy: 78, r: 5, delay: 9, duration: 11 },
    { cx: 75, cy: 108, r: 4, delay: 4.5, duration: 15 },
    { cx: 85, cy: 72, r: 3, delay: 6.5, duration: 17 },
    { cx: 12, cy: 118, r: 5, delay: 3.5, duration: 12 },
  ];

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none overflow-hidden"
    >
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes bubble-rise {
            0% { transform: translateY(0) translateX(0); opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { transform: translateY(-120px) translateX(8px); opacity: 0; }
          }
          @keyframes wave-drift-1 {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
          @keyframes wave-drift-2 {
            0% { transform: translateX(-50%); }
            100% { transform: translateX(0); }
          }
          .hero-animated.bubble-anim {
            animation-name: bubble-rise;
            animation-timing-function: ease-in-out;
            animation-iteration-count: infinite;
            animation-play-state: running;
          }
          .hero-animated.wave-anim-1 {
            animation: wave-drift-1 22s linear infinite;
            animation-play-state: running;
          }
          .hero-animated.wave-anim-2 {
            animation: wave-drift-2 30s linear infinite;
            animation-play-state: running;
          }
        }
      `}</style>

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        {Array.from({ length: laneCount }, (_, index) => {
          const yPercent = ((index + 1) / (laneCount + 1)) * 100;
          return (
            <line
              key={`lane-${index}`}
              x1="0"
              y1={yPercent}
              x2="100"
              y2={yPercent}
              stroke="var(--color-accent)"
              strokeOpacity="0.10"
              strokeWidth="0.4"
              strokeDasharray="2 3"
            />
          );
        })}

        {bubbles.slice(0, 8).map((bubble, index) => (
          <circle
            key={`bubble-mobile-${index}`}
            cx={bubble.cx}
            cy={bubble.cy}
            r={bubble.r * 0.4}
            fill="none"
            stroke="var(--color-accent)"
            strokeOpacity="0.18"
            strokeWidth="0.3"
            className="hero-animated bubble-anim"
            style={{
              animationDuration: `${bubble.duration}s`,
              animationDelay: `${bubble.delay}s`,
            }}
          />
        ))}

        <g className="hidden tablet:block">
          {bubbles.slice(8).map((bubble, index) => (
            <circle
              key={`bubble-tablet-${index}`}
              cx={bubble.cx}
              cy={bubble.cy}
              r={bubble.r * 0.4}
              fill="none"
              stroke="var(--color-accent)"
              strokeOpacity="0.18"
              strokeWidth="0.3"
              className="hero-animated bubble-anim"
              style={{
                animationDuration: `${bubble.duration}s`,
                animationDelay: `${bubble.delay}s`,
              }}
            />
          ))}
        </g>
      </svg>

      <div className="absolute inset-0 w-full h-full">
        <svg
          viewBox="0 0 200 20"
          preserveAspectRatio="none"
          className="hero-animated wave-anim-1 absolute bottom-8 left-0 h-16 tablet:h-24"
          style={{ width: "200%" }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0,10 C25,0 50,20 75,10 C100,0 125,20 150,10 C175,0 200,20 200,10 L200,20 L0,20 Z"
            fill="var(--color-accent)"
            fillOpacity="0.09"
          />
        </svg>
        <svg
          viewBox="0 0 200 20"
          preserveAspectRatio="none"
          className="hero-animated wave-anim-2 absolute bottom-4 left-0 h-10 tablet:h-16"
          style={{ width: "200%" }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0,12 C30,2 60,18 90,10 C120,2 150,18 180,10 C195,6 200,14 200,12 L200,20 L0,20 Z"
            fill="var(--color-accent)"
            fillOpacity="0.06"
          />
        </svg>
      </div>
    </div>
  );
}
