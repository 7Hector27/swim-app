"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import CoachNotificationBell from "@/components/CoachNotificationBell";
import ProfileMenu from "@/components/ProfileMenu";
import ThemeLogo from "@/components/ThemeLogo";
import ThemeToggle from "@/components/ThemeToggle";
import { logout } from "@/lib/logout";
import styles from "./CoachNav.module.css";

// ── Configuration — change tabs and sheet items here ─────────────────────────

const BOTTOM_NAV_TABS = [
  { label: "Home", href: "/dashboard" },
  { label: "Schedule", href: "/coach/schedule" },
  { label: "Swimmers", href: "/coach/swimmers" },
] as const;

const MORE_SHEET_ITEMS = [
  { label: "Meets", href: "/coach/meets" },
  { label: "Availability", href: "/coach/availability" },
  { label: "Account settings", href: "/account" },
] as const;

// Desktop header shows all destinations
const DESKTOP_NAV_LINKS = [
  { label: "Home", href: "/dashboard" },
  { label: "Schedule", href: "/coach/schedule" },
  { label: "Availability", href: "/coach/availability" },
  { label: "Swimmers", href: "/coach/swimmers" },
  { label: "Meets", href: "/coach/meets" },
] as const;

// ── Active-state helper ───────────────────────────────────────────────────────

export function isCoachLinkActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

function isMoreActive(pathname: string | null): boolean {
  return MORE_SHEET_ITEMS.some((item) => isCoachLinkActive(item.href, pathname));
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
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
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 2v4M13 2v4M3 9h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SwimmersIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
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

function MoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="5" cy="10" r="1.5" fill="currentColor" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
      <circle cx="15" cy="10" r="1.5" fill="currentColor" />
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

function MeetsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="15" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

type TabLabel = (typeof BOTTOM_NAV_TABS)[number]["label"];

const TAB_ICONS: Record<TabLabel, () => React.ReactElement> = {
  Home: HomeIcon,
  Schedule: ScheduleIcon,
  Swimmers: SwimmersIcon,
};

// ── More sheet ────────────────────────────────────────────────────────────────

const SHEET_ICONS: Record<string, () => React.ReactElement> = {
  Meets: MeetsIcon,
  Availability: AvailabilityIcon,
};

interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
}

function MoreSheet({ open, onClose }: MoreSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const clickedOutside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;
    if (clickedOutside) onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  // Hidden logout form so the submit button can target it
  return (
    <>
      <form id="coach-nav-logout-form" action={logout} className="hidden" />
      <dialog
        ref={dialogRef}
        className={styles.moreSheet}
        onClick={handleBackdropClick}
        onKeyDown={handleKeyDown}
        aria-label="More navigation options"
      >
        <div className={styles.moreSheetInner}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-divider-section">
            <span className="text-sm font-semibold text-text-on-section">More</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex items-center justify-center w-10 h-10 rounded-button text-text-secondary-on-section hover:text-text-on-section transition-colors duration-150"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <nav aria-label="More options">
            <ul>
              {MORE_SHEET_ITEMS.map((item) => {
                const Icon = SHEET_ICONS[item.label];
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className="flex items-center gap-4 px-5 h-14 text-sm font-semibold text-text-on-section hover:bg-section-item-hover transition-colors duration-150"
                    >
                      {Icon && (
                        <span className="text-text-secondary-on-section">
                          <Icon />
                        </span>
                      )}
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="border-t border-divider-section mt-1" />

          <div className={styles.moreSheetFooter}>
            <button
              type="submit"
              form="coach-nav-logout-form"
              className="flex items-center gap-4 w-full px-5 h-14 text-sm font-semibold text-text-on-section hover:bg-section-item-hover transition-colors duration-150"
            >
              Log out
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

// ── Main nav ──────────────────────────────────────────────────────────────────

export default function CoachNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

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

  // Close sheet on route change
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);

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
          <nav className="hidden tablet:flex items-center gap-1" aria-label="Coach navigation">
            {DESKTOP_NAV_LINKS.map((link) => {
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

          <div className="flex items-center gap-2 tablet:gap-3">
            <CoachNotificationBell />
            <ThemeToggle />
            <ProfileMenu />
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar — hidden on tablet+ */}
      <nav
        data-testid="coach-bottom-nav"
        className={`${styles.tabBar} tablet:hidden fixed bottom-0 inset-x-0 z-50 bg-section text-text-on-section border-t border-divider-section flex`}
        aria-label="Coach navigation"
      >
        {BOTTOM_NAV_TABS.map((tab) => {
          const active = isCoachLinkActive(tab.href, pathname);
          const Icon = TAB_ICONS[tab.label];
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`${styles.tabItem} flex flex-col items-center justify-center gap-1.5 flex-1 text-xs font-semibold transition-colors duration-150 ${
                active ? "text-accent-on-section" : "text-text-secondary-on-section"
              }`}
            >
              <Icon />
              <span>{tab.label}</span>
            </Link>
          );
        })}

        {/* More button */}
        <button
          ref={moreBtnRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
          className={`${styles.tabItem} flex flex-col items-center justify-center gap-1.5 flex-1 text-xs font-semibold transition-colors duration-150 ${
            isMoreActive(pathname) || sheetOpen
              ? "text-accent-on-section"
              : "text-text-secondary-on-section"
          }`}
        >
          <MoreIcon />
          <span>More</span>
        </button>
      </nav>

      <MoreSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          moreBtnRef.current?.focus();
        }}
      />
    </>
  );
}
