"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { logout } from "@/lib/logout";
import { useSession } from "@/components/Providers";

function getInitials(name: string | null, email: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      const first = parts[0]?.[0] ?? "";
      const last = parts[parts.length - 1]?.[0] ?? "";
      return `${first}${last}`.toUpperCase();
    }
    return (parts[0]?.[0] ?? "?").toUpperCase();
  }
  if (email) {
    return (email[0] ?? "?").toUpperCase();
  }
  return "?";
}

const menuItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Account settings", href: "/account" },
] as const;

export default function ProfileMenu() {
  const { userName } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const pathname = usePathname();

  const initials = getInitials(userName, null);

  // Close on route change
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  function handleTriggerKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setIsOpen(true);
      // Focus first item after state update
      setTimeout(() => itemRefs.current[0]?.focus(), 0);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setTimeout(
        () => itemRefs.current[itemRefs.current.length - 1]?.focus(),
        0,
      );
    }
  }

  function handleMenuKeyDown(event: React.KeyboardEvent) {
    const items = itemRefs.current.filter((el): el is HTMLElement => el !== null);
    const focused = document.activeElement as HTMLElement;
    const currentIndex = items.indexOf(focused);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = items[(currentIndex + 1) % items.length];
      next?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev = items[(currentIndex - 1 + items.length) % items.length];
      prev?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "Tab") {
      setIsOpen(false);
    }
  }

  function handleItemClick() {
    setIsOpen(false);
  }

  const itemClass =
    "w-full text-left flex items-center px-4 h-11 text-sm font-semibold text-text-on-section hover:bg-white/5 transition-colors duration-100 focus-visible:outline-none focus-visible:bg-white/10";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Account menu"
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleTriggerKeyDown}
        className="flex items-center justify-center w-10 h-10 rounded-full bg-accent-on-section text-on-accent font-bold text-sm select-none transition-opacity duration-150 hover:opacity-90 active:scale-[0.97]"
      >
        {initials}
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account menu"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full mt-2 w-52 rounded-card bg-section border border-divider-section shadow-lg z-50 overflow-hidden py-1"
          style={{
            transformOrigin: "top right",
          }}
        >
          {menuItems.map((item, index) => (
            <a
              key={item.href}
              href={item.href}
              role="menuitem"
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              onClick={handleItemClick}
              className={itemClass}
            >
              {item.label}
            </a>
          ))}

          <div className="my-1 border-t border-divider-section" role="separator" />

          <form action={logout}>
            <button
              type="submit"
              role="menuitem"
              ref={(el) => {
                itemRefs.current[menuItems.length] = el;
              }}
              onClick={handleItemClick}
              className={itemClass}
            >
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
