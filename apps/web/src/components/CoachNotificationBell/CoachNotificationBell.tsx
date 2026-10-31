"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import type { CoachNotificationListItem } from "@swim-app/shared";

import {
  COACH_NOTIFICATIONS_CHANGED_EVENT,
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const desktopPanelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
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

  // Mount: initial unread count + background poll. The poll is the floor
  // for freshness; mutations dispatch COACH_NOTIFICATIONS_CHANGED_EVENT
  // for immediate updates so the badge never lags behind a mark-read
  // fired from /coach/notifications or a mark-all from the open panel.
  useEffect(() => {
    void refreshUnread();
    const timer = window.setInterval(() => {
      void refreshUnread();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshUnread]);

  // Immediate refresh on cross-page mutations. The event is cheap, the
  // handler is debounced to a single refresh per tick to coalesce burst
  // dispatches (mark-read of a whole page's worth of rows at once).
  useEffect(() => {
    function handleChanged() {
      void refreshUnread();
    }
    window.addEventListener(COACH_NOTIFICATIONS_CHANGED_EVENT, handleChanged);
    return () => window.removeEventListener(COACH_NOTIFICATIONS_CHANGED_EVENT, handleChanged);
  }, [refreshUnread]);

  // Close on route change (otherwise a link click leaves the panel
  // mounted against the previous route).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Shared dismissal:
  //  - pointer-down outside the panel + the trigger closes the dropdown
  //    on tablet+;
  //  - on mobile the sheet's backdrop handles the same gesture;
  //  - Escape closes either surface.
  // The containment check must include BOTH the desktop panel ref AND
  // the mobile sheet ref - without the sheet ref, every tap inside the
  // sheet (including scrolling, mark-all, item taps) read as "outside"
  // and dismissed the sheet immediately. That was the mobile bug.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const insideDesktop = desktopPanelRef.current?.contains(target) ?? false;
      const insideSheet = sheetRef.current?.contains(target) ?? false;
      const insideTrigger = triggerRef.current?.contains(target) ?? false;
      if (insideDesktop || insideSheet || insideTrigger) return;
      setOpen(false);
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
  }, [open]);

  // Lock the page scroll behind the mobile sheet so a drag inside the
  // sheet never scrolls the dashboard underneath. Desktop dropdown does
  // not lock (it coexists with the page).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

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

  function PanelContents({ showCloseButton }: { showCloseButton: boolean }) {
    return (
      <>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-divider-section">
          <span className="text-sm font-semibold text-text-on-section">Notifications</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={unreadCount === 0 || loading}
              className="text-xs font-semibold text-accent-on-section hover:underline disabled:opacity-40 disabled:no-underline transition-opacity duration-150"
            >
              Mark all as read
            </button>
            {showCloseButton && (
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close notifications"
                className="inline-flex items-center justify-center h-8 w-8 rounded-button text-text-secondary-on-section hover:text-text-on-section active:scale-[0.97] transition-colors duration-150"
              >
                <CloseIcon />
              </button>
            )}
          </div>
        </div>
        {markAllError && (
          <p role="alert" className="px-5 py-2 text-xs text-danger border-b border-divider-section">
            Could not mark all as read. Try again.
          </p>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">
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
  }

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
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

      {/* Both surfaces are rendered as plain divs; CSS media queries
          decide which one is visible for the current viewport width.
          No matchMedia probe means no first-render flash of the wrong
          surface on mobile. */}
      {open && (
        <>
          {/* Desktop dropdown - hidden by styles.panel until tablet+.
              Anchored to this component's root via position:absolute, so
              it reliably opens directly under the bell and right-aligned
              to it. The max-width + right:0 keeps it inside the viewport
              on narrower desktop screens too. */}
          <div
            ref={desktopPanelRef}
            role="menu"
            aria-label="Notifications"
            className={`${styles.panel} rounded-card bg-section text-text-on-section border border-divider-section shadow-lg overflow-hidden`}
          >
            <PanelContents showCloseButton={false} />
          </div>

          {/* Mobile bottom sheet - hidden by styles.sheet from tablet+. */}
          <div
            className={styles.sheetBackdrop}
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            className={styles.sheet}
          >
            <PanelContents showCloseButton={true} />
          </div>
        </>
      )}
    </div>
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

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
