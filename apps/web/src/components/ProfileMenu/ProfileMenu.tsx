"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useSession } from "@/components/Providers";
import { logout } from "@/lib/logout";
import styles from "./ProfileMenu.module.css";

const BASE_MENU_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
] as const;

const PARENT_MENU_ITEMS = [
  { label: "Household", href: "/household" },
  { label: "Account settings", href: "/account" },
] as const;

const COACH_MENU_ITEMS = [
  { label: "Account settings", href: "/account" },
] as const;

function ChevronDown() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="transition-transform duration-150"
    >
      <path
        d="M3 5l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ProfileMenu() {
  const { role } = useSession();
  const menuItems = [
    ...BASE_MENU_ITEMS,
    ...(role === "parent" ? PARENT_MENU_ITEMS : COACH_MENU_ITEMS),
  ];
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const pathname = usePathname();

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

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
      {/* Mounted outside the dropdown so the form stays connected when the menu closes */}
      <form id="logout-form" action={logout} className="hidden" />

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleTriggerKeyDown}
        className="inline-flex items-center gap-1.5 rounded-button bg-card text-text-on-section font-semibold text-sm px-4 h-11 select-none transition-opacity duration-150 hover:opacity-80 active:scale-[0.97]"
      >
        My account
        <ChevronDown />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account menu"
          onKeyDown={handleMenuKeyDown}
          className={`absolute right-0 top-full mt-2 w-52 rounded-card bg-section border border-divider-section shadow-lg z-50 overflow-hidden py-1 ${styles.dropdown}`}
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

          <button
            type="submit"
            form="logout-form"
            role="menuitem"
            ref={(el) => {
              itemRefs.current[menuItems.length] = el;
            }}
            className={itemClass}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
