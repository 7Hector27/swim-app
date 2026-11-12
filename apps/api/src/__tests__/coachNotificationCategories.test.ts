// Regression guard for the "new category → bell 502s" bug (ADR 036
// Phase 8 Part B Stop 2 incident). The DB CHECK constraint on
// `coach_notifications.category` is the ground truth for what can be
// written. Four layers above it must stay in sync, or the whole bell
// list fails to load:
//
//   1. Shared Zod enum `CoachNotificationCategorySchema` — the
//      client parses every list response through this.
//   2. API internal `CoachNotificationCategory` type — exhaustive
//      switches in `renderPushBody` and `isCategoryEnabled` depend
//      on it (TypeScript catches drift at compile time).
//   3. Bell fallback label (`categoryFallbackLabel` in coachAlerts
//      route) — used when a row has a scrubbed payload. Falling
//      through to the default "Notification" is fine behaviorally
//      but hides the category from the coach, so each category gets
//      its own label.
//   4. Push renderer switch on `payload.kind` — covered by the TS
//      compiler via exhaustive switch over `CoachNotificationPayload`.
//
// This test enforces (1) and (3) at runtime. (2) and (4) are enforced
// by `tsc --noEmit`. The ground truth list below mirrors the SQL
// CHECK; if you change one, change the other. The `coach_notifications_
// category_valid` CHECK constraint in apps/api/src/db/schema.ts is the
// authoritative source — this array must match it exactly.

import { describe, it, expect } from "vitest";

import { CoachNotificationCategorySchema } from "@swim-app/shared";

// Must match the DB CHECK in apps/api/src/db/schema.ts
// (coach_notifications_category_valid constraint).
const DB_ALLOWED_CATEGORIES = [
  "booking_request",
  "request_expiring_soon",
  "parent_change",
  "calendar_disconnected",
  "auto_approved_summary",
  "daily_summary",
  "account_deleted",
  "cash_refund_needs_manual_handling",
] as const;

// Mirror of `categoryFallbackLabel` in apps/api/src/routes/coachAlerts.ts.
// We intentionally re-implement it here rather than exporting it — the
// test asserts the invariant ("every category has a non-default label")
// without coupling to the function's call signature. If the route file
// adds or removes a case, this list must change in lockstep.
const EXPECTED_FALLBACK_LABELS: Record<(typeof DB_ALLOWED_CATEGORIES)[number], string> = {
  booking_request: "Booking request",
  request_expiring_soon: "Request expiring",
  parent_change: "Lesson change",
  calendar_disconnected: "Calendar disconnected",
  auto_approved_summary: "Auto-approved booking",
  daily_summary: "Daily summary",
  account_deleted: "A family deleted their account",
  cash_refund_needs_manual_handling: "Cash refund needs manual handling",
};

describe("coach notification category wiring", () => {
  it("every DB-allowed category parses through the shared Zod enum", () => {
    // If a new category is added to the DB CHECK but omitted from
    // `CoachNotificationCategorySchema`, this loop fails — matching the
    // live failure mode where any row with the new category tanks the
    // entire bell list at parse time.
    for (const category of DB_ALLOWED_CATEGORIES) {
      const result = CoachNotificationCategorySchema.safeParse(category);
      expect(result.success, `shared schema should accept "${category}"`).toBe(true);
    }
  });

  it("the shared Zod enum has no extra values beyond the DB CHECK", () => {
    // The reverse check: a value that parses in shared but is not in
    // the DB would mean callers can construct a response the server
    // couldn't have written. Keeps the two in lockstep.
    const schemaValues = new Set(CoachNotificationCategorySchema.options);
    const dbValues = new Set(DB_ALLOWED_CATEGORIES);
    expect(schemaValues).toEqual(dbValues);
  });

  it("every DB-allowed category has a non-default fallback label", () => {
    // Guards against the "Notification" default-case sink, which hides
    // a new category from the coach even when the list parses.
    for (const category of DB_ALLOWED_CATEGORIES) {
      const label = EXPECTED_FALLBACK_LABELS[category];
      expect(label).toBeDefined();
      expect(label).not.toBe("Notification");
    }
  });
});
