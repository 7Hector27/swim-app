"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import type { CoachNotificationListItem } from "@swim-app/shared";

import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api/coachAlerts";
import { formatTimeAgo } from "@/lib/formatTimeAgo";

import styles from "./CoachNotificationBell.module.css";

const POLL_INTERVAL_MS = 60_000;

interface Props {
  // "header" renders the icon-only button sized for the sticky desktop
  // header; "nav-tab" renders the stacked label the mobile bottom tab bar
  // uses so it reads consistently with its siblings (Home / Schedule / …).
  variant?: "header" | "nav-tab";
}

export default function CoachNotificationBell({ variant = "header" }: Props) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [items, setItems] = useState<CoachNotificationListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const [markAllError, setMarkAllError] = useState(false);
  const [animateBadge, setAnimateBadge] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const previousCount = useRef<number>(0);

  const refreshUnread = useCallback(async () => {
    const result = await fetchUnreadCount();
    if (result.ok) {
      setUnreadCount((prev) => {
        if (result.data.count > prev) setAnimateBadge(true);
        previousCount.current = result.data.count;
        return result.data.count;
      });
    }
  }, []);

  const refreshList = useCallback(async () => {
    setLoading(true);
    setListError(false);
    const result = await fetchNotifications();
    if (!result.ok) {
      setListError(true);
      setLoading(false);
      return;
    }
    setItems(result.data.items);
    setUnreadCount(result.data.unreadCount);
    setLoading(false);
  }, []);

  // Mount: initial unread count + poll every minute.
  useEffect(() => {
    void refreshUnread();
    const timer = window.setInterval(() => {
      void refreshUnread();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshUnread]);

  // Match the project's custom tablet breakpoint (769px).
  useEffect(() => {
    const query = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Close on route change (dropdown stays with the previous route
  // otherwise after a link click).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Dropdown dismissal — ignore when the mobile sheet is in play (its
  // backdrop handles that).
  useEffect(() => {
    if (!open || isMobile) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, isMobile]);

  // Mobile sheet — show/hide the native <dialog>.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isMobile) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open, isMobile]);

  // Animate the badge pulse once per uptick, then clear the class.
  useEffect(() => {
    if (!animateBadge) return;
    const timer = window.setTimeout(() => setAnimateBadge(false), 480);
    return () => window.clearTimeout(timer);
  }, [animateBadge]);

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next) void refreshList();
  }

  async function handleItemClick(item: CoachNotificationListItem) {
    setOpen(false);
    if (!item.readAt) {
      // Optimistic: drop the row from the unread count locally; let the
      // next refresh reconcile.
      setItems((rows) =>
        rows.map((row) => (row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row)),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
      void markNotificationRead(item.id);
    }
    if (item.scrubbed || !item.clickUrl) return;
    router.push(item.clickUrl);
  }

  async function handleMarkAll() {
    // Snapshot the pre-update state so a failed PATCH can revert cleanly;
    // without this the optimistic "all read" would stick even after the
    // server rejected the write and the coach would never know.
    const previousItems = items;
    const previousUnreadCount = unreadCount;
    const now = new Date().toISOString();
    setItems((rows) => rows.map((row) => ({ ...row, readAt: row.readAt ?? now })));
    setUnreadCount(0);
    setMarkAllError(false);
    const result = await markAllNotificationsRead();
    if (!result.ok) {
      setItems(previousItems);
      setUnreadCount(previousUnreadCount);
      setMarkAllError(true);
    }
  }

  const badgeLabel =
    unreadCount === 0 ? null : unreadCount > 9 ? "9+" : String(unreadCount);
  const hasUnread = unreadCount > 0;

  const triggerClass =
    variant === "nav-tab"
      ? // Mirror the stacked tab style from CoachNav for its mobile bar.
        `flex flex-col items-center justify-center gap-1.5 flex-1 text-xs font-semibold transition-colors duration-150 ${
          hasUnread || open ? "text-accent-on-section" : "text-text-secondary-on-section"
        }`
      : // Icon-only sized button for the desktop header right rail.
        `relative inline-flex items-center justify-center h-11 w-11 rounded-button transition-colors duration-150 text-text-secondary-on-section hover:text-text-on-section active:scale-[0.97]`;

  const panel = (
    <>
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-divider-section">
        <span className="text-sm font-semibold text-text-on-section">Notifications</span>
        <button
          type="button"
          onClick={handleMarkAll}
          disabled={unreadCount === 0 || loading}
          className="text-xs font-semibold text-accent-on-section hover:underline disabled:opacity-40 disabled:no-underline transition-opacity duration-150"
        >
          Mark all as read
        </button>
      </div>
      {markAllError && (
        <p role="alert" className="px-5 py-2 text-xs text-danger border-b border-divider-section">
          Could not mark all as read. Try again.
        </p>
      )}
      <div className="max-h-[60vh] overflow-y-auto">
        <NotificationList
          items={items}
          loading={loading}
          error={listError}
          onItemClick={handleItemClick}
        />
      </div>
      <div className="px-5 py-3 border-t border-divider-section">
        <Link
          href="/coach/notifications"
          onClick={() => setOpen(false)}
          className="text-sm font-semibold text-accent-on-section hover:underline"
        >
          View all notifications
        </Link>
      </div>
    </>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup={isMobile ? "dialog" : "menu"}
        aria-expanded={open}
        aria-label={
          unreadCount === 0
            ? "Notifications"
            : `Notifications, ${unreadCount} unread`
        }
        onClick={handleToggle}
        className={triggerClass}
      >
        <span className="relative inline-flex items-center justify-center">
          <BellIcon active={hasUnread} />
          {badgeLabel !== null && (
            <span
              aria-hidden="true"
              className={`absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-[10px] font-bold text-on-accent ${animateBadge ? styles.badgePulse : ""}`}
            >
              {badgeLabel}
            </span>
          )}
        </span>
        {variant === "nav-tab" && <span>Alerts</span>}
      </button>

      {!isMobile && open && (
        <div className="relative tablet:static tablet:inline-block">
          <div
            ref={panelRef}
            role="menu"
            aria-label="Notifications"
            className={`${styles.panel} absolute right-0 top-full mt-2 w-80 max-w-[90vw] rounded-card bg-section text-text-on-section border border-divider-section shadow-lg z-50 overflow-hidden`}
          >
            {panel}
          </div>
        </div>
      )}

      {isMobile && (
        <dialog
          ref={dialogRef}
          className={styles.sheet}
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
          onClick={(event) => {
            // The sheet fills the bottom of the viewport; clicking the
            // backdrop (anywhere above the sheet) closes it.
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientY < rect.top) setOpen(false);
          }}
          aria-label="Notifications"
        >
          <div className="bg-section text-text-on-section flex flex-col">{panel}</div>
        </dialog>
      )}
    </>
  );
}

function NotificationList({
  items,
  loading,
  error,
  onItemClick,
}: {
  items: CoachNotificationListItem[];
  loading: boolean;
  error: boolean;
  onItemClick: (item: CoachNotificationListItem) => void;
}) {
  if (error) {
    return (
      <p className="px-5 py-6 text-sm text-text-secondary-on-section">
        Could not load notifications. Try again.
      </p>
    );
  }
  if (loading && items.length === 0) {
    return <p className="px-5 py-6 text-sm text-text-secondary-on-section">Loading…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="px-5 py-6 text-sm text-text-secondary-on-section">
        You&rsquo;re all caught up.
      </p>
    );
  }
  return (
    <ul role="menu" aria-label="Recent notifications">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            role="menuitem"
            onClick={() => onItemClick(item)}
            disabled={item.scrubbed}
            className={`w-full text-left flex gap-3 px-5 py-3 border-b border-divider-section hover:bg-section-item-hover disabled:opacity-70 disabled:cursor-default transition-colors duration-100 ${
              item.readAt ? "" : "bg-section-item-hover"
            }`}
          >
            <span
              aria-hidden="true"
              className={`mt-1.5 inline-block h-2 w-2 rounded-full shrink-0 ${
                item.readAt
                  ? "bg-transparent"
                  : item.urgency === "urgent"
                    ? "bg-danger"
                    : "bg-accent-on-section"
              }`}
            />
            <span className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span
                className={`text-sm truncate ${
                  item.urgency === "urgent"
                    ? "font-bold text-text-on-section"
                    : item.readAt
                      ? "font-semibold text-text-secondary-on-section"
                      : "font-semibold text-text-on-section"
                }`}
              >
                {item.title}
              </span>
              <span className="text-xs text-text-secondary-on-section line-clamp-2">
                {item.body}
              </span>
              <span className="text-[11px] text-text-secondary-on-section uppercase tracking-wider mt-1">
                {formatTimeAgo(item.createdAt)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function BellIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 15h11l-1.4-1.6a2 2 0 0 1-.5-1.3V9.3A3.6 3.6 0 0 0 10 5.75 3.6 3.6 0 0 0 6.4 9.3v2.8a2 2 0 0 1-.5 1.3L4.5 15Z"
        stroke="currentColor"
        strokeWidth={active ? 1.75 : 1.5}
        strokeLinejoin="round"
      />
      <path
        d="M8.25 17h3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M10 4.5V3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

