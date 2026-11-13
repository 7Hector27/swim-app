// Account deletion engine (ADR 034).
//
// Pure DB-side orchestration. The route handler calls `runAccountDeletion`
// inside a `db.transaction()`; the orchestrator takes an advisory lock, locks
// the household row FOR UPDATE to serialize the solo-vs-leave decision against
// a concurrent second member deleting, then dispatches the scrubs / deletes.
// External side effects (Supabase Auth hard-delete, per-lesson Google Calendar
// sync) are intentionally out of this module — the route enqueues them as
// post-commit tasks tracked by `account_deletion_jobs`.

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../db/schema";
import {
  accountDeletionJobs,
  bookingBatches,
  bulkCancellations,
  coachAuditLog,
  coachNotifications,
  evaluationDrafts,
  evaluationSessions,
  householdAuditLog,
  householdInvites,
  householdMembers,
  households,
  LESSON_EMAIL_OUTBOX_NON_TERMINAL_STATUSES,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  meetSwims,
  profiles,
  ratingFaultTags,
  skillRatings,
  swimmerClubs,
  swimmers,
  leagueRegistrations,
  coachNotes,
} from "../../db/schema";
import type { CashOutBreakdown } from "@swim-app/shared";

import { getActiveCoachProfile } from "../../lib/coachProfile";
import { getEnv } from "../../lib/env";
import {
  executeCashOutInTx,
  getCashOutBreakdown,
  getHouseholdBalance,
  refundLessonCharge,
} from "../balance";
import { cashRefundJobs } from "../../db/schema";
import type { AccountDeletedEmailLesson } from "../emails/accountDeletedTypes";
import { enqueueCoachAccountDeletedEmail } from "../emails/coachAccountDeletedOutbox";
import { formatLessonTimeDisplay } from "../emails/format";
import { AlreadyDeletedError, OwnerMustTransferFirstError } from "./errors";
import { ACCOUNT_DELETION_INITIAL_DELAY_SECONDS } from "./retry";
import { buildAccountDeletedScheduleUrl } from "./scheduleUrl";

// Imported so the solo-deletion path can null `household_balance_ledger`
// identity columns inside the same transaction as the household DELETE.
import { householdBalanceLedger, userPolicyAcceptances } from "../../db/schema";

type Tx = PostgresJsDatabase<typeof schema>;

export type DeletionScope = "solo" | "leave";

// Single source of truth for which scope a given household composition
// resolves to. Preview and confirm both call this so the UI can never
// show a different story than the engine actually enforces. Pure
// function — no DB access — so it's trivially testable and callable
// from the preview path (no lock) and the confirm path (holds the
// FOR UPDATE on the household row) alike.
//
// Rules (ADR 034):
//  - caller is the only member → solo (full teardown)
//  - caller is owner, every other member is a viewer → solo. Viewers
//    don't manage swimmers, so leaving them behind in an ownerless
//    household serves nobody; take the kids' data with the owner and
//    release the viewers to be re-invited.
//  - caller is not an owner and another owner/manager remains → leave
//  - caller is owner and another owner/manager remains → must_transfer
//    (the confirm route throws OwnerMustTransferFirstError; the
//    preview sets ownerMustTransferFirst=true so the UI blocks the
//    form and surfaces the transfer link)
export type DeletionScopeDecision =
  | { kind: "solo" }
  | { kind: "leave" }
  | { kind: "must_transfer" };

export function decideDeletionScope(
  callerRole: "owner" | "manager" | "viewer",
  otherMemberRoles: ReadonlyArray<"owner" | "manager" | "viewer">,
): DeletionScopeDecision {
  if (otherMemberRoles.length === 0) return { kind: "solo" };
  const otherAdultCount = otherMemberRoles.filter(
    (role) => role === "owner" || role === "manager",
  ).length;
  if (otherAdultCount === 0) {
    // Reachable only when the caller is the owner (one-owner-per-
    // household invariant, enforced by the partial unique index).
    return { kind: "solo" };
  }
  if (callerRole === "owner") return { kind: "must_transfer" };
  return { kind: "leave" };
}

export interface AccountDeletionPreview {
  householdName: string;
  memberCount: number;
  swimmers: ReadonlyArray<{ firstName: string; lastInitial: string }>;
  pastLessonCount: number;
  futureLessonCount: number;
  ownerMustTransferFirst: boolean;
  // The caller's household role. Phase 4 UI branches copy on this so
  // leave and owner-with-only-viewers show distinct explanations. Null
  // only in the orphan "profile with no household" fallback.
  callerRole: "owner" | "manager" | "viewer" | null;
  // ADR 036 Phase 8 Part A: pre-deletion balance snapshot in integer
  // cents. The UI surfaces a non-blocking note when > 0 — Part B of
  // Phase 8 (unused-balance policy) is still blocked on Jason, so
  // deletion proceeds with the ledger anonymized either way. Null only
  // in the orphan "profile with no household" fallback.
  balanceCents: number | null;
  // ADR 036 Phase 8 Part B Stop 2: pre-deletion cash-out breakdown so
  // the parent sees "$X refunded to card, $Y forfeited (bonus credit)"
  // on the confirmation step. Null when `balanceCents` is zero or the
  // orphan fallback fires — nothing to refund.
  cashOutPreview: CashOutBreakdown | null;
}

