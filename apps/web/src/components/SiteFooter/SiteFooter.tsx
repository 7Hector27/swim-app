import ThemeLogo from "@/components/ThemeLogo";

const footerLinks = [
  {
    heading: "[Links]",
    items: [
      { label: "[Home]", href: "/" },
      { label: "[Lessons]", href: "/lessons" },
      { label: "[Leaderboard]", href: "/leaderboard" },
      { label: "[About]", href: "/about" },
    ],
  },
  {
    heading: "[Links]",
    items: [
      { label: "[Book a lesson]", href: "/book" },
      { label: "[Contact]", href: "/contact" },
      { label: "[Privacy]", href: "/privacy" },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="bg-section">
      <div className="mx-auto max-w-content px-page py-12 tablet:py-16">
        <div className="flex flex-col gap-10 tablet:flex-row tablet:gap-16">
          <div className="flex flex-col gap-3 tablet:flex-1">
            <ThemeLogo width={100} height={40} onSection />
            <p className="text-text-secondary-on-section text-sm mt-2">
              [Footer tagline]
            </p>
          </div>

          <div className="flex flex-col gap-10 tablet:flex-row tablet:gap-16">
            {footerLinks.map((column, index) => (
              <div key={index} className="flex flex-col gap-3">
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

          <div className="flex flex-col gap-3">
            <p className="text-text-on-section font-bold text-sm uppercase tracking-widest">
              [Social]
            </p>
            <div className="flex gap-4">
              <a
                href="#"
                aria-label="[Social platform]"
                className="text-text-secondary-on-section hover:text-text-on-section transition-colors duration-150"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                >
                  <rect
                    x="2"
                    y="2"
                    width="16"
                    height="16"
                    rx="4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx="10"
                    cy="10"
                    r="3.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <circle cx="14.5" cy="5.5" r="1" fill="currentColor" />
                </svg>
              </a>
              <a
                href="#"
                aria-label="[Social platform]"
                className="text-text-secondary-on-section hover:text-text-on-section transition-colors duration-150"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 4h16M2 4l8 7 8-7M2 4v12a1 1 0 001 1h14a1 1 0 001-1V4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-divider-section">
          <p className="text-text-secondary-on-section text-xs">
            &copy; {new Date().getFullYear()} JG Swim. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
