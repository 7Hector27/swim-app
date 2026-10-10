"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./ScrollFadeArea.module.css";

type ScrollState = "none" | "top" | "bottom" | "both";

function getMask(state: ScrollState): string {
  const fadeSize = "40px";
  const fadeTop = `linear-gradient(to bottom, transparent, black ${fadeSize})`;
  const fadeBottom = `linear-gradient(to top, transparent, black ${fadeSize})`;
  if (state === "both") return `${fadeTop}, ${fadeBottom}`;
  if (state === "top") return fadeBottom;
  if (state === "bottom") return fadeTop;
  return "";
}

interface ScrollFadeAreaProps {
  label: string;
  children: React.ReactNode;
}

export default function ScrollFadeArea({ label, children }: ScrollFadeAreaProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState<ScrollState>("none");

  function updateState() {
    const el = ref.current;
    if (!el) return;
    const canScrollUp = el.scrollTop > 1;
    const canScrollDown = el.scrollTop < el.scrollHeight - el.clientHeight - 1;
    if (canScrollUp && canScrollDown) setScrollState("both");
    else if (canScrollUp) setScrollState("top");
    else if (canScrollDown) setScrollState("bottom");
    else setScrollState("none");
  }

  useEffect(() => {
    updateState();
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(updateState);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const mask = getMask(scrollState);
  const maskStyle = mask
    ? ({ maskImage: mask, WebkitMaskImage: mask } as React.CSSProperties)
    : undefined;

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      tabIndex={0}
      onScroll={updateState}
      className={`h-72 overflow-y-auto focus-visible:outline-2 focus-visible:outline-offset-2 ${styles.scrollArea}`}
      style={maskStyle}
    >
      {children}
    </div>
  );
}
