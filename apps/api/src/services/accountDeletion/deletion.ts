// Account deletion engine (ADR 034).
//
// Pure DB-side orchestration. The route handler calls `runAccountDeletion`
// inside a `db.transaction()`; the orchestrator takes an advisory lock, locks
// the household row FOR UPDATE to serialize the solo-vs-leave decision against
// a concurrent second member deleting, then dispatches the scrubs / deletes.
// External side effects (Supabase Auth hard-delete, per-lesson Google Calendar
// sync) are intentionally out of this module — the route enqueues them as
// post-commit tasks tracked by `account_deletion_jobs`.

import { and, eq, inArray, sql } from "drizzle-orm";
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
import { getActiveCoachProfile } from "../../lib/coachProfile";
import { getEnv } from "../../lib/env";
import { AlreadyDeletedError, OwnerMustTransferFirstError } from "./errors";

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
    };
  }

  const householdId = membership.householdId;

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
          inArray(lessons.status, ["pending", "approved"]),
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

  return {
    householdName,
    memberCount: memberRows.length,
    swimmers: swimmerPreview,
    pastLessonCount: pastCount[0]?.count ?? 0,
    futureLessonCount: futureCount[0]?.count ?? 0,
    ownerMustTransferFirst,
    callerRole: membership.role,
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
    return { scope: "solo", jobId, cancelledFutureLessonIds: [], anonymizedLessonIds: [] };
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
    return { scope: "leave", jobId, cancelledFutureLessonIds: [], anonymizedLessonIds: [] };
  }

  // Solo path. Full teardown.
  const cancelledFutureLessonIds = await cancelFutureLessons(tx, householdId, profileId, now);

  // Load cancelled-lesson start times for the summary coach notification
  // before the rows get anonymized and lose their household linkage.
  const futureLessonTimes = cancelledFutureLessonIds.length === 0
    ? []
    : (await tx
        .select({ startsAt: lessons.startsAt })
        .from(lessons)
        .where(inArray(lessons.id, cancelledFutureLessonIds))
        .orderBy(lessons.startsAt)).map((row) => row.startsAt);

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

  return { scope: "solo", jobId, cancelledFutureLessonIds, anonymizedLessonIds };
}

// ── Pure step functions ──────────────────────────────────────────────────────

export async function cancelFutureLessons(
  tx: Tx,
  householdId: string,
  canceledBy: string,
  now: Date,
): Promise<string[]> {
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
        inArray(lessons.status, ["pending", "approved"]),
        sql`${lessons.startsAt} > ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: lessons.id });
  return rows.map((row) => row.id);
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
    await tx
      .update(lessonEmailOutbox)
      .set({ payload: sql`jsonb_build_object('_scrubbed_at', now())` })
      .where(
        and(
          whereClause,
          sql`${lessonEmailOutbox.payload} ? 'swimmerFirstNames'`,
        ),
      );
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
  await tx.insert(coachNotifications).values({
    profileId: coach.id,
    category: "account_deleted",
    urgency: "standard",
    // No lesson_id / batch_id — the referenced family is gone. Payload
    // carries only the freed-up times (ISO strings) plus the operation
    // timestamp; no family name, no swimmer names, no household id.
    payload: {
      kind: "account_deleted",
      cancelledLessonTimesUtc: cancelledLessonTimes.map((d) => d.toISOString()),
      deletedAtUtc: now.toISOString(),
    },
    clickUrl: `${siteUrl}/coach/alerts`,
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
  const rows = await tx
    .insert(accountDeletionJobs)
    .values({
      profileId,
      authUserId,
      scope,
      status: "pending",
      anonymizedLessonIds,
    })
    .returning({ id: accountDeletionJobs.id });
  return rows[0]!.id;
}