// ADR 036 Phase 8 Part B Stop 2: cash-out side effects captured inside
// the deletion transaction. Surfaced on the confirm-endpoint response so
// the parent's deletion confirmation UI can render the amounts without a
// follow-up email (`executeCashOutInTx` is called with `skipEmail: true`).
export interface CashOutExecutionSummary {
  breakdown: CashOutBreakdown;
  refundJobCount: number;
  needsManualHandlingCents: number;
  // Drain-eligible cash_refund_jobs ids the route hands to
  // `kickCashRefundDrain` so Stripe is called immediately after
  // commit rather than on the next cron tick (ADR 036 Phase 8 Part B).
  drainEligibleJobIds: string[];
}

export interface RunAccountDeletionResult {
  scope: DeletionScope;
  jobId: string;
  // Future-lesson ids cancelled by this deletion. Used by the route's
  // post-commit path to feed the coach account-deleted summary (times
  // only); the retry drain reads the authoritative set from
  // accountDeletionJobs.anonymizedLessonIds instead.
  cancelledFutureLessonIds: string[];
  // All anonymized lesson ids for this deletion (past + future). The
  // post-commit fan-out walks this list to patch past Google events
  // and delete future ones; the retry drain re-reads it from the
  // deletion job row.
  anonymizedLessonIds: string[];
  // Outbox row id for the coach-side account-deleted email (ADR 034).
  // Non-null only on the solo path when an active coach profile exists.
  // The route's post-commit code queues a microtask send; the drain is
  // the fallback for a failed or missed immediate send.
  coachAccountDeletedOutboxId: string | null;
  // ADR 036 Phase 8 Part B Stop 2: cash-out side effects captured
  // inside the solo deletion transaction. Null on the leave path and
  // on solo paths with a zero balance (no cash-out ran).
  cashOut: CashOutExecutionSummary | null;
}

export async function previewAccountDeletion(
  tx: Tx,
  profileId: string,
  now: Date,
): Promise<AccountDeletionPreview> {
  const membershipRows = await tx
    .select({ householdId: householdMembers.householdId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.profileId, profileId))
    .limit(1);
  const membership = membershipRows[0];
  if (!membership) {
    // Deleted profile with no household membership — shouldn't happen for a
    // caller that passed requireUser, but tolerate it with an empty preview
    // rather than throwing.
    return {
      householdName: "",
      memberCount: 0,
      swimmers: [],
      pastLessonCount: 0,
      futureLessonCount: 0,
      ownerMustTransferFirst: false,
      callerRole: null,
      // Orphan profile: no household → no ledger rows attributable to it.
      balanceCents: null,
      cashOutPreview: null,
    };
  }

  const householdId = membership.householdId;

  // ADR 036 Phase 8 Part A: pre-deletion balance snapshot. The preview
  // page surfaces a non-blocking note when balanceCents > 0 so the
  // parent knows deletion won't auto-refund. Reading without the
  // balance lock is safe: the preview is advisory, and confirm doesn't
  // gate on this value (Part B is still blocked on Jason).
  const balanceCents = await getHouseholdBalance(householdId, tx);

  const [householdRows, memberRows, swimmerRows, pastCount, futureCount] = await Promise.all([
    tx.select({ name: households.name }).from(households).where(eq(households.id, householdId)).limit(1),
    // Role is needed so the preview can run decideDeletionScope. Earlier
    // revisions only selected profileId and inferred must-transfer from
    // "owner && memberCount > 1" — that mismatched the engine's rule
    // when the only other members were viewers, blocking the UI on a
    // deletion the API would actually accept.
    tx.select({ profileId: householdMembers.profileId, role: householdMembers.role }).from(householdMembers).where(eq(householdMembers.householdId, householdId)),
    tx
      .select({ firstName: swimmers.firstName, lastName: swimmers.lastName })
      .from(swimmers)
      .where(and(eq(swimmers.householdId, householdId), sql`${swimmers.archivedAt} IS NULL`)),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(lessons)
      .where(
        and(
          eq(lessons.householdId, householdId),
          sql`${lessons.startsAt} <= ${now.toISOString()}::timestamptz`,
        ),
      ),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(lessons)
      .where(
        and(
          eq(lessons.householdId, householdId),
          // Mirror the filter in cancelFutureLessons so the preview's
          // count matches what the deletion actually cancels — any
          // future row that isn't already canceled/declined.
          notInArray(lessons.status, ["canceled", "declined"]),
          sql`${lessons.startsAt} > ${now.toISOString()}::timestamptz`,
        ),
      ),
  ]);

  const householdName = householdRows[0]?.name ?? "";
  const otherMemberRoles = memberRows
    .filter((m) => m.profileId !== profileId)
    .map((m) => m.role);
  const scopeDecision = decideDeletionScope(membership.role, otherMemberRoles);
  const ownerMustTransferFirst = scopeDecision.kind === "must_transfer";

  const swimmerPreview = swimmerRows.map((row) => ({
    firstName: row.firstName,
    lastInitial: row.lastName.length > 0 ? `${row.lastName.charAt(0).toUpperCase()}.` : "",
  }));

  // ADR 036 Phase 8 Part B Stop 2: pre-compute the cash-out breakdown
  // so the parent sees the same split the confirm flow will apply.
  // Advisory read (no balance lock) — the confirm path re-reads inside
  // the deletion transaction while holding the lock.
  const cashOutPreview = balanceCents > 0
    ? await getCashOutBreakdown(householdId, tx)
    : null;

  return {
    householdName,
    memberCount: memberRows.length,
    swimmers: swimmerPreview,
    pastLessonCount: pastCount[0]?.count ?? 0,
    futureLessonCount: futureCount[0]?.count ?? 0,
    ownerMustTransferFirst,
    callerRole: membership.role,
    balanceCents,
    cashOutPreview,
  };
}

