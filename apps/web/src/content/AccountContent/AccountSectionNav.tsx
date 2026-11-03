"use client";

interface NavItem {
  id: string;
  label: string;
}

interface Props {
  items: NavItem[];
}

// Left-rail nav for /account on desktop. Each link scrolls to the section
// card's anchor. Hidden below the desktop breakpoint — mobile and tablet
// users read the stacked cards straight through.
export default function AccountSectionNav({ items }: Props) {
  function handleClick(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    // Keep the URL in sync so refresh/share retains the current section.
    history.replaceState(null, "", `#${id}`);
    // Move focus to the section heading so screen readers announce it.
    const heading = target.querySelector<HTMLElement>("h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }

  return (
    <nav
      aria-label="Account sections"
      className="hidden desktop:block sticky top-6 self-start w-56 flex-shrink-0"
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={(event) => handleClick(event, item.id)}
              className="flex items-center min-h-[44px] px-3 rounded-button text-sm font-semibold text-text hover:text-link-hover hover:bg-surface-soft transition-colors duration-150"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
