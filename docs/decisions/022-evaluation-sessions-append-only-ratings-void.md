# ADR 022 — Evaluation sessions, append-only ratings, and void

**Status:** Accepted
**Date:** 2026-10-14

---

## Context

The swimmer evaluation system (PR E-1) introduces two new tables: `evaluation_sessions` and `skill_ratings`. Several design questions arose that have long-term data-model consequences:

1. **Should ratings be mutable?** Coaches sometimes enter the wrong grade. How should corrections work?
2. **Should session metadata (date, context, coaching priority) be editable after creation?**
3. **How should "this rating is wrong" be expressed in the data model?**

---

## Decisions

### 1. Ratings are append-only (except the three void fields)

`skill_ratings` rows are never updated after insert. If a coach enters the wrong grade:

- Within 10 minutes of `created_at`: the coach may **delete** the rating (undo window, enforced at the API layer in E-3).
- After 10 minutes: the coach must **void** the rating and, if appropriate, insert a new one.

The only columns that may change after insert are `voided_at`, `void_reason`, and `void_by` — set atomically by the void endpoint.

**Rationale:** An append-only history is the simplest model that preserves a complete audit trail. Mutable grades would require either a shadow history table or accepting that the original observation is lost. The 10-minute undo window covers accidental taps; void covers deliberate corrections with a reason on record.

**Enforcement:** API layer only (not a DB trigger). The `updated_at` column is present and will reflect the timestamp of the void if applied, but no other update path exists.

### 2. Session metadata is immutable after creation

`evaluation_sessions` stores what was true at the time of the observation: swimmer, coach, category, date, context, and coaching priority. These are not editable.

**Rationale:** Changing session metadata retroactively could misrepresent when or why an observation was made. If the coach made a mistake (wrong date, wrong swimmer), they should create a new session and void any ratings that belong to the incorrect one.

### 3. Void keeps the row; voided ratings are excluded from all calculations

A voided rating keeps its row. The three void fields (`voided_at`, `void_reason`, `void_by`) are set together (enforced by the `void_fields_consistent` CHECK constraint) or are all null.

Voided ratings are:
- **Excluded** from all averages, rollups, and start grade calculations.
- **Treated as null (not assessed)** by the dependency map function — the chain stops there.
- **Hidden** from progress charts and the swimmer's skill summary.
- **Visible** in the full rating history view, with the void reason and voiding coach displayed.

**Rationale:** Hard-deleting a rating is the simplest option but loses the record entirely. Soft-delete via `voided_at` keeps the audit trail. The exclusion rules are simpler than a shadow table while still showing coaches the correction history.

---

## Constraints enforced at the DB layer

| Table | Constraint | Rule |
|-------|-----------|------|
| `evaluation_sessions` | `coaching_priority_not_blank` | `coaching_priority <> ''` |
| `skill_ratings` | `grade_xor_no_concept` | Grade is 1–5 (with `no_concept=false`) OR `no_concept=true` (with no grade). `not_legal` is orthogonal and can accompany a 1–5 phantom grade. |
| `skill_ratings` | `capacity_value_and_unit_consistent` | Both `capacity_value` and `capacity_unit` set, or both null. |
| `skill_ratings` | `measurement_value_and_unit_consistent` | Both `measurement_value` and `measurement_unit` set, or both null. |
| `skill_ratings` | `void_fields_consistent` | All three void fields set together, or all null. |

## Constraints enforced at the API layer (E-3)

- `side` is only set when `skills.rated_per_side = true`.
- `fault_tag` values must come from `skills.fault_tags` for the rated skill.
- The session's `category_id` must match the skill's `category_id`.
- Only the creating coach may void or undo a rating.
- The undo window is 10 minutes from `created_at`; delete is rejected after that.

---

## Alternatives considered

**Mutable grades with a shadow table:** A `skill_rating_history` table would log every change. Rejected — two tables are harder to query than one append-only table with a void flag.

**Delete instead of void:** Simple but loses the record. A coach who accidentally marked a skill Not Legal and then deleted it leaves no trace. Void keeps the correction visible to both the coach and (eventually) the parent view.