// The one entry point the route calls. Must run inside db.transaction().
export async function runAccountDeletion(
  tx: Tx,
  profileId: string,
  authUserId: string,
  now: Date,
): Promise<RunAccountDeletionResult> {
  // Advisory lock: a second concurrent delete of the same account waits here
  // rather than racing the disabled_at idempotency check below.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${"account-deletion:" + profileId}))`,
  );

  const profileRows = await tx
    .select({
      id: profiles.id,
      disabledAt: profiles.disabledAt,
      role: profiles.role,
    })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) {
    throw new AlreadyDeletedError();
  }
  if (profile.disabledAt !== null) {
    throw new AlreadyDeletedError();
  }

  const membershipRows = await tx
    .select({
      householdId: householdMembers.householdId,
      role: householdMembers.role,
    })
    .from(householdMembers)
    .where(eq(householdMembers.profileId, profileId))
    .limit(1);
  const membership = membershipRows[0];
  if (!membership) {
    // Parent profile with no household membership. Treat as solo with no
    // household to delete — scrub the profile and enqueue the auth-user
    // delete so the orphan is cleaned up.
    await scrubProfile(tx, profileId, now);
    const jobId = await enqueueDeletionJob(tx, profileId, authUserId, "solo", []);
    return {
      scope: "solo",
      jobId,
      cancelledFutureLessonIds: [],
      anonymizedLessonIds: [],
      // Orphan-profile solo path. No household → nothing freed, but we
      // still send the "a family deleted" email since this is the full-
      // teardown branch. ADR 034's "always send on solo" applies.
      coachAccountDeletedOutboxId: await enqueueCoachAccountDeletedEmail(tx, {
        cancelledLessons: [],
        scheduleUrl: buildAccountDeletedScheduleUrl(getEnv().siteUrl, null),
        now,
      }),
      cashOut: null,
    };
  }

  const householdId = membership.householdId;

  // Lock the household row FOR UPDATE. Serializes a concurrent second
  // member's delete on the same household so the solo-vs-leave decision
  // can't race.
  await tx
    .select({ id: households.id })
    .from(households)
    .where(eq(households.id, householdId))
    .for("update");

  // Re-read membership under the lock. If an earlier adult just left this
  // household, the current scope might have flipped from leave to solo.
  const allMemberRows = await tx
    .select({ profileId: householdMembers.profileId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId));

  // Scope decision via the shared helper so the UI's preview can never
  // disagree with the engine. See decideDeletionScope above for the
  // full rules (solo / owner-with-only-viewers / leave / must_transfer).
  const otherMemberRoles = allMemberRows
    .filter((m) => m.profileId !== profileId)
    .map((m) => m.role);
  const scopeDecision = decideDeletionScope(membership.role, otherMemberRoles);
  if (scopeDecision.kind === "must_transfer") {
    throw new OwnerMustTransferFirstError();
  }
  const scope: DeletionScope = scopeDecision.kind;

  if (scope === "leave") {
    await scrubAuditPayloadsForLeave(tx, householdId, profileId);
    // Audit row for the leave action, written in the same tx per CLAUDE.md.
    await tx.insert(householdAuditLog).values({
      householdId,
      actorId: profileId,
      action: "member_deleted_account",
      targetProfileId: profileId,
    });
    await tx
      .delete(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.profileId, profileId),
        ),
      );
    await scrubProfile(tx, profileId, now);
    const jobId = await enqueueDeletionJob(tx, profileId, authUserId, "leave", []);
    // Leave path: the household lives on, Jason's schedule is
    // unchanged, nothing to email. ADR 034 explicitly keeps this
    // channel solo-only.
    return {
      scope: "leave",
      jobId,
      cancelledFutureLessonIds: [],
      anonymizedLessonIds: [],
      coachAccountDeletedOutboxId: null,
      cashOut: null,
    };
  }

  // Solo path. Full teardown.
  const cancelledFutureLessonIds = await cancelFutureLessons(tx, householdId, profileId, now);

  // ADR 036 Phase 8 Part B Stop 2: run cash-out INSIDE the deletion
  // transaction so the refund + write-off rows commit or roll back
  // with everything else. `cancelFutureLessons` already acquired the
  // per-household balance advisory lock, so the in-tx variant reuses
  // the same transaction without a second lock acquire (the xact lock
  // is session-scoped; re-taking it is a no-op). Email is skipped —
  // the parent sees the amounts on the confirm-endpoint response and
  // the account-deleted email instead.
  const cashOutResult = await executeCashOutInTx(tx, {
    householdId,
    actorId: profileId,
    opts: { skipEmail: true },
  });
  const cashOut: CashOutExecutionSummary | null =
    cashOutResult.cashRefundLedgerIds.length === 0
      && cashOutResult.writeOffLedgerId === null
      ? null
      : {
          breakdown: cashOutResult.breakdown,
          refundJobCount: cashOutResult.cashRefundJobIds.length,
          needsManualHandlingCents: cashOutResult.needsManualHandlingCents,
          drainEligibleJobIds: cashOutResult.drainEligibleJobIds,
        };

  // Load cancelled-lesson start times + location snapshot for the coach
  // summary notification AND the coach-side email, before the rows get
  // anonymized and lose their household / location linkage.
  // Pool label mirrors anonymizeHouseholdLessons's rule: a location
  // whose household_id is non-null is a family's home pool → "Home pool"
  // (never the address — same kids'-data posture as the notification).
  // A named pool (household_id IS NULL on the location) keeps its name.
  const freedLessonSummaries: Array<{ startsAt: Date; poolLabel: string }> =
    cancelledFutureLessonIds.length === 0
      ? []
      : (
          await tx
            .select({
              startsAt: lessons.startsAt,
              locationName: lessonLocations.name,
              locationHouseholdId: lessonLocations.householdId,
            })
            .from(lessons)
            .leftJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
            .where(inArray(lessons.id, cancelledFutureLessonIds))
            .orderBy(lessons.startsAt)
        ).map((row) => ({
          startsAt: row.startsAt,
          poolLabel:
            row.locationName === null
              ? "Home pool"
              : row.locationHouseholdId === null
                ? row.locationName
                : "Home pool",
        }));
  const futureLessonTimes = freedLessonSummaries.map((row) => row.startsAt);

  const anonymizedLessonIds = await anonymizeHouseholdLessons(tx, householdId, now);

  // Delete the household audit log BEFORE swimmers because
  // household_audit_log.target_swimmer_id is RESTRICT — a prior
  // swimmer_added audit entry blocks the swimmer DELETE otherwise.
  // The audit log cascades with the household at step bottom but we
  // delete explicitly here to clear the FK first.
  await tx.delete(householdAuditLog).where(eq(householdAuditLog.householdId, householdId));

  await hardDeleteHouseholdSwimmerData(tx, householdId);
  await scrubEmailOutboxForHousehold(tx, householdId, anonymizedLessonIds);
  await hardDeleteCoachNotificationsForHousehold(tx, householdId, anonymizedLessonIds);

  // Enqueue the job row before the summary notification so the summary's
  // `tag` can key off the job id — stable + already-unique, unlike a
  // timestamp-derived key. The job row has no FK into households/
  // profiles, so it is safe to insert before the household rows go.
  // Pass the anonymized lesson ids so the post-commit fan-out and retry
  // drain can walk them (past → patch, future → delete the Google event).
  const jobId = await enqueueDeletionJob(tx, profileId, authUserId, "solo", anonymizedLessonIds);

  if (futureLessonTimes.length > 0) {
    await insertAccountDeletedSummary(tx, futureLessonTimes, now, jobId);
  }

  // Coach-side email (ADR 034). Always enqueued on the solo path,
  // regardless of push settings / quiet hours — it's rare and it
  // actually changes Jason's schedule. Body lists the freed slots with
  // "Home pool" semantics (no addresses, no family or swimmer names),
  // or "No upcoming lessons were affected" when the list is empty.
  // Must run AFTER scrubEmailOutboxForHousehold so this new row's
  // all-null scope columns don't overlap with any scrub where-clause.
  const emailLessons: AccountDeletedEmailLesson[] = freedLessonSummaries.map(
    (row) => ({
      startsAtUtc: row.startsAt.toISOString(),
      startsAtLocalDisplay: formatLessonTimeDisplay(row.startsAt),
      poolLabel: row.poolLabel,
    }),
  );
  const { siteUrl } = getEnv();
  const firstFreedLessonUtc = freedLessonSummaries[0]?.startsAt ?? null;
  const emailScheduleUrl = buildAccountDeletedScheduleUrl(
    siteUrl,
    firstFreedLessonUtc,
  );
  const coachAccountDeletedOutboxId = await enqueueCoachAccountDeletedEmail(tx, {
    cancelledLessons: emailLessons,
    scheduleUrl: emailScheduleUrl,
    now,
  });

  // ADR 036 Phase 8 Part A: strip household_id + actor_id from this
  // household's balance ledger rows before the household row goes.
  // Append-only trigger from migration 0079 permits this; the rows
  // themselves survive for tax retention.
  //
  // Stripe: we don't create a Stripe customer per household today —
  // top-ups + package purchases ride through ephemeral Checkout sessions
  // (see apps/api/src/services/stripe/*). Nothing to delete or redact on
  // Stripe's side. Revisit if we ever persist a customer id.
  await anonymizeHouseholdLedger(tx, householdId);
  // ADR 036 Phase 8 Part B Stop 3: policy-acceptance rows survive the
  // deletion for audit (same posture as the ledger). The append-only
  // trigger on migration 0084 permits non-null → NULL on user_id.
  await anonymizeUserPolicyAcceptances(tx, profileId);

  // Batches, home pools, invites, members, household — in dependency order.
  // The household's cascade would wipe household_invites and
  // household_members too, but we delete explicitly so the order is
  // auditable and any RESTRICT conflict surfaces loudly.
  await tx.delete(bookingBatches).where(eq(bookingBatches.householdId, householdId));
  await tx.delete(lessonLocations).where(eq(lessonLocations.householdId, householdId));
  await tx.delete(householdInvites).where(eq(householdInvites.householdId, householdId));
  await tx.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await tx.delete(households).where(eq(households.id, householdId));

  await scrubProfile(tx, profileId, now);

  return {
    scope: "solo",
    jobId,
    cancelledFutureLessonIds,
    anonymizedLessonIds,
    coachAccountDeletedOutboxId,
    cashOut,
  };
}

