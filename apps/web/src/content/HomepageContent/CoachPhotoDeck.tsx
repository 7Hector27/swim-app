"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import styles from "./CoachPhotoDeck.module.css";

export interface CoachPhoto {
  src: string;
  alt: string;
}

interface Props {
  photos: CoachPhoto[];
}

const TILTS = [1, -3, 4, -2]; // degrees per stack position, top to back
const DEPTH_PX = 5; // translateY per depth level
const CARD_W = 280;
const CARD_H = 350;
const ADVANCE_MS = 6000;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

function PrevIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M11 13.5L6.5 9 11 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M7 4.5L11.5 9 7 13.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="4.5" y="3.5" width="3" height="11" rx="1" fill="currentColor" />
      <rect x="10.5" y="3.5" width="3" height="11" rx="1" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M6 3.5l9 5.5-9 5.5V3.5z" fill="currentColor" />
    </svg>
  );
}

export default function CoachPhotoDeck({ photos }: Props) {
  const count = photos.length;
  const prefersReduced = usePrefersReducedMotion();

  const [topIndex, setTopIndex] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [isPausedByUser, setIsPausedByUser] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [returningIndex, setReturningIndex] = useState<number | null>(null);

  const isPaused = isPausedByUser || isHovered || isFocused || isExiting;

  function advance(dir: "next" | "prev") {
    if (isExiting) return;
    if (prefersReduced) {
      setTopIndex((prev) =>
        dir === "next" ? (prev + 1) % count : (prev - 1 + count) % count,
      );
      return;
    }
    setDirection(dir);
    setIsExiting(true);
  }

  function handleTransitionEnd(exitedIndex: number, propertyName: string) {
    if (propertyName !== "transform" || !isExiting) return;
    const newTop =
      direction === "next"
        ? (exitedIndex + 1) % count
        : (exitedIndex - 1 + count) % count;
    setReturningIndex(exitedIndex);
    setTopIndex(newTop);
    setIsExiting(false);
    // Double rAF: let React commit the snap position before re-enabling transition
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setReturningIndex(null));
    });
  }

  useEffect(() => {
    if (prefersReduced || isPaused) return;
    const id = setTimeout(() => {
      setDirection("next");
      setIsExiting(true);
    }, ADVANCE_MS);
    return () => clearTimeout(id);
  }, [topIndex, isPaused, prefersReduced]);

  return (
    <div
      data-testid="coach-photo-deck"
      className={styles.root}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsFocused(false);
        }
      }}
    >
      <div className={styles.deck} aria-live="polite" aria-atomic="true">
        {photos.map((photo, index) => {
          const position = (index - topIndex + count) % count;
          const tilt = TILTS[position % TILTS.length] ?? 0;
          const depthY = position * DEPTH_PX;
          const isTop = position === 0;
          const isExitingCard = isTop && isExiting;
          const isReturning = index === returningIndex;

          let transform: string;
          if (isExitingCard) {
            transform =
              direction === "next"
                ? `translateX(110%) rotate(15deg)`
                : `translateX(-110%) rotate(-15deg)`;
          } else {
            transform = `rotate(${tilt}deg) translateY(${depthY}px)`;
          }

          return (
            <div
              key={photo.src}
              className={`${styles.card}${isReturning ? ` ${styles.cardNoTransition}` : ""}`}
              style={{ zIndex: count - position, transform }}
              onTransitionEnd={
                isTop && isExiting
                  ? (e) => handleTransitionEnd(index, e.propertyName)
                  : undefined
              }
            >
              <Image
                src={photo.src}
                alt={isTop ? photo.alt : ""}
                width={CARD_W}
                height={CARD_H}
                className={styles.image}
                priority={false}
              />
            </div>
          );
        })}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          aria-label="Previous photo"
          onClick={() => advance("prev")}
          className={styles.controlButton}
        >
          <PrevIcon />
        </button>

        <button
          type="button"
          aria-label={isPausedByUser ? "Play slideshow" : "Pause slideshow"}
          aria-pressed={isPausedByUser}
          onClick={() => setIsPausedByUser((previous) => !previous)}
          className={styles.controlButton}
        >
          {isPausedByUser ? <PlayIcon /> : <PauseIcon />}
        </button>

        <button
          type="button"
          aria-label="Next photo"
          onClick={() => advance("next")}
          className={styles.controlButton}
        >
          <NextIcon />
        </button>
      </div>
    </div>
  );
}
