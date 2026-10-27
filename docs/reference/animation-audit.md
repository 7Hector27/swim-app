# Animation audit

A read-only pass over `apps/web/src` for places where motion would help, grounded in the `animate` skill and the motion portion of `emil-design-eng`. Guardrails for every suggestion: transform/opacity only, under 300ms (unless the recipe says otherwise), respects `prefers-reduced-motion`, works on touch. The project already has `--ease-out-strong` and `--ease-drawer` tokens on `:root` in `apps/web/src/styles/globals.css:5`; reuse those.

## Priority queue

| # | Where | What animates | Why it helps | Recipe | Priority |
| --- | --- | --- | --- | --- | --- |
| 1 | ReviewSheet open/close (`content/BookCalendarContent/ReviewSheet.tsx:74`) | Mobile: slide up from bottom; tablet: slide in from right | High-traffic batch-booking flow; appears abruptly today | Drawer | High |
| 2 | ReviewSheet success state (`ReviewSheet.tsx:95,115`) | Crossfade "Review your lessons" into "You're set" | End of a critical flow; the sudden text swap undersells the moment | Masking a crossfade (opacity, 250ms) | High |
| 3 | BookingRequestsCard batch expand (`content/CoachDashboardContent/BookingRequestsCard.tsx:80,147`) | Expand/collapse the per-batch lesson list | Coach taps this constantly; height snap is jarring and makes it unclear what changed | Accordion (height + opacity) | High |
| 4 | Pick row removal (`ReviewSheet.tsx:277` and PickList rows) | Row exit (opacity + translateY) before unmount | A pick disappearing silently reads as a bug | Toast-style exit (opacity + 100% translate) | Medium |
| 5 | Approve-all batch group (`BookingRequestsCard.tsx:102,106`) | The entire BatchGroup fades/collapses out when `onBatchApproved` fires | Confirms the destructive action and smooths the list reflow | Accordion exit + opacity | Medium |
| 6 | Step3Success body (`content/CoachBookLessonContent/Step3Success.tsx`) | Stagger the icon, headline, details card, buttons on mount | Shown once per booking; a brief celebration earns its budget | Stagger | Medium |
| 7 | Booking-mode switch (Single / Multiple / Recurring) in `content/BookCalendarContent/BookCalendarContent.tsx:1339` | Underline / pill indicator slides between the three tab buttons | Current implementation changes `aria-current` + colors instantly; a sliding indicator makes the switch legible when the content below also shifts | Tab indicator with clip-path | Medium |
| 8 | Submit buttons' pending state (`BottomBar.tsx:78`, `Step2TimePicker.tsx:355`, `ReviewSheet.tsx:149`, reschedule bars) | Spinner → label crossfade when `isSubmitting` flips | Spinners already exist (`animate-spin`); the swap in and out of the label flickers | Masking a crossfade (opacity + blur 2px, 200ms) | Low |
| 9 | ConfirmDiscardDialog (`content/BookCalendarContent/ConfirmDiscardDialog.tsx`) | Match ConfirmDialog's scale + fade | Appears mid-flow when switching booking modes with picks in progress; today it uses a bare `<dialog>` without the shared modal CSS | Modal | Low |
| 10 | Pick added to selection (`BookCalendarContent.tsx` pick array) | Picked cell scales from 0.95 to 1 as it joins the list; adjacent list items shift via Motion layout animation | Confirms the tap and visually links the slot cell to the list row | Button press (on the cell) + list reflow | Low |

## Opportunities, in detail

### 1. ReviewSheet open/close — High

- **Where:** `content/BookCalendarContent/ReviewSheet.tsx:74-156`.
- **Behavior:** Native `<dialog>` opened via `dialog.showModal()` in a `useEffect`. Mobile uses bottom-sheet positioning (`fixed bottom-0`), tablet+ uses a right-side 420px panel. No CSS transition today, so it pops in.
- **Recipe:** Drawer. Mobile reads as a bottom sheet (`translateY(100%) → 0`), tablet reads as a side sheet (`translateX(100%) → 0`). Both at 300ms with `--ease-drawer`. Backdrop opacity in parallel.
- **Why:** This is the sheet the user has to open on every batch booking (Multiple, Recurring). The exit path needs to match the entry so swipe-to-dismiss would be obvious if ever added.
- **Reduced motion:** Fall back to opacity-only.

### 2. ReviewSheet success state — High

- **Where:** `ReviewSheet.tsx:95` (heading swap) and `ReviewSheet.tsx:115` (body swap between `ReviewContent` and `SuccessContent`).
- **Behavior:** Submitting flips `props.success` and the two blocks swap instantly in the same dialog.
- **Recipe:** Masking a crossfade — short opacity transition (200-250ms) on both blocks, optionally with a 2px blur during the overlap to hide the simultaneous mount/unmount.
- **Why:** Preventing a jarring change (the user just tapped Book; the sheet is still open but every string inside changes).