// ── Pure step functions ──────────────────────────────────────────────────────

export async function cancelFutureLessons(
  tx: Tx,
  householdId: string,
  canceledBy: string,
  now: Date,
): Promise<string[]> {
  // Exclude only statuses that already represent a user-visible "not
  // happening" end state: canceled and declined. Everything else —
  // pending, approved, and the data-drift cases where a future lesson
  // somehow ended up at completed / no_show / expired — needs to flip
  // to canceled so the coach schedule, slot engine, and Google Calendar
  // all stop showing or holding the slot. Narrowing to pending/approved
  // missed non-live future rows in dev data and left them visible as
  // normal cards after the household was anonymized.
  const rows = await tx
    .update(lessons)
    .set({
      status: "canceled",
      canceledAt: now,
      canceledBy,
      calendarSequence: sql`${lessons.calendarSequence} + 1` as unknown as number,
    })
    .where(
      and(
        eq(lessons.householdId, householdId),
        notInArray(lessons.status, ["canceled", "declined"]),
        sql`${lessons.startsAt} > ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: lessons.id });

  // ADR 036 Phase 8 Part A: future lessons cancelled by a deletion get
  // the same refund-to-balance treatment as any other cancellation. The
  // enclosing deletion transaction already acquired the per-profile
  // advisory lock; acquire the per-household balance lock here too so
  // the read-check-write cycle is atomic against a concurrent coach
  // adjustment on this same household (unlikely but cheap to defend).
  // Free-lesson and pre-Phase-4 rows refund $0 — the service no-ops
  // and the lesson's audit entry still lands via the UPDATE above.
  if (rows.length > 0) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"household-balance:" + householdId}))`,
    );
    for (const row of rows) {
      await refundLessonCharge(tx, {
        householdId,
        lessonId: row.id,
        actorId: canceledBy,
      });
    }
  }

  return rows.map((row) => row.id);
}

