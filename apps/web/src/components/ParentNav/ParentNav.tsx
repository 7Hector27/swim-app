"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSession } from "@/components/Providers";
import ProfileMenu from "@/components/ProfileMenu";
import ThemeLogo from "@/components/ThemeLogo";
import ThemeToggle from "@/components/ThemeToggle";
import styles from "./ParentNav.module.css";

const ALL_NAV_LINKS = [
  { label: "Home", href: "/dashboard" },
  { label: "Book", href: "/dashboard/book" },
  { label: "Lessons", href: "/dashboard/lessons" },
  { label: "Progress", href: "/dashboard/progress" },
] as const;

type NavLinkLabel = (typeof ALL_NAV_LINKS)[number]["label"];

export function isLinkActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/dashboard/lessons") return pathname.startsWith("/dashboard/lessons");
  if (href === "/dashboard/progress") {
    return pathname === "/dashboard/progress" || pathname.startsWith("/dashboard/swimmers");
  }
  return pathname === href;
}

export function getVisibleLinks(isViewer: boolean) {
  return isViewer ? ALL_NAV_LINKS.filter((link) => link.href !== "/dashboard/book") : ALL_NAV_LINKS;
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

function BookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="2" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 7h6M7 10.5h6M7 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function LessonsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 2v4M13 2v4M3 9h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ProgressIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 15l4.5-5.5 3.5 3 4-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ICONS: Record<NavLinkLabel, () => React.ReactElement> = {
  Home: HomeIcon,
  Book: BookIcon,
  Lessons: LessonsIcon,
  Progress: ProgressIcon,
};

export default function ParentNav() {
  const { isViewer } = useSession();
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

  const visibleLinks = getVisibleLinks(isViewer);

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />

      {/* Sticky header */}
      <header
        className={`sticky top-0 z-50 bg-section text-text-on-section border-b transition-colors duration-200 ${
          scrolled ? "border-divider-section" : "border-transparent"
        }`}
      >
        <div className="mx-auto max-w-content px-page flex items-center justify-between h-16">
          <Link href="/" aria-label="Axiom Aquatics home">
            <ThemeLogo variant="auto" onDark />
          </Link>

          {/* Desktop center links — hidden on mobile */}
          <nav className="hidden tablet:flex items-center gap-1" aria-label="Parent navigation">
            {visibleLinks.map((link) => {
              const active = isLinkActive(link.href, pathname);
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
        className={`${styles.tabBar} tablet:hidden fixed bottom-0 inset-x-0 z-50 bg-section text-text-on-section border-t border-divider-section flex`}
        aria-label="Parent navigation"
      >
        {visibleLinks.map((link) => {
          const active = isLinkActive(link.href, pathname);
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
