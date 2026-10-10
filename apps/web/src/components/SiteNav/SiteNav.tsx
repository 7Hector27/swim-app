"use client";

import { useEffect, useRef, useState } from "react";

import { logout } from "@/lib/logout";
import { useSession } from "@/components/Providers";
import ProfileMenu from "@/components/ProfileMenu";
import ThemeLogo from "@/components/ThemeLogo";
import ThemeToggle from "@/components/ThemeToggle";

const navLinks = [
  { label: "Lessons", href: "/lessons" },
  { label: "Leaderboards", href: "/leaderboard" },
  { label: "Coach Jason", href: "/#coach" },
];

const navLinkClass =
  "relative text-text-on-section font-semibold text-sm transition-all duration-150 pb-1 border-b-2 border-transparent hover:border-accent-on-section";

export default function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { isSignedIn } = useSession();

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

  function handleMenuToggle() {
    setMenuOpen((open) => !open);
  }

  function handleMenuClose() {
    setMenuOpen(false);
  }

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <nav
        className={`sticky top-0 z-50 bg-section transition-colors duration-200 ${scrolled ? "border-b border-divider-section" : ""}`}
      >
        <div className="mx-auto max-w-content px-page flex items-center justify-between h-16">
          <a href="/" aria-label="Axiom Aquatics home" onClick={handleMenuClose}>
            <ThemeLogo variant="auto" onDark />
          </a>

          {/* Desktop nav links */}
          <ul className="hidden tablet:flex items-center gap-6">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href} className={navLinkClass}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          {/* Desktop right-side actions */}
          <div className="hidden tablet:flex items-center gap-3">
            <ThemeToggle />
            {isSignedIn ? (
              <ProfileMenu />
            ) : (
              <>
                <a href="/login" className={navLinkClass}>
                  Log in
                </a>
                <a
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-button bg-accent-on-section text-on-accent font-bold text-sm px-5 h-11 transition-opacity duration-200 hover:opacity-90 active:scale-[0.97]"
                >
                  Sign up
                </a>
              </>
            )}
          </div>

          {/* Mobile: theme toggle + hamburger */}
          <div className="flex items-center gap-2 tablet:hidden">
            <ThemeToggle />
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={handleMenuToggle}
              className="flex flex-col justify-center items-center w-10 h-10 gap-1.5"
            >
              <span
                className={`block w-6 h-0.5 bg-text-on-section transition-all duration-200 ${menuOpen ? "translate-y-2 rotate-45" : ""}`}
              />
              <span
                className={`block w-6 h-0.5 bg-text-on-section transition-all duration-200 ${menuOpen ? "opacity-0" : ""}`}
              />
              <span
                className={`block w-6 h-0.5 bg-text-on-section transition-all duration-200 ${menuOpen ? "-translate-y-2 -rotate-45" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="tablet:hidden bg-section border-t border-divider-section">
            <ul className="px-page py-4 flex flex-col">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={handleMenuClose}
                    className="block px-3 py-3 text-text-on-section font-semibold text-base rounded-button transition-colors duration-150 hover:bg-accent/8"
                  >
                    {link.label}
                  </a>
                </li>
              ))}

              <li className="mt-2 pt-2 border-t border-divider-section" />

              {isSignedIn ? (
                <>
                  <li>
                    <a
                      href="/dashboard"
                      onClick={handleMenuClose}
                      className="block px-3 py-3 text-text-on-section font-semibold text-base rounded-button transition-colors duration-150 hover:bg-accent/8"
                    >
                      Dashboard
                    </a>
                  </li>
                  <li>
                    <a
                      href="/account"
                      onClick={handleMenuClose}
                      className="block px-3 py-3 text-text-on-section font-semibold text-base rounded-button transition-colors duration-150 hover:bg-accent/8"
                    >
                      Account settings
                    </a>
                  </li>
                  <li>
                    <form action={logout}>
                      <button
                        type="submit"
                        className="w-full text-left block px-3 py-3 text-text-on-section font-semibold text-base rounded-button transition-colors duration-150 hover:bg-accent/8"
                      >
                        Log out
                      </button>
                    </form>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <a
                      href="/login"
                      onClick={handleMenuClose}
                      className="block px-3 py-3 text-text-on-section font-semibold text-base rounded-button transition-colors duration-150 hover:bg-accent/8"
                    >
                      Log in
                    </a>
                  </li>
                  <li>
                    <a
                      href="/signup"
                      onClick={handleMenuClose}
                      className="block px-3 py-3 text-text-on-section font-semibold text-base rounded-button transition-colors duration-150 hover:bg-accent/8"
                    >
                      Sign up
                    </a>
                  </li>
                </>
              )}
            </ul>
          </div>
        )}
      </nav>
    </>
  );
}
