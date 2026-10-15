# Booking Calendar Redesign

**Status:** Planning
**Replaces:** the five-step `BookLessonContent` wizard (location → date → slot → swimmers → confirm)
**Depends on:** PR 3a (lessons + slots), PR 3b (existing booking API), PR 5 (cancel/reschedule API)

---

## Overview

The current booking flow is a five-step wizard. This redesign replaces it with a calendar that lets the parent pick a date visually, see slot availability at a glance, and confirm without page transitions. A month view shows open-slot counts per day; a week view shows each 15-minute slot in the teaching window with its state. Reschedule lives at a dedicated `/dashboard/lessons/:id/reschedule` route that reuses the same calendar with the current appointment pinned at the top.

The calendar is delivered in four PRs so each one can be reviewed, tested, and merged independently.

| PR | Scope |
|---|---|
| A | Range availability API endpoint |
| B | Week view, selection, bottom bar, phone layout (replaces the wizard) |
| C | Month view |
| D | Reschedule screen |

---

## Design decisions (deviations from the mockups)

The mockups use a generic booking-app visual language. These rules take precedence.

**Colors and fonts.** All colors are design tokens from `axiom-aquatics-design`. No hardcoded hex. Headings in Fraunces; all grid text and UI copy in Figtree. Light and dark mode both work by token swapping.

**Config row above the calendar.** Pool, lesson length, and swimmers are chosen in a row above the calendar, not on a prior screen. The grid re-fetches immediately when any selector changes.

**Selection spans full duration.** If the user selects 4:15 PM with a 45-minute lesson, rows 4:15, 4:30, and 4:45 are all highlighted as "Your pick." The Current block in reschedule mode also spans the full existing lesson duration.

**Slot states.** Seven states — no "Booked" label anywhere, since that would reveal another family's schedule.

| State | Description | Display |
|---|---|---|
| `available` | Open, within booking window | Selectable button |
| `unavailable` | Blocked (lesson, buffer, blocked time, GCal event, or daily cap) — reason never shown | Strikethrough, not clickable |
| `too_soon` | Within `bookingMinAdvanceHours` of now, but not in the past | Tappable; shows "Less than 16 hours away. Text Jason to book this one." in the bottom bar instead of selecting the slot |
| `past` | Before now (UTC) | Greyed, not clickable |
| `not_open_yet` | Beyond `bookingMaxAdvanceWeeks` | Greyed, not clickable |
| `closed` | Day not in `config.lessonDays` | "Closed" spans entire column |
| `current` | The lesson being rescheduled (client-side decoration only, not from API) | Dashed blue border |

`your_pick` is a client-side selection state, not returned by the API.

**Teaching window rows from config.** The grid row range is derived from the union of `schoolYearStartTime`/`schoolYearEndTime` and `summerMorningStartTime`/`summerMorningEndTime`/`summerEveningStartTime`/`summerEveningEndTime` that apply for the displayed week. No hardcoded 4–8 PM range.

**Phone layout (< 769px).** A scrollable horizontal day-strip (open count or Closed beneath each day) replaces the grid. Tapping a day shows a flat list of time slots for that day. Unavailable/too-soon/past slots appear in the list with their state (strikethrough or greyed) so the parent understands the full picture; available ones are tappable buttons.

**Bottom bar.** Shows the selected time or "No time picked yet." When a slot is selected, also shows:
- Duration and swimmer count.
- Price for the selected duration and swimmer count, computed client-side from the rates in `src/lib/pricing.ts` (see PR B). Never show a dash as a placeholder.
- "Jason will confirm this one" if the approval gate would fire for this household at this pool (determined server-side; returned as `needsApproval` at the top level of the range response).

When a `too_soon` slot is tapped, the bottom bar shows "Less than 16 hours away. Text Jason to book this one." instead of the selected time, and the confirm button stays disabled. No hover-only tooltips (`title` attributes) anywhere on the calendar.

