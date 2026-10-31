// Group a chronological list of notifications into four buckets -
// Today, Yesterday, This week, Earlier - using the viewer's LA date.
// Pure so the page component and tests share one implementation.
//
// "This week" is Monday-of-this-week through the day before yesterday
// (yesterday has its own group). "Earlier" is everything older than
// Monday-of-this-week.
//
// Dates are compared on YYYY-MM-DD strings formatted in America/Los_Angeles
// so DST transitions and midnight-UTC-vs-LA edge cases don't drift the
// buckets.

import type { CoachNotificationListItem } from "@swim-app/shared";

const LA_TZ = "America/Los_Angeles";

export type NotificationGroupKey = "today" | "yesterday" | "thisWeek" | "earlier";

export interface NotificationGroup {
  key: NotificationGroupKey;
  label: string;
  items: CoachNotificationListItem[];
}

const GROUP_LABELS: Record<NotificationGroupKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  earlier: "Earlier",
};

function laDateString(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function mondayOf(dateStr: string): string {
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

export function groupNotificationsByDate(
  items: CoachNotificationListItem[],
  nowIso: string,
): NotificationGroup[] {
  const todayStr = laDateString(nowIso);
  const yesterdayStr = addDays(todayStr, -1);
  const mondayStr = mondayOf(todayStr);

  const buckets: Record<NotificationGroupKey, CoachNotificationListItem[]> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    earlier: [],
  };

  for (const item of items) {
    const createdDate = laDateString(item.createdAt);
    if (createdDate === todayStr) {
      buckets.today.push(item);
    } else if (createdDate === yesterdayStr) {
      buckets.yesterday.push(item);
    } else if (createdDate >= mondayStr) {
      buckets.thisWeek.push(item);
    } else {
      buckets.earlier.push(item);
    }
  }

  const order: NotificationGroupKey[] = ["today", "yesterday", "thisWeek", "earlier"];
  return order
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, label: GROUP_LABELS[key], items: buckets[key] }));
}
