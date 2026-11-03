"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { useSession } from "@/components/Providers";
import ProfileMenu from "@/components/ProfileMenu";
import ThemeLogo from "@/components/ThemeLogo";
import ThemeToggle from "@/components/ThemeToggle";

export default function SiteNav() {
  const { isSignedIn } = useSession();
  const [scrolled, setScrolled] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setScrolled(entry !== undefined && !entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <nav
        className={`sticky top-0 z-50 bg-section text-text-on-section border-b transition-colors duration-200 ${scrolled ? "border-divider-section" : "border-transparent"}`}
      >
        <div className="mx-auto max-w-content px-page flex items-center justify-between h-[var(--header-height)]">
          <Link href="/" aria-label="Axiom Aquatics home">
            <ThemeLogo variant="auto" onDark />
          </Link>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            {isSignedIn ? (
              <ProfileMenu />
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-button bg-accent-on-section text-on-accent font-bold text-sm px-5 h-11 transition-opacity duration-200 hover:opacity-90 active:scale-[0.97]"
              >
                Log in
              </Link>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}