### 3. BookingRequestsCard batch expand — High

- **Where:** `content/CoachDashboardContent/BookingRequestsCard.tsx:80,147`.
- **Behavior:** `const [expanded, setExpanded] = useState(false)` toggles the per-batch lesson list via `{expanded && <div>…</div>}`. Hard mount/unmount, no transition.
- **Recipe:** Accordion. Project already has a `details::details-content` block in `styles/globals.css:75-94` for FAQ; the same pattern (height + opacity, 200-250ms, `--ease-out-strong`) applies here if you convert this to `<details>`/`<summary>`, or measure the content height and animate manually.
- **Why:** Coaches tap through batch groups many times per morning. Height snap costs scroll position awareness every time.

### 4. Pick row removal — Medium

- **Where:** `ReviewSheet.tsx` row list (around line 237 onward); the pick list in `BookCalendarContent.tsx:1552` block (also used by Multiple and Recurring bottom bars).
- **Behavior:** Removing/skipping a row toggles state and the row unmounts without transition.
- **Recipe:** Toast-style exit — fade + slight `translateY(-4px)` or horizontal slide, 150-200ms with `--ease-out-strong`, before the actual unmount. Keyframe-less via CSS transition on a `data-leaving` attribute, or Motion's `AnimatePresence` if Motion is pulled in for the drawer anyway.
- **Why:** Removal is a destructive action; silent disappearance reads as "did something happen?".

### 5. Approve-all batch group — Medium

- **Where:** `BookingRequestsCard.tsx:102,106` (`approveBatchPendingAction` and the `onBatchApproved` callback that filters lessons out of state).
- **Behavior:** After the approve-all server action resolves, the parent filters its lesson list and the whole `<BatchGroup>` unmounts.
- **Recipe:** Same accordion exit plus a short opacity fade on the group itself (200-250ms). The lessons that remain reflow via a single parent transition.
- **Why:** Confirms the action and smooths what otherwise is a jump cut on the dashboard.

### 6. Step3Success stagger — Medium

- **Where:** `content/CoachBookLessonContent/Step3Success.tsx`.
- **Behavior:** Static JSX; appears all at once.
- **Recipe:** Stagger (`RECIPES.md` stagger block). 30-60ms between items, 300-400ms total, `--ease-out-strong`, `@starting-style { opacity: 0; transform: translateY(8px); }`.
- **Why:** Shown rarely (end of a coach booking) so the "delight budget" applies.

### 7. Booking-mode switch indicator — Medium

- **Where:** `content/BookCalendarContent/BookCalendarContent.tsx:1339`. Three pill-style buttons (Single, Multiple, Recurring) that currently flip `aria-current` and color only. Mode switch also changes the content below the tabs significantly.
- **Recipe:** Tab indicator with `clip-path` — the recipe in `RECIPES.md` fits. 220-250ms, `--ease-in-out`, duplicate layer clipped to the active tab's bounds.
- **Why:** The content under the tab list reshapes; a moving indicator ties the before/after together and prevents the reader from losing orientation.

### 8. Submit button pending state — Low

- **Where:** `BottomBar.tsx:78`, `ReviewSheet.tsx:149`, `Step2TimePicker.tsx:355`, `BookCalendarContent.tsx:1117`, `content/RescheduleContent/RescheduleContent.tsx:461`, `content/CoachRescheduleContent/CoachRescheduleContent.tsx:463`.
- **Behavior:** `animate-spin` SVG swaps in; label swaps out. Instant swap, which flickers.
- **Recipe:** Short opacity crossfade (150-200ms) on the button's inner contents, optionally with a 2px blur during the swap (the "mask a crossfade" recipe).
- **Why:** Low priority because the state is brief; but the flicker is visible on slower connections.

### 9. ConfirmDiscardDialog — Low

- **Where:** `content/BookCalendarContent/ConfirmDiscardDialog.tsx`.
- **Behavior:** Appears when switching booking modes mid-selection. Not using the shared `components/ConfirmDialog` so it does not inherit the scale + fade.
- **Recipe:** Modal (centered scale 0.95 → 1 + opacity, 220ms, `--ease-out-strong`). Easiest fix: route this through the shared `ConfirmDialog` component.
- **Why:** Interrupts a flow; the sibling `ConfirmDialog` already animates and the inconsistency is noticeable.

### 10. Pick-to-list hand-off — Low

