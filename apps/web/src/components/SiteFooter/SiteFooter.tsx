import ThemeLogo from "@/components/ThemeLogo";

const footerColumns = [
  {
    heading: "Explore",
    items: [
      { label: "Home", href: "/" },
      { label: "Lessons", href: "/lessons" },
      { label: "Leaderboards", href: "/leaderboard" },
      { label: "Coach Jason", href: "/#coach" },
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

export default function SiteFooter() {
  return (
    <footer className="bg-background border-t border-border">
      <div className="mx-auto max-w-content px-page py-12 tablet:py-16">
        <div className="flex flex-col gap-10 tablet:flex-row tablet:gap-16">
          <div className="tablet:flex-1">
            <ThemeLogo variant="lockup" width={140} height={40} />
          </div>

          <div className="flex flex-col gap-10 tablet:flex-row tablet:gap-16">
            {footerColumns.map((column) => (
              <div key={column.heading} className="flex flex-col gap-3">
                <p className="text-text font-bold text-sm uppercase tracking-widest">
                  {column.heading}
                </p>
                <ul className="flex flex-col gap-2">
                  {column.items.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        className="text-text-secondary text-sm hover:text-text transition-colors duration-150"
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

        <div className="mt-10 pt-6 border-t border-border">
          <p className="text-text-secondary text-xs">
            &copy; {new Date().getFullYear()} Axiom Aquatics. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