// ADR 036 Phase 8 Part A: on a solo deletion, keep the household's
// ledger rows (append-only tax history) but strip identity. The trigger
// from migration 0079 permits non-null → NULL transitions on
// household_id, actor_id, and lesson_id; this UPDATE sets household_id
// and actor_id to null in one statement. lesson_id stays as-is — a
// later FK ON DELETE SET NULL on lessons would fire only if a lesson
// row got hard-deleted, and solo deletion anonymizes lessons instead of
// deleting them. The household's `ON DELETE SET NULL` FK would also
// null household_id when the household row is deleted below, but we do
// it explicitly here so a) actor_id goes with it in the same statement
// and b) the step is auditable.
export async function anonymizeHouseholdLedger(
  tx: Tx,
  householdId: string,
): Promise<number> {
  const result = await tx
    .update(householdBalanceLedger)
    .set({ householdId: null, actorId: null })
    .where(eq(householdBalanceLedger.householdId, householdId))
    .returning({ id: householdBalanceLedger.id });
  // ADR 036 Phase 8 Part B Stop 2: null the cash_refund_jobs rows'
  // household_id in the same statement so needs-manual-handling jobs
  // survive the deletion for Jason to resolve off platform, but no
  // longer tie back to a specific family. The coach notification
  // written when the job was created carries NO family name snapshot
  // — Jason identifies the refund by the Stripe payment intent id
  // (or the job id when there isn't one) plus the dollar amount.
  // See services/balance/notifications.ts for the exact payload shape.
  await tx
    .update(cashRefundJobs)
    .set({ householdId: null })
    .where(eq(cashRefundJobs.householdId, householdId));
  return result.length;
}