- **Where:** `content/BookCalendarContent/SlotCell.tsx` and the Multiple/Recurring pick list in `BookCalendarContent.tsx:1552` area.
- **Behavior:** Tapping a slot cell adds it to the pick list immediately with no visual bridge.
- **Recipe:** On the cell, scale(0.95 → 1) + opacity on the selection ring. On the list, Motion `layout` animation (or a simple transform-only entrance on the newly added row). Decorative — do not block interaction.
- **Why:** Nice-to-have. Only touch this once Motion is already in the bundle for the ReviewSheet drawer; don't add a dependency just for this.

## Loading states

The project ships two spinner usages (`animate-spin` SVGs) inside submit buttons and the reschedule picker; no skeletons or Suspense fallbacks with animation. The existing spinners are fine as-is. The gap is the swap in and out of pending state, covered in #8.

## Already animated, leave alone

- **ConfirmDialog** (`components/ConfirmDialog/ConfirmDialog.module.css`) — scale(0.95 → 1) + opacity, 220ms, `--ease-out-strong`, `@starting-style`, reduced-motion variant that drops the transform. Textbook modal.
- **BookingConfirmDialog** (`content/ParentDashboardContent/BookingConfirmDialog.module.css`) — same recipe as above. Consistent.
- **CoachAvailability dialogs** (`content/CoachAvailabilityContent/CoachAvailabilityContent.module.css:1-56`) — shared `.dialog` class, same recipe. All four modals (DefaultHoursModal, OverrideFormModal, SeasonFormModal, ImpactWarningModal) wear it correctly.
- **CoachNav MoreSheet** (`components/CoachNav/CoachNav.module.css:12-71`) — `translateY(100% → 0)` + opacity, 260ms, `--ease-out-strong`, reduced-motion fallback. Proper drawer.
- **FAQ accordion** (`content/HomepageContent/FaqSection.module.css` + `styles/globals.css:75-94`) — native `<details>` with `::details-content` interpolate-size, 250ms, `--ease-out-strong`, reduced-motion safe.
- **HeroSection stagger** (`content/HomepageContent/HeroSection.module.css`) — opacity + `translateY(12px)` fade-in with 60-240ms delays, 400ms total.
- **HeroBubbleBg** (`content/HomepageContent/HeroBubbleBg.module.css`) — infinite `bubbleRise` + `bubbleSway`, paused via `IntersectionObserver`, reduced-motion makes bubbles static.
- **CoachPhotoDeck carousel** (`content/HomepageContent/CoachPhotoDeck.module.css`) — direction-aware enter/exit, Ken Burns zoom, caustic overlays. Decorative, properly scoped, reduced-motion safe.
- **ScrollReveal / ScrollFadeArea** (`components/ScrollReveal/*`, `content/HomepageContent/ScrollFadeArea.module.css`) — generic reveal utility, 400ms, respects reduced motion.
- **CoachWeekLessonCard** chevron rotation on the Evaluate menu (`components/CoachWeekLessonCard/CoachWeekLessonCard.tsx:148`) — `rotate-180` with 150ms `ease-out`, `motion-reduce:transition-none`.
- **Pressable buttons across the app** — `active:scale-[0.97]` + `motion-reduce:transform-none` is applied consistently (130+ sites). Standardized.

## Red flags found during the pass

- **CoachPhotoDeck exit curve** (`content/HomepageContent/CoachPhotoDeck.module.css:46,62`) uses `cubic-bezier(0.4, 0, 1, 1)` (ease-in). Intentional on an exiting marketing photo (comment says so), and it is paired with a shorter duration on exit than entry, which is the asymmetric pattern Emil endorses. Leave alone.
- **Caustic overlays** (`CoachPhotoDeck.module.css:164,168`) use `ease-in-out infinite`. Decorative, scoped, reduced-motion safe. Leave alone.
- **Native `<dialog>` without CSS** — ReviewSheet (#1) and ConfirmDiscardDialog (#9) are the only two dialogs that bypass the shared animated styles. Everything else routes through ConfirmDialog or an inline `.dialog` CSS module that mirrors it.
- No `transition: all`, no `scale(0)` entrances, no `ease-in` on functional UI, no UI durations over 300ms outside of the drawer sheet (260ms is correct).

## Rules reminder for implementation

Any work driven by this doc must:

- Animate `transform` and `opacity` only (`clip-path` for the tab indicator, `height` for the accordion are the sanctioned exceptions).
- Stay under 300ms for UI; drawers up to 500ms if the content distance warrants it.
- Reuse `var(--ease-out-strong)` / `var(--ease-drawer)` from `styles/globals.css`; do not invent new curves.
- Ship with a `prefers-reduced-motion: reduce` variant that keeps opacity and drops transforms.
- Gate `:hover` motion with `@media (hover: hover) and (pointer: fine)` where relevant (touch triggers hover on tap).
- Use CSS transitions (not keyframes) for anything the user can retrigger quickly (pick removal, batch group collapse, success swap).
