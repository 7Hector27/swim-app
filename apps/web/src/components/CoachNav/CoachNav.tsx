"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import ProfileMenu from "@/components/ProfileMenu";
import ThemeLogo from "@/components/ThemeLogo";
import ThemeToggle from "@/components/ThemeToggle";
import styles from "./CoachNav.module.css";

const NAV_LINKS = [
  { label: "Home", href: "/dashboard" },
  { label: "Schedule", href: "/coach/schedule" },
  { label: "Availability", href: "/coach/availability" },
  { label: "Swimmers", href: "/coach/swimmers" },
  { label: "Meets", href: "/coach/meets" },
] as const;

type NavLinkLabel = (typeof NAV_LINKS)[number]["label"];

export function isCoachLinkActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 9L10 3l7 6v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M7.5 18v-6h5v6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 2v4M13 2v4M3 9h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AvailabilityIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v4l2.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SwimmersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="7" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M2 16c0-2.761 2.239-5 5-5s5 2.239 5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="14" cy="5" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M18 15c0-2.209-1.791-4-4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MeetsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="15" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const ICONS: Record<NavLinkLabel, () => React.ReactElement> = {
  Home: HomeIcon,
  Schedule: ScheduleIcon,
  Availability: AvailabilityIcon,
  Swimmers: SwimmersIcon,
  Meets: MeetsIcon,
};

export default function CoachNav() {
  const pathname = usePathname();
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

      {/* Sticky header */}
      <header
        className={`sticky top-0 z-50 bg-section border-b transition-colors duration-200 ${
          scrolled ? "border-divider-section" : "border-transparent"
        }`}
      >
        <div className="mx-auto max-w-content px-page flex items-center justify-between h-16">
          <Link href="/" aria-label="Axiom Aquatics home">
            <ThemeLogo variant="auto" onDark />
          </Link>

          {/* Desktop center links — hidden on mobile */}
          <nav className="hidden tablet:flex items-center gap-1" aria-label="Coach navigation">
            {NAV_LINKS.map((link) => {
              const active = isCoachLinkActive(link.href, pathname);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex items-center justify-center h-11 px-4 text-sm font-semibold rounded-button transition-colors duration-150 ${
                    active
                      ? "text-accent-on-section"
                      : "text-text-secondary-on-section hover:text-text-on-section"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <ProfileMenu />
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar — hidden on tablet+ */}
      <nav
        className={`${styles.tabBar} tablet:hidden fixed bottom-0 inset-x-0 z-50 bg-section border-t border-divider-section flex`}
        aria-label="Coach navigation"
      >
        {NAV_LINKS.map((link) => {
          const active = isCoachLinkActive(link.href, pathname);
          const Icon = ICONS[link.label];
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`${styles.tabItem} flex flex-col items-center justify-center gap-1 flex-1 text-xs font-semibold transition-colors duration-150 ${
                active ? "text-accent-on-section" : "text-text-secondary-on-section"
              }`}
            >
              <Icon />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