**Reschedule specifics.**
- Entry point: lesson detail page → "Reschedule" button → `/dashboard/lessons/:id/reschedule`.
- The endpoint's `excludeLessonId` parameter tells the slot calculator to treat the current lesson as a non-blocker, so the parent can re-book the exact same slot.
- The new `startsAt` must be ≥ `bookingMinAdvanceHours` from now (standard rule); the existing lesson's time is not re-validated.
- Changing pool or duration re-derives the approval state; the banner updates live.
- "Keep this time" navigates back to the lesson detail without changes.
- "Cancel appointment" opens the existing `ConfirmDialog` (calls `DELETE /lessons/:id`), then redirects to `/dashboard`.
- After confirming a reschedule, redirect to `/dashboard?booked=<id>` to reuse `BookingConfirmDialog`. Extend that component with an optional `fromSlot` prop so it can show "Moved from … to …" for reschedule confirmations.
- Viewers see the lesson detail but the Reschedule and Cancel buttons are absent.

---

## Shared types (packages/shared/src/schemas/booking.ts)

These schemas are added once in PR A and used across all later PRs.

```typescript
// ── Slot and day states ───────────────────────────────────────────────────────

export const SlotStateSchema = z.enum([
  "available",
  "unavailable",
  "too_soon",
  "past",
  "not_open_yet",
]);
export type SlotState = z.infer<typeof SlotStateSchema>;

export const DayStateSchema = z.enum([
  "open",          // has teaching windows; individual slots may have any state
  "closed",        // not in lessonDays
  "past",          // entire day is before today (LA time)
  "not_open_yet",  // entire day is beyond bookingMaxAdvanceWeeks
]);
export type DayState = z.infer<typeof DayStateSchema>;

// ── Per-slot and per-day shapes ───────────────────────────────────────────────

export const SlotWithStateSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  state: SlotStateSchema,
});
export type SlotWithState = z.infer<typeof SlotWithStateSchema>;

export const TeachingWindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end:   z.string().regex(/^\d{2}:\d{2}$/),
});
export type TeachingWindow = z.infer<typeof TeachingWindowSchema>;

// Base shape returned for both views (no per-slot data)
export const DayAvailabilitySchema = z.object({
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayState:        DayStateSchema,
  openCount:       z.number().int(),  // available slots for the given duration
  totalCount:      z.number().int(),  // teaching-window slots regardless of state
  teachingWindows: z.array(TeachingWindowSchema), // empty for closed/past/not_open_yet days
});
export type DayAvailability = z.infer<typeof DayAvailabilitySchema>;

// Week-only extension: includes per-slot state data
export const WeekDayAvailabilitySchema = DayAvailabilitySchema.extend({
  slots: z.array(SlotWithStateSchema),
});
export type WeekDayAvailability = z.infer<typeof WeekDayAvailabilitySchema>;

// ── Query and response ────────────────────────────────────────────────────────

export const RangeAvailabilityQuerySchema = z.object({
  view:             z.enum(["week", "month"]),
  date:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes:  z.string()
                      .transform((value) => parseInt(value, 10))
                      .pipe(z.union([z.literal(30), z.literal(45), z.literal(60)])),
  locationId:       z.string().uuid(),
  excludeLessonId:  z.string().uuid().optional(),
});
export type RangeAvailabilityQuery = z.infer<typeof RangeAvailabilityQuerySchema>;

// needsApproval is returned once per request (depends on household + pool, not per day)
export const MonthAvailabilityResponseSchema = z.object({
  needsApproval: z.boolean(),
  days: z.array(DayAvailabilitySchema),
});
export type MonthAvailabilityResponse = z.infer<typeof MonthAvailabilityResponseSchema>;

export const WeekAvailabilityResponseSchema = z.object({
  needsApproval: z.boolean(),
  days: z.array(WeekDayAvailabilitySchema),
});
export type WeekAvailabilityResponse = z.infer<typeof WeekAvailabilityResponseSchema>;
```

---

## PR A — Range availability endpoint

### What it does

