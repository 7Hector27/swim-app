"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

import styles from "./ThemeToggle.module.css";

function SunIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.5" />
      <line x1="10" y1="1" x2="10" y2="3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="10" y1="16.5" x2="10" y2="19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="1" y1="10" x2="3.5" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16.5" y1="10" x2="19" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3.05" y1="3.05" x2="4.82" y2="4.82" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="15.18" y1="15.18" x2="16.95" y2="16.95" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3.05" y1="16.95" x2="4.82" y2="15.18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="15.18" y1="4.82" x2="16.95" y2="3.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M17 11.5A7.5 7.5 0 1 1 8.5 3a5.5 5.5 0 0 0 8.5 8.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = theme === "dark";

  function handleToggle() {
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex items-center justify-center w-10 h-10 rounded-button bg-icon-button-background text-heading hover:opacity-80 transition-opacity duration-150"
    >
      {mounted ? (
        <span key={isDark ? "sun" : "moon"} className={styles.icon}>
          {isDark ? <SunIcon /> : <MoonIcon />}
        </span>
      ) : (
        <MoonIcon />
      )}
    </button>
  );
}
