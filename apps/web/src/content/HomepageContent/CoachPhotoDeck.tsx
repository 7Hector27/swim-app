"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

import styles from "./CoachPhotoDeck.module.css";

export interface CoachPhoto {
  src: string;
  alt: string;
}

interface Props {
  photos: CoachPhoto[];
}

const ADVANCE_MS = 5000;
const TRANSITION_MS = 420;
const FLASH_MS = 650;
const SWIPE_THRESHOLD_PX = 50;

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
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M12.5 15L7.5 10 12.5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M7.5 5L12.5 10 7.5 15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FlashPauseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1.5" fill="white" />
      <rect x="14" y="4" width="4" height="16" rx="1.5" fill="white" />
    </svg>
  );
}

function FlashPlayIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 4l14 8-14 8V4z" fill="white" />
    </svg>
  );
}

export default function CoachPhotoDeck({ photos }: Props) {
  const count = photos.length;
  const prefersReduced = usePrefersReducedMotion();

  const [topIndex, setTopIndex] = useState(0);
  const [exitingIndex, setExitingIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isPausedByUser, setIsPausedByUser] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [flashState, setFlashState] = useState<"pause" | "play" | null>(null);

  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchDeltaRef = useRef<number>(0);

  const isPaused = isPausedByUser || isHovered || isFocused || isTransitioning;

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null)
        clearTimeout(transitionTimerRef.current);
      if (flashTimerRef.current !== null)
        clearTimeout(flashTimerRef.current);
    };
  }, []);

  // Auto-advance — inlines the next-step logic to avoid stale closures
  useEffect(() => {
    if (prefersReduced || isPaused) return;
    const advanceId = setTimeout(() => {
      const newIndex = (topIndex + 1) % count;
      if (transitionTimerRef.current !== null)
        clearTimeout(transitionTimerRef.current);
      setExitingIndex(topIndex);
      setDirection("next");
      setIsTransitioning(true);
      setTopIndex(newIndex);
      transitionTimerRef.current = setTimeout(() => {
        setExitingIndex(null);
        setIsTransitioning(false);
      }, TRANSITION_MS);
    }, ADVANCE_MS);
    return () => clearTimeout(advanceId);
  }, [topIndex, isPaused, prefersReduced, count]);

  function beginTransition(newIndex: number, dir: "next" | "prev") {
    if (transitionTimerRef.current !== null)
      clearTimeout(transitionTimerRef.current);
    setExitingIndex(topIndex);
    setDirection(dir);
    setIsTransitioning(true);
    setTopIndex(newIndex);
    transitionTimerRef.current = setTimeout(() => {
      setExitingIndex(null);
      setIsTransitioning(false);
    }, TRANSITION_MS);
  }

  function advance(dir: "next" | "prev") {
    if (isTransitioning) return;
    const newIndex =
      dir === "next"
        ? (topIndex + 1) % count
        : (topIndex - 1 + count) % count;
    if (prefersReduced) {
      setTopIndex(newIndex);
      return;
    }
    beginTransition(newIndex, dir);
  }

  function triggerFlash(state: "pause" | "play") {
    if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
    setFlashState(state);
    flashTimerRef.current = setTimeout(() => {
      setFlashState(null);
    }, FLASH_MS);
  }

  function handlePhotoClick() {
    setIsPausedByUser((previous) => {
      const next = !previous;
      triggerFlash(next ? "pause" : "play");
      return next;
    });
  }

  function handlePrevClick(e: React.MouseEvent) {
    e.stopPropagation();
    advance("prev");
  }

  function handleNextClick(e: React.MouseEvent) {
    e.stopPropagation();
    advance("next");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      advance("prev");
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      advance("next");
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    if (touch !== undefined) {
      touchStartXRef.current = touch.clientX;
      touchDeltaRef.current = 0;
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartXRef.current === null) return;
    const touch = e.changedTouches[0];
    if (touch !== undefined) {
      touchDeltaRef.current = touch.clientX - touchStartXRef.current;
    }
    const delta = touchDeltaRef.current;
    touchStartXRef.current = null;

    if (Math.abs(delta) >= SWIPE_THRESHOLD_PX) {
      advance(delta < 0 ? "next" : "prev");
    } else {
      // Short tap — toggle pause
      handlePhotoClick();
    }
  }

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
      onKeyDown={handleKeyDown}
    >
      {/* ── Photo area ─────────────────────────────────── */}
      <div className={styles.photoArea}>
        {/* Photos */}
        <div
          className={styles.photoWrapper}
          aria-live="polite"
          aria-atomic="true"
        >
          {photos.map((photo, index) => {
            const isActive = index === topIndex;
            const isExiting = index === exitingIndex;

            let photoClass = styles.photo;
            if (isExiting) {
              photoClass +=
                direction === "next"
                  ? ` ${styles.photoExitNext}`
                  : ` ${styles.photoExitPrev}`;
            } else if (isActive && isTransitioning) {
              photoClass +=
                direction === "next"
                  ? ` ${styles.photoEnterNext}`
                  : ` ${styles.photoEnterPrev}`;
            } else if (isActive) {
              photoClass += ` ${styles.photoActive}`;
            }

            return (
              <div key={photo.src} className={photoClass}>
                <Image
                  src={photo.src}
                  alt={isActive ? photo.alt : ""}
                  fill
                  sizes="(min-width: 1248px) 400px, 100vw"
                  className={`${styles.image}${isActive && !prefersReduced ? ` ${styles.imageKenBurns}` : ""}`}
                  priority={index === 0}
                />
                {isActive && !prefersReduced && (
                  <div className={styles.causticOverlay} aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>

        {/* Pause/play toggle — covers the full photo, z-index 1 */}
        <button
          type="button"
          className={styles.photoToggle}
          aria-label={isPausedByUser ? "Play slideshow" : "Pause slideshow"}
          aria-pressed={isPausedByUser}
          onClick={handlePhotoClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        />

        {/* Flash icon — shown briefly after toggle */}
        {flashState !== null && (
          <div
            className={`${styles.flashIcon}${prefersReduced ? ` ${styles.flashIconReduced}` : ""}`}
            aria-hidden="true"
          >
            {flashState === "pause" ? <FlashPauseIcon /> : <FlashPlayIcon />}
          </div>
        )}

        {/* Prev arrow — z-index 2, sits above the toggle */}
        <button
          type="button"
          aria-label="Previous photo"
          className={`${styles.arrow} ${styles.arrowPrev}`}
          onClick={handlePrevClick}
        >
          <PrevIcon />
        </button>

        {/* Next arrow — z-index 2 */}
        <button
          type="button"
          aria-label="Next photo"
          className={`${styles.arrow} ${styles.arrowNext}`}
          onClick={handleNextClick}
        >
          <NextIcon />
        </button>
      </div>
    </div>
  );
}