Adds `GET /lessons/available-range`. Returns per-day availability for a week (7 days, Monday–Sunday) or a month (all days in the calendar month, including leading/trailing days from adjacent months to fill the Mon–Sun grid). For week view it includes per-slot states; for month view it omits slots and returns only counts.

### New logic: `classifyDaySlots`

A new function in `apps/api/src/lib/slots.ts` alongside `computeAvailableSlots`. It shares the same forbidden-interval and teaching-window logic but returns all 15-minute candidates in the teaching windows with an explicit state, rather than only the bookable ones.

```typescript
// apps/api/src/lib/slots.ts — new export alongside computeAvailableSlots

interface ClassifyParams extends Omit<SlotParams, "durationMinutes"> {
  durationMinutes: 30 | 45 | 60;
}

export function classifyDaySlots(params: ClassifyParams): SlotWithState[]
```

Algorithm:
1. If the day is not in `config.lessonDays` → return `[]` (caller marks day as "closed").
2. Determine season; build teaching windows (same as `computeAvailableSlots`).
3. Build forbidden intervals from existing lessons, travel buffers, blocked times, GCal (same as steps 4–5 of `computeAvailableSlots`).
4. Check daily cap: if `committedMinutes + durationMinutes > maxDailyLessonMinutes`, all remaining slots are "unavailable."
5. Enumerate every 15-minute start in the teaching window(s).
6. For each start time `t`:
   - `t + duration` would overlap a forbidden interval → `unavailable`
   - `t < nowUtc` → `past`
   - `t < nowUtc + bookingMinAdvanceHours` → `too_soon`
   - `t > nowUtc + bookingMaxAdvanceWeeks × 7 days` → `not_open_yet`
   - Otherwise → `available`
7. Return the classified list in ascending order.

(Priority when multiple conditions apply: `past` > `too_soon` > `unavailable` > `not_open_yet` > `available`.)

### Files

```
packages/shared/src/schemas/booking.ts          add types from Shared types section above
packages/shared/src/index.ts                    export new types
apps/api/src/lib/slots.ts                       add classifyDaySlots()
apps/api/src/routes/lessons.ts                  add GET /lessons/available-range
apps/api/src/__tests__/slots.test.ts            extend with classifyDaySlots tests
apps/api/src/__tests__/rangeAvailability.test.ts  new route tests
apps/web/src/lib/api/lessons.ts                 add fetchRangeAvailability()
```

### Route

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /lessons/available-range | requireUser (parent or coach) | Returns `RangeAvailabilityResponse`. |

