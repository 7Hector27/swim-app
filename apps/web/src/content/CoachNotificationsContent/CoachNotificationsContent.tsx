"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { CoachNotificationListItem } from "@swim-app/shared";

import { formatTimeAgo } from "@/components/CoachNotificationBell/CoachNotificationBell";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api/coachAlerts";

export default function CoachNotificationsContent() {
  const [items, setItems] = useState<CoachNotificationListItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    const result = await fetchNotifications();
    if (!result.ok) {
      setError(true);
      setLoading(false);
      return;
    }
    setItems(result.data.items);
    setUnreadCount(result.data.unreadCount);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRowClick(item: CoachNotificationListItem) {
    if (!item.readAt) {
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
    const now = new Date().toISOString();
    setItems((rows) => rows.map((row) => ({ ...row, readAt: row.readAt ?? now })));
    setUnreadCount(0);
    await markAllNotificationsRead();
  }

  return (
    <main className="flex-1 px-page py-10 tablet:py-14">
      <div className="mx-auto max-w-xl flex flex-col gap-6">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-heading text-3xl tablet:text-4xl">Notifications</h1>
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={unreadCount === 0 || loading}
            className="text-sm font-semibold text-accent hover:underline disabled:opacity-40 disabled:no-underline transition-opacity duration-150 active:scale-[0.97]"
          >
            Mark all as read
          </button>
        </header>

        {error && (
          <p role="alert" className="text-sm text-danger">
            Could not load notifications. Reload the page to try again.
          </p>
        )}

        {loading && items.length === 0 && (
          <p className="text-sm text-text-secondary">Loading…</p>
        )}

        {!loading && !error && items.length === 0 && (
          <p className="text-sm text-text-secondary">You&rsquo;re all caught up.</p>
        )}

        {items.length > 0 && (
          <ul className="flex flex-col rounded-card border border-border overflow-hidden">
            {items.map((item) => (
              <li key={item.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => handleRowClick(item)}
                  disabled={item.scrubbed}
                  className={`w-full text-left flex gap-3 px-4 py-3 transition-colors duration-100 hover:bg-surface-soft disabled:opacity-70 disabled:cursor-default ${
                    item.readAt ? "" : "bg-surface-soft"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 inline-block h-2 w-2 rounded-full shrink-0 ${
                      item.readAt
                        ? "bg-transparent"
                        : item.urgency === "urgent"
                          ? "bg-danger"
                          : "bg-accent"
                    }`}
                  />
                  <span className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span
                      className={`text-sm ${
                        item.urgency === "urgent"
                          ? "font-bold text-text"
                          : item.readAt
                            ? "font-semibold text-text-secondary"
                            : "font-semibold text-text"
                      }`}
                    >
                      {item.title}
                    </span>
                    <span className="text-xs text-text-secondary">{item.body}</span>
                    <span className="text-[11px] uppercase tracking-wider text-text-secondary mt-1">
                      {formatTimeAgo(item.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
