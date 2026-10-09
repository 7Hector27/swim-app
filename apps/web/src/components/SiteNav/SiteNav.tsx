"use client";

import { useEffect, useRef, useState } from "react";

import { useSession } from "@/components/Providers";
import ThemeLogo from "@/components/ThemeLogo";
import ThemeToggle from "@/components/ThemeToggle";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "Lessons", href: "/lessons" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "About", href: "/about" },
];

const navLinkClass =
  "relative text-text-on-section font-semibold text-sm transition-all duration-150 pb-1 border-b-2 border-transparent hover:border-accent";

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
        className={`sticky top-0 z-50 bg-section transition-shadow duration-200 ${scrolled ? "shadow-elevated" : ""}`}
      >
        <div className="mx-auto max-w-content px-page flex items-center justify-between h-16">
          <a href="/" aria-label="JG Swim home" onClick={handleMenuClose}>
            <ThemeLogo width={100} height={40} onSection />
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
              <a href="/account" className={navLinkClass}>
                Dashboard
              </a>
            ) : (
              <>
                <a href="/login" className={navLinkClass}>
                  Log in
                </a>
                <a
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-pill border-2 border-text-on-section text-text-on-section font-bold text-sm px-5 h-11 transition-colors duration-200 hover:bg-white/10 active:scale-97"
                >
                  Sign up
                </a>
              </>
            )}
            <a
              href="/book"
              className="inline-flex items-center justify-center rounded-pill bg-accent text-on-accent font-bold text-sm px-5 h-11 transition-colors duration-200 active:scale-97"
            >
              Book a lesson
            </a>
          </div>

          {/* Mobile: Book shortcut + hamburger */}
          <div className="flex items-center gap-3 tablet:hidden">
            <a
              href="/book"
              className="inline-flex items-center justify-center rounded-pill bg-accent text-on-accent font-bold text-xs px-4 h-9 transition-colors duration-200 active:scale-97"
            >
              Book
            </a>
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
          <div className="tablet:hidden bg-section shadow-elevated">
            <ul className="px-page py-4 flex flex-col">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={handleMenuClose}
                    className="block px-3 py-3 text-text-on-section font-semibold text-base rounded transition-colors duration-150"
                    onMouseEnter={(event) => {
                      (event.currentTarget as HTMLAnchorElement).style.backgroundColor =
                        "color-mix(in srgb, var(--color-accent) 8%, transparent)";
                    }}
                    onMouseLeave={(event) => {
                      (event.currentTarget as HTMLAnchorElement).style.backgroundColor =
                        "transparent";
                    }}
                  >
                    {link.label}
                  </a>
                </li>
              ))}

              {isSignedIn ? (
                <li>
                  <a
                    href="/account"
                    onClick={handleMenuClose}
                    className="block px-3 py-3 text-text-on-section font-semibold text-base rounded transition-colors duration-150"
                    onMouseEnter={(event) => {
                      (event.currentTarget as HTMLAnchorElement).style.backgroundColor =
                        "color-mix(in srgb, var(--color-accent) 8%, transparent)";
                    }}
                    onMouseLeave={(event) => {
                      (event.currentTarget as HTMLAnchorElement).style.backgroundColor =
                        "transparent";
                    }}
                  >
                    Dashboard
                  </a>
                </li>
              ) : (
                <>
                  <li>
                    <a
                      href="/login"
                      onClick={handleMenuClose}
                      className="block px-3 py-3 text-text-on-section font-semibold text-base rounded transition-colors duration-150"
                      onMouseEnter={(event) => {
                        (event.currentTarget as HTMLAnchorElement).style.backgroundColor =
                          "color-mix(in srgb, var(--color-accent) 8%, transparent)";
                      }}
                      onMouseLeave={(event) => {
                        (event.currentTarget as HTMLAnchorElement).style.backgroundColor =
                          "transparent";
                      }}
                    >
                      Log in
                    </a>
                  </li>
                  <li>
                    <a
                      href="/signup"
                      onClick={handleMenuClose}
                      className="block px-3 py-3 text-text-on-section font-semibold text-base rounded transition-colors duration-150"
                      onMouseEnter={(event) => {
                        (event.currentTarget as HTMLAnchorElement).style.backgroundColor =
                          "color-mix(in srgb, var(--color-accent) 8%, transparent)";
                      }}
                      onMouseLeave={(event) => {
                        (event.currentTarget as HTMLAnchorElement).style.backgroundColor =
                          "transparent";
                      }}
                    >
                      Sign up
                    </a>
                  </li>
                </>
              )}

              <li className="pt-2 border-t border-divider-section mt-2">
                <div className="flex items-center gap-3 px-3 py-2">
                  <span className="text-text-secondary-on-section text-sm font-semibold">Theme</span>
                  <ThemeToggle />
                </div>
              </li>
            </ul>
          </div>
        )}
      </nav>
    </>
  );
}