**Query parameters** (validated via `RangeAvailabilityQuerySchema`):
- `view`: `"week"` or `"month"`
- `date`: any day within the target week/month (YYYY-MM-DD); handler derives the full range
- `durationMinutes`: 30, 45, or 60
- `locationId`: UUID; same access check as `GET /lessons/available-slots` (home pool must belong to caller's household)
- `excludeLessonId`: optional UUID; the lesson being rescheduled — excluded from `existingLessons` when computing states

**Week view** — derive Mon–Sun containing `date`; call `classifyDaySlots` for each of the 7 days; return `WeekAvailabilityResponse` with `slots` populated on every day.

**Month view** — derive the 5-or-6-week Mon–Sun calendar grid containing the month; compute only `openCount` and `totalCount` per day (count how many slots `classifyDaySlots` would mark `available` without materialising the full list if possible, or run it and count); return `MonthAvailabilityResponse` with no `slots` field on any day.

**`needsApproval`** — called once for the request (one pool, one household). Returned as a single boolean at the top level of the response, not per day.

**GCal busy times** — use the same in-memory cache as `GET /lessons/available-slots` (from PR 6). Fetch once per distinct date in the range; reuse if already cached.

### Rules

- The location access check is identical to `GET /lessons/available-slots`: if the location is a home pool, verify the caller's household matches.
- `excludeLessonId` is only honored when the lesson belongs to the caller's household (or caller is coach). Otherwise, silently ignore it (treat as absent).
- For days before today: `dayState = "past"`, `openCount = 0`, `totalCount = 0`, `teachingWindows = []`. Week view also has `slots = []`.
- For days beyond `bookingMaxAdvanceWeeks`: `dayState = "not_open_yet"`, same empty defaults.
- For closed days (not in `lessonDays`): `dayState = "closed"`, same empty defaults.
- `needsApproval` is a single top-level boolean on the response, not per day. It is computed once for the (household, pool) pair and does not change across days.

### Tests (unit — `slots.test.ts`)

- `classifyDaySlots` on a closed day returns `[]`.
- Every slot in the teaching window is returned (not just available ones).
- A blocked slot is `unavailable`.
- A slot at exactly `nowUtc + bookingMinAdvanceHours` is `available` (boundary inclusive).
- A slot one second before that boundary is `too_soon`.
- A slot in the past is `past`.
- A slot beyond `bookingMaxAdvanceWeeks` is `not_open_yet`.
- When daily cap is reached, remaining slots are `unavailable`.
- `excludeLessonId` lesson does not contribute to blocked intervals.
- Summer day: slots in the Seahawks gap are absent (gap is not part of the teaching windows).

### Tests (route — `rangeAvailability.test.ts`)

- Week view: returns `WeekAvailabilityResponse`; 7 days Mon–Sun; each day has a `slots` array.
- Month view: returns `MonthAvailabilityResponse`; 5–6 rows × 7 days; no day has a `slots` field.
- `openCount` matches the count of `available` slots in the `slots` array for week view.
- Location home-pool access check: parent from another household gets 404.
- `excludeLessonId` belonging to another household is silently ignored; that lesson's slot remains blocked.
- `excludeLessonId` for the caller's own lesson: that slot is treated as free.
- Past day: `dayState = "past"`, no slots.
- Closed day (not in `lessonDays`): `dayState = "closed"`, no slots.
- `needsApproval = true` at the top level for a household with no prior approved lessons at this pool.
- `needsApproval = false` at the top level for a household with an approved lesson history at this pool.

### Out of scope

- UI (PR B and C).

---

## PR B — Week view, selection, bottom bar, phone layout

Replaces `BookLessonContent` with a calendar-based booking flow. The old wizard file is deleted; the new booking page renders `BookCalendarContent`.

### Files

```
apps/web/src/app/dashboard/book/page.tsx
  replace: renders BookCalendarContent instead of BookLessonContent

apps/web/src/content/BookCalendarContent/
  BookCalendarContent.tsx         root component; owns all selection state
  CalendarConfigRow.tsx           pool / duration / swimmer selectors above the grid
  WeekGrid.tsx                    7-column week grid (tablet+)
  DayColumn.tsx                   one column in the week grid
  SlotCell.tsx                    one 15-min cell; handles spanning for selection/current
  WeekNav.tsx                     < > date-range label Today
  Legend.tsx                      Available · Unavailable · Your pick · Current · Past
  PhoneDayStrip.tsx               mobile: scrollable horizontal day-strip
  PhoneTimeList.tsx               mobile: time list for the selected day
  BottomBar.tsx                   sticky bottom bar — selected time, price, confirm
  actions.ts                      createBookingAction (calls POST /lessons)
  helpers.ts                      date math, row generation, price formatting
  index.ts

apps/web/src/lib/pricing.ts
  new — faqPricing.ts moved here from HomepageContent/; export PRICING_ROWS and lessonPrice(durationMinutes, swimmerCount)
  HomepageContent/faqPricing.ts re-exports from the new path to keep the FAQ import working

apps/web/src/content/BookLessonContent/       deleted entirely

apps/web/src/__tests__/bookCalendar.test.tsx  new
```

### Component layout and state

`BookCalendarContent` is a client component (`"use client"`). It holds:

```typescript
const [view, setView] = useState<"week" | "month">("week");
const [currentDate, setCurrentDate] = useState<string>(todayLA()); // drives displayed week/month
const [locationId, setLocationId] = useState<string | null>(defaultLocationId); // first location from props
const [durationMinutes, setDurationMinutes] = useState<30 | 45 | 60>(30);
const [swimmerIds, setSwimmerIds] = useState<string[]>([]);
const [selectedStartsAt, setSelectedStartsAt] = useState<string | null>(null);
```

Locations, swimmers, and initial config are fetched server-side in `page.tsx` (same as the current booking page) and passed as props. Range availability is fetched client-side via a `useEffect` that fires whenever `locationId`, `durationMinutes`, `swimmerIds`, or `currentDate`/`view` changes, calling `fetchRangeAvailability`.

When any config selector changes, `selectedStartsAt` is reset to `null`.

### CalendarConfigRow

Three selectors in a row:
- **Pool** — single-select; if only one location, no selector shown (use it silently). Dropdown on mobile, pill buttons on tablet+.
- **Duration** — 30 min / 45 min / 60 min (pill buttons). Default 30 min.
- **Swimmers** — multi-select with swimmer names; up to 4. At least one required to enable "Confirm booking."

No submit; changes take effect immediately via state.

### WeekGrid (tablet+)

**Column headers.** Each column shows: DOW abbreviation, date, and below that either "Past," "Closed," or "X open" (X = `openCount`). Today's column header has a subtle indicator. The selected-week column (only when the user has selected a slot) has a blue indicator.

**Row generation.** The grid row labels (4:00 PM, :15, :30, :45, 5:00 PM …) are derived from the union of all `teachingWindows` across the 7 days in the current week. If all 7 days are closed/past, the grid shows a single "No available slots this week" message.

**Cells.**

Each cell is one of:
- A `<button>` with `aria-label="[Full weekday], [Month] [day], [time], [state]"` — e.g., `"Wednesday, October 14, 4:15 PM, available"`. Min-height 44px.
- A non-interactive `<div>` for closed-column cells.

Cell visual states:

| State | Appearance |
|---|---|
| `available` | `bg-surface-soft` (light) / matching dark token; hover `bg-accent/10` |
| `your_pick` (client) | `bg-accent text-on-accent` or `bg-button-primary-background text-button-primary-text` |
| `current` (client) | Dashed `border-accent-on-section` border |
| `unavailable` | Strikethrough on time text, `text-text-secondary`, not clickable |
| `too_soon` | Strikethrough; tapping shows "Less than 16 hours away. Text Jason to book this one." in the bottom bar instead of selecting the slot |
| `past` | `text-text-secondary opacity-50` |
| `not_open_yet` | Same as past |
| `closed` (day) | Single merged cell spanning full column height, text "Closed", `text-text-secondary` |

**Selection spanning.** When the user clicks a slot at time `T`:
- All rows from `T` to `T + durationMinutes` (exclusive end) are marked `your_pick`.
- Implemented by checking in `SlotCell`: `selectedStartsAt !== null && t >= selectedStartsAt && t < selectedStartsAt + durationMinutes`.

**Keyboard.** Arrow keys move focus between cells. Space/Enter selects. Escape clears selection.

### BottomBar

Sticky to the bottom of the viewport on all breakpoints. On mobile: above the tab bar (respects `env(safe-area-inset-bottom)`).

**No selection:**
```
SELECTED TIME          [Confirm booking — disabled]
No time picked yet
```

**Too-soon slot tapped:**
```
                       [Confirm booking — disabled]
Less than 16 hours away. Text Jason to book this one.
```

**With selection:**
```
SELECTED TIME          [Confirm booking — enabled]
Wed Oct 14 · 4:15 – 5:00 PM
45 min · 2 swimmers · $90      ← from src/lib/pricing.ts; always a real number
Jason will confirm this one    ← only if response.needsApproval
```

Price is `lessonPrice(durationMinutes, swimmerIds.length)` from `src/lib/pricing.ts`, computed entirely client-side. It is always shown when a slot is selected — no placeholder dash.

The confirm action calls `createBookingAction` (a server action that calls `POST /lessons`). On success, `router.push('/dashboard?booked=' + lessonId)` — reusing the existing `BookingConfirmDialog`.

### PhoneDayStrip + PhoneTimeList (mobile only, < 769px)

`PhoneDayStrip` — horizontal scrollable strip of 7 day buttons per week (same week navigation as the grid). Each button shows:
```
Wed
14
10 open   ← or "Closed" or "Past"
```
The selected day button has an accent border.

`PhoneTimeList` — shown below the strip for the currently selected day. Lists every slot in the teaching windows for that day, one per row, as a full-width button or non-interactive item. Available slots are tappable. Too-soon slots are tappable but trigger the bottom bar message ("Less than 16 hours away. Text Jason to book this one.") rather than a selection. Unavailable and past slots are non-interactive and rendered greyed/strikethrough with no tooltip.

### Legend

Shown above the grid. Icons + labels matching the mock: Available · Unavailable · Your pick · Past. Closed is self-evident from the column. "Current" is only in the legend when on the reschedule screen.

### Rules

- The `CalendarConfigRow` is disabled while the range availability is loading (prevent stale grid confusion).
- If the range fetch fails, show an inline error: "Could not load availability. Try again."
- Viewer: `BookCalendarContent` renders a "Booking is for household owners and managers" message, same as the current wizard.
- If no locations are returned, show: "No pools configured. Add a home pool in household settings."
- If no swimmers: show "Add swimmers to your household to book."
- Confirm button is disabled until a swimmer is selected AND a slot is selected.

### Tests

- `CalendarConfigRow` shows all passed locations and swimmers.
- Changing duration resets the selected slot.
- `WeekGrid` renders a cell for each slot in the teaching window.
- A slot marked `available` renders as a button.
- A slot marked `unavailable` renders as non-interactive with strikethrough.
- Clicking an available slot marks it and the spanning rows as selected.
- Clicking a second slot replaces the first selection.
- `BottomBar` shows "No time picked yet" when no slot is selected.
- `BottomBar` shows formatted time when a slot is selected.
- `BottomBar` shows "Jason will confirm this one" when `response.needsApproval = true`.
- `BottomBar` shows "Less than 16 hours away. Text Jason to book this one." when a too-soon slot is tapped.
- `BottomBar` shows the computed price (never a dash) when a slot is selected and at least one swimmer is chosen.
- `BottomBar` confirm button disabled when no swimmer is selected.
- Tapping a too-soon slot does not select it; tapping an available slot does.
- No `title` attribute on any slot cell.
- `src/lib/pricing.ts` exports the same values as the old `HomepageContent/faqPricing.ts`; the FAQ re-export is updated in the same PR.
- Viewer: shows the read-only message, no grid.

### Out of scope

- Month view (PR C).
- Reschedule (PR D).

---

## PR C — Month view

Adds the month grid. No new API work; the month data comes from the `view=month` response already defined in PR A.

### Files

```
apps/web/src/content/BookCalendarContent/
  MonthGrid.tsx          add — 5-or-6-row calendar month grid
  MonthDayCell.tsx       add — single day cell with fill bar
  BookCalendarContent.tsx  modify — wire view toggle; render MonthGrid when view = "month"
  WeekNav.tsx            modify — show "Oct 12–18, 2026" in week view, "October 2026" in month view

apps/web/src/__tests__/bookCalendarMonth.test.tsx  new
```

### MonthGrid

**Layout.** 7 columns (Mon–Sun). Header row: MON TUE WED THU FRI SAT SUN. Rows for each week in the month. Leading and trailing days from adjacent months are shown in lighter text but are still navigable.

**Day cell content.**
```
14                     ← date number; today gets an accent border
Today · 10 of 16 open  ← state line
▓▓▓▓▓░░░░░░░░░░░       ← fill bar (blue, proportional width)
```

State line variants:
- Past days: "Past"
- Closed days: "Closed"
- Not open yet: "Not open yet"
- Open days: "N of M open" (N = openCount, M = totalCount). Today prepends "Today · ".
- Open days with 0 open: "0 of M open" (bar is empty; cell is still clickable to see why).

Fill bar: `bg-accent` portion at `(openCount / totalCount) * 100%`; remainder `bg-border`. Hidden for non-open days.

**Navigation.** Clicking any day in the month grid sets `currentDate` to that day and switches `view` to `"week"`. This navigates the user directly to the week view centered on that day, ready to pick a specific time.

Clicking a past or closed day: navigates to its week view (so the parent can see why it's unavailable), but no slot is pre-selected.

**Week/Month toggle.** Two-button toggle in the top-right corner (matches the mock). Switching view triggers a new fetch for the appropriate range.

### Rules

- Month view does not allow direct slot selection (clicking a day goes to week view).
- Adjacent-month days are shown but navigating to them switches the displayed month.
- Month view still respects the config row (changing pool or duration re-fetches the month).

### Tests

- `MonthGrid` renders one cell per day in the month plus leading/trailing days.
- An open day shows "N of M open" and a proportional fill bar.
- A closed day shows "Closed" with no fill bar.
- A past day shows "Past."
- Clicking a day switches `view` to `"week"` and sets `currentDate` to that day.
- Today's cell has an accent border.

### Out of scope

- Inline slot picker within the month view.

---

## PR D — Reschedule screen

Adds `/dashboard/lessons/:id/reschedule` and the reschedule confirmation flow.

### Files

```
apps/web/src/app/dashboard/lessons/[id]/reschedule/
  page.tsx                       new

apps/web/src/content/RescheduleContent/
  RescheduleContent.tsx          new — wraps BookCalendarContent in reschedule mode
  CurrentAppointmentCard.tsx     new — top card with lesson details + Keep / Cancel
  actions.ts                     new — rescheduleAction (calls PATCH /lessons/:id)
  index.ts                       new

apps/web/src/content/ParentDashboardContent/BookingConfirmDialog.tsx
  modify — add optional fromSlot?: string prop; when present, show "Moved from X" line

apps/web/src/__tests__/reschedule.test.tsx     new
```

### Page

`/dashboard/lessons/:id/reschedule` — server component. Fetches the lesson (`GET /lessons/:id`). If the lesson is not found, `notFound()`. If the status is not `pending` or `approved`, redirect to `/dashboard/lessons/:id` with a flash message "This lesson can no longer be rescheduled." Passes the lesson to `RescheduleContent`.

Viewer: if the caller is a viewer, redirect to `/dashboard/lessons/:id`.

### CurrentAppointmentCard

Shows at the very top of the page, above the config row and calendar.

```
┌─────────────────────────────────────────────────────────────┐
│  FRI    CURRENT APPOINTMENT             [Keep this time]    │
│  16     Friday, Oct 16 · 5:00 – 5:15 PM  [Cancel appointment] │
└─────────────────────────────────────────────────────────────┘
```

- **Keep this time** — `<Link href="/dashboard/lessons/:id">` (no change).
- **Cancel appointment** — opens `ConfirmDialog` with title "Cancel this lesson?" Confirm calls `DELETE /lessons/:id`; on success, redirect to `/dashboard`.

### RescheduleContent

Thin wrapper around `BookCalendarContent` that passes extra props:
- `excludeLessonId={lesson.id}` — passed through to all `fetchRangeAvailability` calls.
- `initialLocationId={lesson.locationId}` — pre-selects the existing pool (still changeable).
- `initialDurationMinutes={lesson.durationMinutes}` — pre-selects the existing duration.
- `initialCurrentDate` set to the week containing the existing lesson so it's visible on first render.

**Current slot decoration.** `BookCalendarContent` accepts an optional `currentSlot: { startsAt: string; durationMinutes: number }` prop. When provided, any slot cell whose time falls within `[currentSlot.startsAt, currentSlot.startsAt + currentSlot.durationMinutes)` is rendered with the "Current" visual state (dashed border), regardless of what the server returned for that slot.

**Bottom bar (reschedule mode).** The prop `rescheduleMode: true` changes the bar:

```
FROM              TO                [Confirm reschedule — disabled]
Fri, Oct 16       Pick a new time
5:00 PM
```

When a new slot is picked:

```
FROM              TO                [Confirm reschedule — enabled]
Fri, Oct 16       Wed Oct 14
5:00 PM       →   4:15 – 5:00 PM
                  Jason will confirm this one  ← if needsApproval changed
```

### rescheduleAction

Server action in `RescheduleContent/actions.ts`. Calls `PATCH /lessons/:id` with the new `startsAt`, `durationMinutes`, and `locationId` (if either of the latter changed). On success: `router.push('/dashboard?booked=' + lessonId)` — reusing the same `BookingConfirmDialog` as new bookings.

### BookingConfirmDialog extension

```typescript
interface Props {
  lesson: UpcomingLesson;
  fromSlot?: { startsAt: string; locationName: string }; // reschedule only
}
```

When `fromSlot` is present, insert a row above the lesson details:

```
Moved from
Fri, Oct 16 · 5:00 PM · Sunset Pool  →  (existing details below)
```

### Legend update

When in reschedule mode, add "Current" to the legend.

### Rules

- The `excludeLessonId` must belong to the caller's household; the page validates this server-side before rendering the reschedule screen.
- Viewers: the reschedule page redirects them away (server-side check in `page.tsx`).
- The "Cancel appointment" button is only rendered for `manager` and `owner` roles; never for viewers.
- Changing pool or duration in the config row re-fetches availability with the new params. The `needsApproval` state updates in the bottom bar live.
- After cancel from the reschedule screen, redirect to `/dashboard` (not the lesson detail, since the lesson is now canceled).

### Tests

- `CurrentAppointmentCard` renders the existing lesson's time.
- "Keep this time" renders as a link to the lesson detail.
- "Cancel appointment" button opens the confirm dialog.
- Confirm dialog cancel does not navigate.
- Confirm dialog confirm calls `DELETE /lessons/:id` and redirects.
- `RescheduleContent` pre-selects the existing pool and duration.
- The current slot is decorated in the grid (checked via aria-label or className).
- `BookingConfirmDialog` with `fromSlot` shows the "Moved from" row.
- `BookingConfirmDialog` without `fromSlot` does not show the "Moved from" row.
- Viewer: reschedule page redirects to lesson detail.

### Out of scope

- Coach-initiated reschedule on behalf of a household (existing PATCH endpoint already supports it; no new UI).
- Bulk reschedule.

---

## Cross-cutting concerns

**Accessibility.**
- Every slot cell is a `<button>` (or a non-interactive `<div>` for closed cells) with a full `aria-label`: `"[Full weekday], [Month] [day], [time], [state]"` — e.g., `"Wednesday, October 14, 4:15 PM, available"` or `"Thursday, October 15, closed"`.
- The bottom bar is `role="region"` with `aria-label="Booking selection"`.
- All tap targets are at minimum 44px tall.
- `aria-pressed` on selected slot cell.
- `aria-current="date"` on today's column header / day cell.

**All times in Los Angeles time.** Grid labels, bottom bar, current appointment card, and confirmation modal all format times via `Intl.DateTimeFormat` with `timeZone: "America/Los_Angeles"`.

**44px tap targets.** All cells in week view: `min-height: 44px` (currently the 15-min rows are shorter in the mock; we expand them to meet the tap-target rule). On phone, time-list rows: `min-height: 44px`.

**Dark mode.** All tokens work in both themes automatically. No hardcoded colors. The "Your pick" highlight uses `bg-button-primary-background text-button-primary-text`; the "Current" dashed border uses `border-accent-on-section`.

**Reduced motion.** Loading skeleton transitions and the bottom bar slide-in use `@media (prefers-reduced-motion: reduce)` guards matching `globals.css` conventions.

**Old `BookLessonContent` removal.** PR B deletes the entire `apps/web/src/content/BookLessonContent/` folder and `apps/web/src/app/dashboard/book/page.tsx` is replaced. Any test in `__tests__/` that imports from `BookLessonContent` must be migrated or deleted in the same PR.
