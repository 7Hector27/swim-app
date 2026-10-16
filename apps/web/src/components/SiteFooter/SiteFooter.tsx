import { siteLinks } from "@/lib/siteLinks";

import ThemeLogo from "@/components/ThemeLogo";

const footerColumns = [
  {
    heading: "Explore",
    items: [
      { label: "Home", href: "/" },
      { label: "Lessons", href: "/#lessons" },
      { label: "Leaderboards", href: "/leaderboard" },
      { label: "Coach Jason", href: "/#coach" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    heading: "Legal",
    items: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

const iconButtonClass =
  "w-11 h-11 rounded-full flex items-center justify-center bg-white/10 text-text-secondary-on-section hover:bg-white/20 hover:text-text-on-section transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]";

function SocialIconRow() {
  return (
    <div className="flex gap-2">
      <a
        href={siteLinks.instagram.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Jason on Instagram"
        className={iconButtonClass}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <a
        href={`mailto:${siteLinks.email}`}
        aria-label="Email Jason"
        className={iconButtonClass}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      </a>
    </div>
  );
}

export default function SiteFooter() {
  return (
    <footer className="bg-section border-t border-divider-section">
      <div className="mx-auto max-w-content px-page py-12 tablet:py-16">
        <div className="flex flex-col gap-10 tablet:flex-row tablet:items-start tablet:gap-16">
          {/* Logo + social icons stacked — left column on tablet+ */}
          <div className="flex flex-col gap-6 tablet:flex-1">
            <ThemeLogo variant="lockup" onDark width={140} height={40} />
            <div className="hidden tablet:flex">
              <SocialIconRow />
            </div>
          </div>

          {/* Link columns: 2-col grid on mobile, flex row on tablet+ */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-10 tablet:flex tablet:gap-16">
            {footerColumns.map((column) => (
              <div key={column.heading} className="flex flex-col gap-3">
                <p className="text-text-on-section font-bold text-sm uppercase tracking-widest">
                  {column.heading}
                </p>
                <ul className="flex flex-col gap-2">
                  {column.items.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        className="text-text-secondary-on-section text-sm hover:text-text-on-section transition-colors duration-150"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Social icons below columns on mobile */}
        <div className="mt-10 tablet:hidden">
          <SocialIconRow />
        </div>

        <div className="mt-10 pt-6 border-t border-divider-section">
          <p className="text-text-secondary-on-section text-xs">
            &copy; {new Date().getFullYear()} Axiom Aquatics. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
