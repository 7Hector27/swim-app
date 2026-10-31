"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { CoachNotificationListItem } from "@swim-app/shared";

import { formatTimeAgo } from "@/lib/formatTimeAgo";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api/coachAlerts";

import { groupNotificationsByDate } from "./groupByDate";

const PAGE_SIZE = 20;

export default function CoachNotificationsContent() {
  const [items, setItems] = useState<CoachNotificationListItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    const result = await fetchNotifications({
      order: "chronological",
      offset: 0,
      limit: PAGE_SIZE,
    });
    if (!result.ok) {
      setError(true);
      setLoading(false);
      return;
    }
    setItems(result.data.items);
    setUnreadCount(result.data.unreadCount);
    setHasMore(result.data.hasMore ?? false);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleLoadMore() {
    setLoadingMore(true);
    const result = await fetchNotifications({
      order: "chronological",
      offset: items.length,
      limit: PAGE_SIZE,
    });
    if (!result.ok) {
      setLoadingMore(false);
      return;
    }
    setItems((prev) => [...prev, ...result.data.items]);
    setHasMore(result.data.hasMore ?? false);
    setLoadingMore(false);
  }

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

  // "Now" is read each render; under test clocks it is frozen, under
  // real clocks the bucket boundaries drift only when the viewer crosses
  // midnight LA, which the next refresh will reconcile anyway.
  const groups = useMemo(
    () => groupNotificationsByDate(items, new Date().toISOString()),
    [items],
  );

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

        {groups.length > 0 && (
          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <section
                key={group.key}
                aria-labelledby={`notifications-group-${group.key}`}
                className="flex flex-col gap-2"
              >
                <h2
                  id={`notifications-group-${group.key}`}
                  className="text-xs font-semibold uppercase tracking-wider text-text-secondary"
                >
                  {group.label}
                </h2>
                <ul className="flex flex-col rounded-card border border-border overflow-hidden">
                  {group.items.map((item) => (
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
              </section>
            ))}

            {hasMore && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="self-center rounded-button border border-border px-5 h-10 text-sm font-semibold text-text hover:bg-surface-soft disabled:opacity-50 transition-colors duration-150 active:scale-[0.97]"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