// ADR 036 Phase 8 Part B Stop 3: policy-acceptance rows survive the
// deletion for audit but have their user_id nulled so they no longer
// point at the deleted profile. The append-only trigger from migration
// 0084 allows this specific non-null → NULL transition (same pattern as
// household_balance_ledger per migration 0079). Rejects every other
// column change loudly.
export async function anonymizeUserPolicyAcceptances(
  tx: Tx,
  profileId: string,
): Promise<number> {
  const result = await tx
    .update(userPolicyAcceptances)
    .set({ userId: null })
    .where(eq(userPolicyAcceptances.userId, profileId))
    .returning({ id: userPolicyAcceptances.id });
  return result.length;
}

export async function anonymizeHouseholdLessons(
  tx: Tx,
  householdId: string,
  now: Date,
): Promise<string[]> {
  // Snapshot per-row location name + swimmer count before the FKs are nulled
  // out. The location snapshot is coarse ("Home pool" or the named pool
  // name); the swimmer count is a plain integer. Neither is identifying.
  const lessonsToAnonymize = await tx
    .select({
      id: lessons.id,
      locationName: lessonLocations.name,
      locationHouseholdId: lessonLocations.householdId,
    })
    .from(lessons)
    .leftJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
    .where(eq(lessons.householdId, householdId));

  const swimmerCounts = await tx
    .select({
      lessonId: lessonSwimmers.lessonId,
      count: sql<number>`count(*)::int`,
    })
    .from(lessonSwimmers)
    .innerJoin(lessons, eq(lessons.id, lessonSwimmers.lessonId))
    .where(eq(lessons.householdId, householdId))
    .groupBy(lessonSwimmers.lessonId);
  const countByLesson = new Map(swimmerCounts.map((row) => [row.lessonId, row.count]));

  for (const row of lessonsToAnonymize) {
    const locationSnapshot = row.locationName === null
      ? null
      : row.locationHouseholdId === null
        ? row.locationName
        : "Home pool";
    await tx
      .update(lessons)
      .set({
        householdId: null,
        locationId: null,
        requestedBy: null,
        approvedBy: null,
        declinedBy: null,
        canceledBy: null,
        noShowBy: null,
        declineReason: null,
        googleCalendarEventId: null,
        batchId: null,
        anonymizedAt: now,
        locationSnapshot,
        swimmerCount: countByLesson.get(row.id) ?? 0,
      })
      .where(eq(lessons.id, row.id));
  }
  return lessonsToAnonymize.map((row) => row.id);
}

export async function hardDeleteHouseholdSwimmerData(
  tx: Tx,
  householdId: string,
): Promise<void> {
  const swimmerRows = await tx
    .select({ id: swimmers.id })
    .from(swimmers)
    .where(eq(swimmers.householdId, householdId));
  const swimmerIds = swimmerRows.map((row) => row.id);
  if (swimmerIds.length === 0) return;

  const sessionRows = await tx
    .select({ id: evaluationSessions.id })
    .from(evaluationSessions)
    .where(inArray(evaluationSessions.swimmerId, swimmerIds));
  const sessionIds = sessionRows.map((row) => row.id);

  const ratingRows = await tx
    .select({ id: skillRatings.id })
    .from(skillRatings)
    .where(inArray(skillRatings.swimmerId, swimmerIds));
  const ratingIds = ratingRows.map((row) => row.id);

  // ADR 034 documented exception: deletion is the one path allowed to remove
  // skill_ratings rows. The ledger's UPDATE immutability trigger (ADR 022 /
  // ADR 032) does not fire on DELETE.
  if (ratingIds.length > 0) {
    await tx.delete(ratingFaultTags).where(inArray(ratingFaultTags.ratingId, ratingIds));
    await tx.delete(skillRatings).where(inArray(skillRatings.id, ratingIds));
  }
  await tx.delete(coachNotes).where(inArray(coachNotes.swimmerId, swimmerIds));
  await tx.delete(evaluationDrafts).where(inArray(evaluationDrafts.swimmerId, swimmerIds));
  if (sessionIds.length > 0) {
    await tx.delete(evaluationSessions).where(inArray(evaluationSessions.id, sessionIds));
  }
  await tx.delete(meetSwims).where(inArray(meetSwims.swimmerId, swimmerIds));
  await tx.delete(swimmerClubs).where(inArray(swimmerClubs.swimmerId, swimmerIds));
  await tx.delete(leagueRegistrations).where(inArray(leagueRegistrations.swimmerId, swimmerIds));
  await tx.delete(lessonSwimmers).where(inArray(lessonSwimmers.swimmerId, swimmerIds));
  await tx.delete(swimmers).where(inArray(swimmers.id, swimmerIds));
}

