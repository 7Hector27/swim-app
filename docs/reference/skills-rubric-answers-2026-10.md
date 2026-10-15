# Skills Rubric — Jason's Phase 1 Answers (October 2026)

Answers to the Phase 1 design questions for the swimmer evaluation system.

---

## The big ones (hard to change once you start rating)

**1. Is the 1–5 scale (Emerging, Developing, Competent, Advanced, Mastery) final?**

Yes.

---

**2. Breathing timing, stroke-breath coordination, and breakout are rated separately for each stroke. Body rotation, rhythmic breathing, and bilateral breathing are one shared grade. Is that right?**

No — each of those applies to specific strokes only:

- Body rotation: freestyle and backstroke only.
- Rhythmic breathing: freestyle, butterfly, and backstroke.
- Bilateral breathing: freestyle only — and it is **calculated** (not rated directly). Its grade is the weaker of the left and right freestyle breath timing grades.

---

**3. Starts: rate the 6 parts separately and let the app calculate the start grade, or rate the whole start as one number? If parts, do all 6 need a rating for the start to get a grade?**

Rate the 6 components separately; the app calculates the start grade as the average, rounded down. All 6 must be rated before a start grade appears. Partial ratings are saved and the start shows "In progress" until complete.

---

**4. Underwater dolphin kick: one shared grade for free and fly, a separate one for back. OK?**

No. Three separate grades — one per stroke:

- Freestyle underwater dolphin kick (its own grade).
- Fly underwater dolphin kick (its own grade).
- Backstroke underwater dolphin kick (separate grade with its own rubric; higher speed/distance standard because backstroke underwaters are typically faster).

---

**5. Anything to add, remove, split, or merge in the skill list?**

- **Body rotation**: remove the shared grade; rate rotation separately for freestyle and backstroke.
- **Freestyle breathing**: breath timing and stroke hold on breath (renamed from stroke-breath coordination) are separate skills, each rated left and right. Bilateral breathing is calculated from the left and right grades, not rated.
- **Fault tags**: each skill gets a short list of common faults the coach can tap when rating (e.g. breaststroke breath timing: head lifts late, lifts early, returns too slow, returns too fast), so two swimmers with the same grade show what's actually different.
- **Rhythmic breathing**: applies to free, fly and back. Drop backstroke breath timing and stroke-breath coordination.
- **Tempo**: rated per stroke. Drop breaststroke stroke rate (same measurement as breaststroke tempo). Use one unit for tempo everywhere (stroke cycles per minute).
- **Fly stroke hold on breath**: remove the body rotation link (fly doesn't rotate).
- **Finishing**: split into four, one per stroke.
- **Add**: Backstroke start, Sculling / feel for the water, and a Water confidence category (submerging, front float, back float, treading water, getting to the wall).
- **Undecided**: add Block setup / stance as a 7th start component?

---

## What depends on what

**6. Each stroke's head position depends on buoyancy and balance. OK?**

No — reverse it. Head position affects buoyancy and balance. Buoyancy & balance builds on head position (overall) and core stability. Each stroke's head position does not build on buoyancy & balance.

---

**7. Fly breathing timing depends on fly head position and breath control, not stroke timing. Correct?**

No. Fly breath timing builds on fly head position and two-kick rhythm. The head rises with the pull and second kick, stays up until the arms are about halfway through recovery, and is fully submerged before the catch.

---

**8. Breaststroke breakout depends on breaststroke timing. Correct?**

Yes. Breaststroke breakout builds on the pullout and breaststroke timing.

---

**9. Fly breakout depends on two-kick rhythm. Correct?**

Builds on underwater dolphin kick (fly). Two-kick rhythm is kept as a secondary dependency — confirm with Jason.

---

**10. Tempo: your doc says it depends on stroke timing, but which stroke? Rate tempo per stroke, or leave it unlinked?**

Rate tempo per stroke. Each builds on that stroke's timing skill:

- Free tempo → freestyle stroke timing
- Back tempo → backstroke stroke timing
- Breast tempo → breaststroke timing
- Fly tempo → two-kick rhythm

Measured at race pace in stroke cycles per minute, plus a grade.

---

**11. Stroke count: freestyle only for now, or per stroke?**

Per stroke. Merge "Distance per stroke" into stroke count (same measurement).

---

**12. Freestyle flip turn also counts for the IM breast-to-free switch. Fine to track it as freestyle only?**

Yes, track the freestyle flip turn as freestyle only. Same-stroke turns inside an IM use that stroke's regular turn rating. Remove "IM breast→free" from the freestyle flip turn's "Used in"; breast to free is an open turn with its own rating.

---

**13. IM turns (fly to back, back to breast, breast to free) are their own skills. OK?**

Yes. IM stroke-change turns are their own skills:

- Fly → back: open turn
- Back → breast: three separate skills — open turn, bucket turn, crossover turn
- Breast → free: open turn

---

**14. Your head position descriptions are used for all four strokes. Same wording for each, or different per stroke?**

Different per stroke. Keep the shared 1–5 progression (cued → practice pace → race pace → full race), and add a stroke-specific definition of correct head position for each stroke.

---

**15. Breaststroke stroke-breath coordination lists body rotation, but breaststroke doesn't really rotate. Drop it?**

Yes. Drop body rotation from breaststroke and butterfly stroke-hold-on-breath; neither stroke rotates. Freestyle stroke-hold-on-breath links to freestyle rotation (not a shared body rotation grade). Backstroke stroke-hold-on-breath was dropped in answer 5.

---

## Grading rules

**16. Overall head position: the average of the four strokes, or the lowest one? If average, round down or to the nearest?**

Average of the rated strokes, rounded down (same rule as starts). Strokes not yet assessed are left out.

---

**17. If you tap the wrong rating: is an undo for about 10 minutes after saving enough, or do you also want to void older ratings?**

Both. Undo for 10 minutes after saving, plus the ability to void any older rating with a reason. Voided ratings are hidden from charts and averages but kept in the record.

---

**18. When the app flags what's holding a swimmer back, what counts as "low": 2 or below, anything lower than the skill it's holding back, or either?**

Either: a foundation skill counts as low if it's 2 or below, or lower than the skill it supports. "Not legal" and "No concept" always count as low.

---

**19. How far back should it look: one step (body rotation), or keep going (body rotation, then core stability)?**

Keep going down the foundation chain while each skill is also low; stop at the first one that isn't. Example: if freestyle breathing is low, check freestyle rotation; if that's also low, check core stability. The deepest low skill is the top coaching priority.

---

## Grading rules (decided)

Not legal: the coach still gives the technique a 1–5 ("phantom" grade) to track development, but the rating is flagged "Not legal" in red. Not legal counts as 0 in any average or rollup and is the top coaching priority. On progress charts it shows as a red DQ marker. If any start component is not legal, the whole start shows "Not legal." Breakouts surfacing past 15 m and illegal breaststroke breakouts are Not legal.

"Not legal" only appears on skills with a legality rule: start components, turns, breakouts, stroke kicks (freestyle kick, backstroke kick, breaststroke kick mechanics, butterfly dolphin kick).

Labels below 1 (not counted in averages): "Not assessed" (coach hasn't observed it yet) and "No concept" (observed, swimmer can't do it at all).

**Open: does Not legal apply to beginners in drills and practice, or only in race context / competitive swimmers?** Default for now: allowed in any context.