export async function scrubEmailOutboxForHousehold(
  tx: Tx,
  householdId: string,
  anonymizedLessonIds: string[],
): Promise<void> {
  // Three scopes of outbox rows reference this household (ADR 028 / ADR 033):
  // - lesson_id → lessons.id (per-lesson rows). The anonymized ids are
  //   passed in from the caller — this function runs AFTER anonymizeHousehold
  //   has nulled lessons.household_id, so the ids are the only remaining tie.
  // - batch_id → bookingBatches.id (parent batch rows). Join via
  //   bookingBatches.household_id.
  // - household_id (bulk_cancel rows written by ADR 033).
  //
  // Non-terminal rows are deleted outright. Terminal rows have payload
  // replaced with a scrubbed sentinel — same shape the age-based drain
  // writes, so a second pass is a no-op (`payload ? 'swimmerFirstNames'`
  // matches only un-scrubbed payloads). The status list is derived from
  // the single-source-of-truth constant in schema.ts — adding a new
  // outbox status there automatically propagates here.
  const nonTerminalStatuses = [...LESSON_EMAIL_OUTBOX_NON_TERMINAL_STATUSES];
  const whereClauses = [
    anonymizedLessonIds.length > 0 ? inArray(lessonEmailOutbox.lessonId, anonymizedLessonIds) : null,
    eq(lessonEmailOutbox.householdId, householdId),
    inArray(
      lessonEmailOutbox.batchId,
      tx.select({ id: bookingBatches.id }).from(bookingBatches).where(eq(bookingBatches.householdId, householdId)),
    ),
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== null);

  for (const whereClause of whereClauses) {
    await tx
      .delete(lessonEmailOutbox)
      .where(
        and(whereClause, inArray(lessonEmailOutbox.status, nonTerminalStatuses)),
      );
    // Scrub the payload AND null every FK that points at a hard-deleted
    // parent in this transaction. There are two ways this UPDATE was
    // wrong before:
    //
    //   (1) Original scope CHECK forced all three scope FKs non-null,
    //       so leaving batch_id / household_id set tripped the RESTRICT
    //       on `booking_batches` / `households` DELETE. Migration 0073
    //       relaxes both CHECKs when `payload ? '_scrubbed_at'`, and
    //       this UPDATE writes that sentinel.
    //   (2) The UPDATE's WHERE clause used to filter on
    //       `payload ? 'swimmerFirstNames'` so it would be idempotent
    //       against a second-pass age-based drain. But coach-facing
    //       outbox events (`coach_booking_request`) never carry
    //       swimmerFirstNames — their payloads only describe the batch
    //       at a coach level (lessonCount, locationName, etc.). A
    //       terminal `sent` coach_booking_request row would be skipped
    //       by that filter, keeping batch_id set, still tripping the
    //       RESTRICT. Drop the payload filter entirely: scrub every
    //       row the scope where-clauses select, regardless of payload
    //       shape. The deletion transaction runs the scrub exactly
    //       once; re-running on an already-scrubbed row is a safe
    //       no-op (same sentinel, same null FKs).
    //
    // Null batch_id and household_id — `booking_batches` and
    // `households` are hard-deleted later in this tx. Keep lesson_id:
    // lessons are anonymized (identity nulled) but the row survives,
    // so the FK still resolves. Keep bulk_cancellation_id for the same
    // reason (bulk_cancellations is coach-side and kept).
    await tx
      .update(lessonEmailOutbox)
      .set({
        payload: sql`jsonb_build_object('_scrubbed_at', now())`,
        batchId: null,
        householdId: null,
      })
      .where(whereClause);
  }
  // bulk_cancellations parent rows stay — they are coach-side operation
  // records, not family-scoped. The per-family outbox rows above carry the
  // scrubbable payload.
  void bulkCancellations;
}

export async function hardDeleteCoachNotificationsForHousehold(
  tx: Tx,
  householdId: string,
  anonymizedLessonIds: string[],
): Promise<void> {
  // Notifications tied to this household's lessons (via lesson_id) or
  // batches (via batch_id). The lesson ids are passed in from the caller
  // because anonymizeHousehold has already nulled lessons.household_id —
  // the ids are the only remaining tie.
  if (anonymizedLessonIds.length > 0) {
    await tx
      .delete(coachNotifications)
      .where(inArray(coachNotifications.lessonId, anonymizedLessonIds));
  }
  await tx
    .delete(coachNotifications)
    .where(
      inArray(
        coachNotifications.batchId,
        tx
          .select({ id: bookingBatches.id })
          .from(bookingBatches)
          .where(eq(bookingBatches.householdId, householdId)),
      ),
    );
}

export async function insertAccountDeletedSummary(
  tx: Tx,
  cancelledLessonTimes: Date[],
  now: Date,
  jobId: string,
): Promise<void> {
  const coach = await getActiveCoachProfile();
  if (!coach) return;

  const { siteUrl } = getEnv();
  // Pre-compute LA wall-time display strings so the push renderer and
  // the in-app list builder stay pure functions of the payload. ISO
  // strings are kept alongside for downstream tooling (reporting, retry
  // logs) that needs machine-readable timestamps.
  const cancelledLessonTimesUtc = cancelledLessonTimes.map((d) => d.toISOString());
  const cancelledLessonTimesLocalDisplay = cancelledLessonTimes.map((d) =>
    formatLessonTimeDisplay(d),
  );
  // Caller only invokes this helper when at least one lesson was freed,
  // but guard against an empty array anyway so the URL helper stays the
  // single source of truth for the "no freed lessons → today view" rule.
  // Click URL targets the coach schedule day view on the first freed
  // lesson's LA date (or today-view fallback). Never a /coach/alerts or
  // /coach/lessons/<id> link — the referenced family is gone, and the
  // bulk-cancel day view is where Jason acts on the freed slots.
  const firstFreedLessonUtc = cancelledLessonTimes[0] ?? null;
  const clickUrl = buildAccountDeletedScheduleUrl(siteUrl, firstFreedLessonUtc);
  await tx.insert(coachNotifications).values({
    profileId: coach.id,
    category: "account_deleted",
    urgency: "standard",
    // No lesson_id / batch_id — the referenced family is gone. Payload
    // carries only the freed-up times (UTC + pre-formatted LA display)
    // plus the operation timestamp; no family name, no swimmer names,
    // no household id. `listTitle` is the short label the in-app bell
    // row renders — the push renderer composes its own.
    payload: {
      kind: "account_deleted",
      listTitle: "A family deleted their account",
      cancelledLessonTimesUtc,
      cancelledLessonTimesLocalDisplay,
      deletedAtUtc: now.toISOString(),
    },
    clickUrl,
    // Tag keyed on the deletion job id — stable, already-unique, and
    // not a time-derived value (the previous now.getTime() was inert
    // today but inconsistent with the "no time-derived identifiers in
    // the payload" posture).
    tag: `account-deleted:${jobId}`,
  });
}

export async function scrubAuditPayloadsForLeave(
  tx: Tx,
  householdId: string,
  deletingProfileId: string,
): Promise<void> {
  // Defensive — household_audit_log.payload today carries only UUIDs and
  // field-name arrays (surveyed in the plan), but a future row that stores
  // free text or before/after values would leak here if we didn't scrub.
  await tx
    .update(householdAuditLog)
    .set({ payload: null })
    .where(
      and(
        eq(householdAuditLog.householdId, householdId),
        sql`${householdAuditLog.payload} IS NOT NULL`,
        sql`(${householdAuditLog.actorId} = ${deletingProfileId} OR ${householdAuditLog.targetProfileId} = ${deletingProfileId})`,
      ),
    );

  // coach_audit_log — unlikely to reference a parent profile today (coach is
  // actor on every row), but defensive if a future flow writes targetProfileId.
  await tx
    .update(coachAuditLog)
    .set({ payload: null })
    .where(
      and(
        sql`${coachAuditLog.payload} IS NOT NULL`,
        sql`(${coachAuditLog.actorId} = ${deletingProfileId} OR ${coachAuditLog.targetProfileId} = ${deletingProfileId})`,
      ),
    );
}

export async function scrubProfile(
  tx: Tx,
  profileId: string,
  now: Date,
): Promise<void> {
  // The sentinel email keeps the profile row's unique index happy without
  // ever matching a real address. The format is stable and parseable in log
  // scans so an operator can confirm scrubbing happened.
  //
  // To tell a scrubbed profile apart from a live one, prefer either
  // `disabled_at IS NOT NULL` (the deletion marker — set here, never
  // cleared anywhere else) or the sentinel email prefix
  // `deleted-user-<uuid>@invalid.local`. Do NOT use `age_attested_at IS
  // NULL` on its own — this scrub clears it so the attestation consent
  // record (ADR 016) does not survive the deletion, which means a
  // never-attested live profile and a deleted profile look identical on
  // that column alone. Pair either disambiguator above with it if a
  // query specifically wants "attested at some point in their lifetime."
  await tx
    .update(profiles)
    .set({
      fullName: null,
      phone: null,
      email: sql`${"deleted-user-" + profileId + "@invalid.local"}`,
      ageAttestedAt: null,
      disabledAt: now,
    })
    .where(eq(profiles.id, profileId));
}

export async function enqueueDeletionJob(
  tx: Tx,
  profileId: string,
  authUserId: string,
  scope: DeletionScope,
  anonymizedLessonIds: string[],
): Promise<string> {
  // Seed next_attempt_at ahead of now by ACCOUNT_DELETION_INITIAL_DELAY
  // _SECONDS so the retry drain cannot claim this row between INSERT
  // and the route's immediate post-commit fan-out. The post-commit
  // runs within milliseconds of commit; the lead window gives it an
  // uncontested first attempt, after which it rewrites next_attempt_at
  // based on the outcome (null on success, now()+backoff(1) on real
  // failure, now()+short recheck on paused). See retry.ts for the
  // exact constant and rationale.
  const rows = await tx
    .insert(accountDeletionJobs)
    .values({
      profileId,
      authUserId,
      scope,
      status: "pending",
      anonymizedLessonIds,
      nextAttemptAt: sql`now() + make_interval(secs => ${ACCOUNT_DELETION_INITIAL_DELAY_SECONDS})`,
    })
    .returning({ id: accountDeletionJobs.id });
  return rows[0]!.id;
}
