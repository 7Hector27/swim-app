// Integration tests for ADR 034 account deletion.
//
// Covers:
// - Solo path (single-member household) end-to-end DB state verification
// - Leave path (multi-member household, non-owner leaves)
// - Owner-with-manager → 409 must_transfer_first
// - Owner-with-viewers-only → solo path (addition 2)
// - Double-delete idempotency (second confirm → 409 already_deleted)
// - Owner + manager race (addition 4)
// - Job row inserted inside the deletion transaction (addition 5)
// - Anonymized lesson surfaces in coach reads (addition 1)
// - Password re-auth failure returns 401
// - Typed-phrase mismatch returns 422
// - Rate limit returns 429 after 5 attempts (addition 3)

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq, inArray } from "drizzle-orm";

import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  createTestUserInHousehold,
  type TestUser,
} from "./helpers";
import {
  accountDeletionJobs,
  coachNotes,
  coachNotifications,
  evaluationDrafts,
  evaluationSessions,
  householdAuditLog,
  householdMembers,
  households,
  LESSON_EMAIL_OUTBOX_TERMINAL_STATUSES,
  LESSON_EMAIL_OUTBOX_NON_TERMINAL_STATUSES,
  leagueRegistrations,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  meetSwims,
  profiles,
  ratingFaultTags,
  skillRatings,
  skills,
  swimmerClubs,
  swimmers,
} from "../../db/schema";
import syncCatalogFn from "../../db/scripts/syncCatalogFn";

const logger = pino({ level: "silent" });
const app = createApp(logger);

const TEST_PASSWORD = "integration-test-password-1";
const DELETION_PHRASE = "delete my account";

// Track every test user so afterEach cleanup runs even on failure.
const testUsers: TestUser[] = [];

afterEach(async () => {
  for (const user of testUsers.splice(0)) {
    await user.cleanup().catch(() => { /* best-effort */ });
  }
});

afterAll(async () => {
  await closeAdminDb();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createSwimmerForHousehold(user: TestUser): Promise<string> {
  const res = await request(app)
    .post("/swimmers")
    .set("Authorization", `Bearer ${user.accessToken}`)
    .send({
      firstName: "Testy",
      lastName: "McTestface",
      birthDate: "2015-06-01",
      sex: "female",
      isPublic: false,
      clubs: [],
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function seedHomePool(householdId: string): Promise<string> {
  const rows = await adminDb()
    .insert(lessonLocations)
    .values({
      name: "Smith Family Pool",
      address: "123 Pool Lane",
      city: "Irvine",
      state: "CA",
      zip: "92620",
      householdId,
      isActive: true,
    })
    .returning({ id: lessonLocations.id });
  return rows[0]!.id;
}

async function seedPastLesson(
  householdId: string,
  locationId: string,
  requestedBy: string,
  swimmerId: string,
): Promise<string> {
  const rows = await adminDb()
    .insert(lessons)
    .values({
      householdId,
      locationId,
      startsAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      durationMinutes: 30,
      type: "private",
      status: "completed",
      requestedBy,
      approvedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      approvedBy: requestedBy,
      completedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
    })
    .returning({ id: lessons.id });
  const lessonId = rows[0]!.id;
  await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId });
  return lessonId;
}

async function seedFutureLesson(
  householdId: string,
  locationId: string,
  requestedBy: string,
  swimmerId: string,
): Promise<string> {
  const rows = await adminDb()
    .insert(lessons)
    .values({
      householdId,
      locationId,
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      durationMinutes: 30,
      type: "private",
      status: "approved",
      requestedBy,
      approvedAt: new Date(),
      approvedBy: requestedBy,
    })
    .returning({ id: lessons.id });
  const lessonId = rows[0]!.id;
  await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId });
  return lessonId;
}

function confirmDeletion(accessToken: string, password = TEST_PASSWORD) {
  return request(app)
    .post("/me/deletion/confirm")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ password, confirmationPhrase: DELETION_PHRASE });
}

// Catalog skill id used by the swimmer-linked data seeder below. Looked
// up once in beforeAll — the full teardown test needs a real skills row
// so the skill_ratings → skills FK is satisfied.
let catalogSkillId: string | null = null;

// Seeds every swimmer-linked table the deletion engine is expected to
// clear. Returns the ids so the test can assert zero rows afterwards and
// so a second-household seeding can compare against the untouched set.
//
// Covers evaluationSessions, skillRatings, ratingFaultTags, coachNotes,
// evaluationDrafts, meetSwims, swimmerClubs, and leagueRegistrations —
// every table named in the ADR 034 hard-delete sweep that references
// swimmer_id.
async function seedSwimmerData(
  swimmerId: string,
  coachId: string,
): Promise<{
  sessionId: string;
  ratingId: string;
  coachNoteId: string;
  evalDraftId: string;
  meetSwimId: string;
  swimmerClubId: string;
  leagueRegistrationId: string;
}> {
  if (!catalogSkillId) throw new Error("catalogSkillId not initialized");
  const skillIdLocal = catalogSkillId;

  const sessionRows = await adminDb()
    .insert(evaluationSessions)
    .values({
      swimmerId,
      coachId,
      screenSlug: "fundamentals",
      sessionDate: "2026-10-01",
      context: "practice",
    })
    .returning({ id: evaluationSessions.id });
  const sessionId = sessionRows[0]!.id;

  const ratingRows = await adminDb()
    .insert(skillRatings)
    .values({
      sessionId,
      swimmerId,
      skillId: skillIdLocal,
      coachId,
      grade: 3,
      notLegal: false,
      noConcept: false,
      ratedAt: new Date("2026-10-01T10:00:00Z"),
    })
    .returning({ id: skillRatings.id });
  const ratingId = ratingRows[0]!.id;

  await adminDb()
    .insert(ratingFaultTags)
    .values({ ratingId, faultTag: "high-elbow-missing" });

  const coachNoteRows = await adminDb()
    .insert(coachNotes)
    .values({
      swimmerId,
      body: "Work on rotation during next session.",
      createdBy: coachId,
    })
    .returning({ id: coachNotes.id });
  const coachNoteId = coachNoteRows[0]!.id;

  const draftRows = await adminDb()
    .insert(evaluationDrafts)
    .values({
      swimmerId,
      coachId,
      screenSlug: "freestyle",
      sessionDate: "2026-10-02",
      context: "practice",
    })
    .returning({ id: evaluationDrafts.id });
  const evalDraftId = draftRows[0]!.id;

  const meetSwimRows = await adminDb()
    .insert(meetSwims)
    .values({
      swimmerId,
      swimType: "practice",
      eventDistance: 50,
      eventStroke: "free",
      course: "scy",
      swumOn: "2026-09-15",
      timeHundredths: 3500,
      createdBy: coachId,
    })
    .returning({ id: meetSwims.id });
  const meetSwimId = meetSwimRows[0]!.id;

  const swimmerClubRows = await adminDb()
    .insert(swimmerClubs)
    .values({ swimmerId, otherClubName: "Deleted Club" })
    .returning({ id: swimmerClubs.id });
  const swimmerClubId = swimmerClubRows[0]!.id;

  const leagueRows = await adminDb()
    .insert(leagueRegistrations)
    .values({
      swimmerId,
      league: "club",
      seasonStartYear: 2026,
      registeredOn: "2026-09-01",
    })
    .returning({ id: leagueRegistrations.id });
  const leagueRegistrationId = leagueRows[0]!.id;

  return {
    sessionId,
    ratingId,
    coachNoteId,
    evalDraftId,
    meetSwimId,
    swimmerClubId,
    leagueRegistrationId,
  };
}

beforeAll(async () => {
  // The swimmer-linked-data seed needs a real catalog skill because
  // skill_ratings.skill_id is NOT NULL and has an ON DELETE RESTRICT FK
  // to skills. Sync the catalog once and cache a known-good slug's id.
  await syncCatalogFn(adminDb());
  const skillRows = await adminDb()
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, "free-kick"))
    .limit(1);
  if (!skillRows[0]) throw new Error("Catalog skill free-kick not found — run pnpm db:sync-catalog");
  catalogSkillId = skillRows[0].id;
});

// ── Preview ──────────────────────────────────────────────────────────────────

describe("POST /me/deletion/preview", () => {
  it("returns counts for the caller's household and ownerMustTransferFirst=false when they are the only member", async () => {
    const owner = await createTestUser("delete-preview-solo");
    testUsers.push(owner);
    const swimmerId = await createSwimmerForHousehold(owner);
    const locationId = await seedHomePool(owner.householdId);
    await seedPastLesson(owner.householdId, locationId, owner.userId, swimmerId);
    await seedFutureLesson(owner.householdId, locationId, owner.userId, swimmerId);

    const res = await request(app)
      .post("/me/deletion/preview")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.memberCount).toBe(1);
    expect(res.body.swimmers).toHaveLength(1);
    expect(res.body.pastLessonCount).toBe(1);
    expect(res.body.futureLessonCount).toBe(1);
    expect(res.body.ownerMustTransferFirst).toBe(false);
  });

  it("returns ownerMustTransferFirst=true when owner has a co-manager", async () => {
    const owner = await createTestUser("delete-preview-must-transfer-owner");
    testUsers.push(owner);
    const manager = await createTestUserInHousehold(
      "delete-preview-must-transfer-manager",
      owner.householdId,
      "manager",
    );
    testUsers.push(manager);

    const res = await request(app)
      .post("/me/deletion/preview")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.memberCount).toBe(2);
    expect(res.body.ownerMustTransferFirst).toBe(true);
  });
});

// ── Preview and confirm agree on the scope decision ─────────────────────────

describe("POST /me/deletion/preview vs. /confirm — scope agreement", () => {
  // The reviewer flagged a UX/access-control divergence: the preview's
  // ownerMustTransferFirst used to be "owner && memberCount > 1", while
  // the confirm path (correctly) ran solo when the only other members
  // were viewers. The UI read the preview and blocked the form,
  // hiding a deletion the API would actually accept. These tests lock
  // the two sides to the shared decideDeletionScope helper by asserting
  // that preview's ownerMustTransferFirst matches confirm's actual
  // behavior (204 vs. 409) for every household composition.

  it("solo-alone (only member): preview says not blocked; confirm returns 204", async () => {
    const owner = await createTestUser("scope-parity-solo-alone");
    testUsers.push(owner);

    const preview = await request(app)
      .post("/me/deletion/preview")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({});
    expect(preview.status).toBe(200);
    expect(preview.body.ownerMustTransferFirst).toBe(false);

    const confirm = await confirmDeletion(owner.accessToken);
    expect(confirm.status).toBe(204);

    await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.authUserId, owner.userId));
  });

  it("owner-with-only-viewers: preview says not blocked; confirm returns 204 (solo path)", async () => {
    const owner = await createTestUser("scope-parity-viewers-owner");
    testUsers.push(owner);
    const viewer = await createTestUserInHousehold(
      "scope-parity-viewers-viewer",
      owner.householdId,
      "viewer",
    );
    testUsers.push(viewer);

    const preview = await request(app)
      .post("/me/deletion/preview")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({});
    expect(preview.status).toBe(200);
    expect(preview.body.memberCount).toBe(2);
    // The specific reviewer finding: this used to be `true` (preview
    // mishandled the owner-with-only-viewers case), blocking a
    // deletion the confirm path would run. Preview and confirm must
    // agree — this field is `false` and the confirm returns 204.
    expect(preview.body.ownerMustTransferFirst).toBe(false);
    expect(preview.body.callerRole).toBe("owner");

    const confirm = await confirmDeletion(owner.accessToken);
    expect(confirm.status).toBe(204);

    await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.authUserId, owner.userId));
  });

  it("leave (non-owner with other adults): preview says not blocked; confirm returns 204 (leave path)", async () => {
    const owner = await createTestUser("scope-parity-leave-owner");
    testUsers.push(owner);
    const manager = await createTestUserInHousehold(
      "scope-parity-leave-manager",
      owner.householdId,
      "manager",
    );
    testUsers.push(manager);

    const preview = await request(app)
      .post("/me/deletion/preview")
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({});
    expect(preview.status).toBe(200);
    expect(preview.body.ownerMustTransferFirst).toBe(false);
    expect(preview.body.callerRole).toBe("manager");

    // Manager leaving. Confirm succeeds with the leave scope (household
    // and owner stay).
    const confirm = await confirmDeletion(manager.accessToken);
    expect(confirm.status).toBe(204);

    await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.authUserId, manager.userId));
  });

  it("owner-with-another-adult: preview says blocked; confirm returns 409 must_transfer_first", async () => {
    const owner = await createTestUser("scope-parity-blocked-owner");
    testUsers.push(owner);
    const manager = await createTestUserInHousehold(
      "scope-parity-blocked-manager",
      owner.householdId,
      "manager",
    );
    testUsers.push(manager);

    const preview = await request(app)
      .post("/me/deletion/preview")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({});
    expect(preview.status).toBe(200);
    expect(preview.body.ownerMustTransferFirst).toBe(true);
    expect(preview.body.callerRole).toBe("owner");

    const confirm = await confirmDeletion(owner.accessToken);
    expect(confirm.status).toBe(409);
    expect(confirm.body.error).toBe("must_transfer_first");
  });
});

// ── Guards: typed phrase + password ──────────────────────────────────────────

describe("POST /me/deletion/confirm (guards)", () => {
  it("returns 422 when the confirmation phrase doesn't match (missing word)", async () => {
    const owner = await createTestUser("delete-guard-phrase");
    testUsers.push(owner);

    const res = await request(app)
      .post("/me/deletion/confirm")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ password: TEST_PASSWORD, confirmationPhrase: "delete account" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("confirmation_phrase_mismatch");

    // Account survives.
    const profileRow = await adminDb()
      .select({ disabledAt: profiles.disabledAt })
      .from(profiles)
      .where(eq(profiles.id, owner.userId))
      .limit(1);
    expect(profileRow[0]?.disabledAt).toBeNull();
  });

  it("accepts autocapitalized and whitespace-padded phrases — comparison is trimmed + case-insensitive", async () => {
    // iPhone autocapitalizes the first word of the field even with
    // autoCapitalize="none" on older iOS versions; the server-side
    // comparison must not reject "Delete my account" as a phrase
    // mismatch. The test is paired with the UI's identical client-side
    // normalization so an iPhone user never submits a form that would
    // bounce at the API. Using a wrong password keeps the deletion
    // from committing — the phrase check passes before the password
    // one, so the 403 is the signal that the phrase got through.
    const owner = await createTestUser("delete-guard-phrase-normalized");
    testUsers.push(owner);

    const variants = [
      "Delete my account",
      "DELETE MY ACCOUNT",
      "  delete my account  ",
      "delete my account\n",
    ];
    for (const variant of variants) {
      const res = await request(app)
        .post("/me/deletion/confirm")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ password: "intentionally-wrong-password", confirmationPhrase: variant });

      // Not 422 — the phrase got past the normalized compare. 403
      // invalid_password means the password check fired, which only
      // happens on a successful phrase match.
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("invalid_password");
    }

    const profileRow = await adminDb()
      .select({ disabledAt: profiles.disabledAt })
      .from(profiles)
      .where(eq(profiles.id, owner.userId))
      .limit(1);
    expect(profileRow[0]?.disabledAt).toBeNull();
  });

  it("returns 403 invalid_password on wrong password — not 401, so the web client does not sign the user out of the rest of their account", async () => {
    const owner = await createTestUser("delete-guard-password");
    testUsers.push(owner);

    const res = await request(app)
      .post("/me/deletion/confirm")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ password: "wrong-password-xyz", confirmationPhrase: DELETION_PHRASE });

    // 403 invalid_password, not 401. The web client's convention
    // (apps/web/src/lib/requireAuth.ts + every Server Action that
    // forwards to the API) is to treat any API 401 as "session is
    // dead → redirect to /api/signout". A wrong confirmation password
    // must not sign the still-live user out; the Phase 4 UI shows an
    // inline error on this 403 branch and keeps the user on the page.
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("invalid_password");

    const profileRow = await adminDb()
      .select({ disabledAt: profiles.disabledAt })
      .from(profiles)
      .where(eq(profiles.id, owner.userId))
      .limit(1);
    expect(profileRow[0]?.disabledAt).toBeNull();
  });
});

// ── Solo path end-to-end ─────────────────────────────────────────────────────

describe("POST /me/deletion/confirm — solo path", () => {
  it("deletes the household and every swimmer-linked row; anonymizes past lessons; scrubs profile; a second household is untouched", async () => {
    // Shared coach used for both households' seed data. Promoted after
    // signup so the FKs on evaluation_sessions.coach_id / skill_ratings
    // .coach_id / meet_swims.created_by / coach_notes.created_by resolve.
    const coach = await createTestUser("delete-solo-coach");
    testUsers.push(coach);
    await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

    // ── Household A (will be deleted) ─────────────────────────────
    const owner = await createTestUser("delete-solo-owner-a");
    testUsers.push(owner);
    const householdId = owner.householdId;
    const swimmerId = await createSwimmerForHousehold(owner);
    const locationId = await seedHomePool(householdId);
    const pastLessonId = await seedPastLesson(householdId, locationId, owner.userId, swimmerId);
    const futureLessonId = await seedFutureLesson(householdId, locationId, owner.userId, swimmerId);
    const seededA = await seedSwimmerData(swimmerId, coach.userId);

    // ── Household B (must survive untouched) ──────────────────────
    const ownerB = await createTestUser("delete-solo-owner-b");
    testUsers.push(ownerB);
    const householdIdB = ownerB.householdId;
    const swimmerIdB = await createSwimmerForHousehold(ownerB);
    const locationIdB = await seedHomePool(householdIdB);
    const pastLessonIdB = await seedPastLesson(householdIdB, locationIdB, ownerB.userId, swimmerIdB);
    const seededB = await seedSwimmerData(swimmerIdB, coach.userId);

    // Delete household A only.
    const res = await confirmDeletion(owner.accessToken);
    expect(res.status).toBe(204);

    // ── Household A: full teardown ────────────────────────────────

    // Household gone.
    const hh = await adminDb().select().from(households).where(eq(households.id, householdId));
    expect(hh).toHaveLength(0);

    // Household membership gone.
    const members = await adminDb().select().from(householdMembers).where(eq(householdMembers.householdId, householdId));
    expect(members).toHaveLength(0);

    // Swimmer gone.
    const swimmerRows = await adminDb().select().from(swimmers).where(eq(swimmers.id, swimmerId));
    expect(swimmerRows).toHaveLength(0);

    // Home pool gone.
    const poolRows = await adminDb().select().from(lessonLocations).where(eq(lessonLocations.id, locationId));
    expect(poolRows).toHaveLength(0);

    // Every swimmer-linked table — zero rows for swimmer A. The deletion
    // engine's hard-delete sweep MUST remove everything listed in the ADR
    // 034 plan; the swimmer-id scoped checks below are the per-table
    // regression guards.
    const [
      sessionsA,
      ratingsA,
      faultTagsA,
      coachNotesA,
      evalDraftsA,
      meetSwimsA,
      swimmerClubsA,
      leagueRegsA,
      lessonSwimmersA,
    ] = await Promise.all([
      adminDb().select().from(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerId)),
      adminDb().select().from(skillRatings).where(eq(skillRatings.swimmerId, swimmerId)),
      adminDb().select().from(ratingFaultTags).where(eq(ratingFaultTags.ratingId, seededA.ratingId)),
      adminDb().select().from(coachNotes).where(eq(coachNotes.swimmerId, swimmerId)),
      adminDb().select().from(evaluationDrafts).where(eq(evaluationDrafts.swimmerId, swimmerId)),
      adminDb().select().from(meetSwims).where(eq(meetSwims.swimmerId, swimmerId)),
      adminDb().select().from(swimmerClubs).where(eq(swimmerClubs.swimmerId, swimmerId)),
      adminDb().select().from(leagueRegistrations).where(eq(leagueRegistrations.swimmerId, swimmerId)),
      adminDb().select().from(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, swimmerId)),
    ]);
    expect(sessionsA).toHaveLength(0);
    expect(ratingsA).toHaveLength(0);
    expect(faultTagsA).toHaveLength(0);
    expect(coachNotesA).toHaveLength(0);
    expect(evalDraftsA).toHaveLength(0);
    expect(meetSwimsA).toHaveLength(0);
    expect(swimmerClubsA).toHaveLength(0);
    expect(leagueRegsA).toHaveLength(0);
    expect(lessonSwimmersA).toHaveLength(0);

    // Past lesson anonymized (row survives, identity nulled).
    const pastRows = await adminDb().select().from(lessons).where(eq(lessons.id, pastLessonId));
    expect(pastRows).toHaveLength(1);
    expect(pastRows[0]?.householdId).toBeNull();
    expect(pastRows[0]?.locationId).toBeNull();
    expect(pastRows[0]?.requestedBy).toBeNull();
    expect(pastRows[0]?.anonymizedAt).not.toBeNull();
    expect(pastRows[0]?.locationSnapshot).toBe("Home pool");
    expect(pastRows[0]?.swimmerCount).toBe(1);
    expect(pastRows[0]?.status).toBe("completed");

    // Future lesson cancelled then anonymized.
    const futureRows = await adminDb().select().from(lessons).where(eq(lessons.id, futureLessonId));
    expect(futureRows).toHaveLength(1);
    expect(futureRows[0]?.status).toBe("canceled");
    expect(futureRows[0]?.anonymizedAt).not.toBeNull();
    expect(futureRows[0]?.householdId).toBeNull();

    // Profile scrubbed in place.
    const profileRow = await adminDb()
      .select()
      .from(profiles)
      .where(eq(profiles.id, owner.userId))
      .limit(1);
    expect(profileRow[0]?.fullName).toBeNull();
    expect(profileRow[0]?.phone).toBeNull();
    expect(profileRow[0]?.disabledAt).not.toBeNull();
    expect(profileRow[0]?.email).toMatch(/^deleted-user-.*@invalid\.local$/);

    // Account deletion job row written inside the tx. Addition 5: a
    // post-commit crash leaves this row intact for the retry cron.
    const jobRows = await adminDb()
      .select()
      .from(accountDeletionJobs)
      .where(eq(accountDeletionJobs.authUserId, owner.userId));
    expect(jobRows).toHaveLength(1);
    expect(["pending", "completed"]).toContain(jobRows[0]?.status);
    expect(jobRows[0]?.scope).toBe("solo");

    // account_deleted coach notification exists with freed-up times.
    const summaryNotifs = await adminDb()
      .select()
      .from(coachNotifications)
      .where(eq(coachNotifications.category, "account_deleted"));
    expect(summaryNotifs.length).toBeGreaterThanOrEqual(1);
    const payloads = summaryNotifs.map((row) => row.payload as { cancelledLessonTimesUtc?: string[] });
    const hasOurTimes = payloads.some((p) => p.cancelledLessonTimesUtc && p.cancelledLessonTimesUtc.length > 0);
    expect(hasOurTimes).toBe(true);

    // Stale-token guard: the access token this test still holds now
    // resolves to a profile with disabled_at set. requireUser returns 401
    // (ADR 034 addition 1 of Phase 1).
    const meRes = await request(app).get("/me").set("Authorization", `Bearer ${owner.accessToken}`);
    expect(meRes.status).toBe(401);

    // ── Household B: untouched ────────────────────────────────────

    // Second household + its data survives the first household's deletion.
    // The blast radius of a deletion MUST be scoped to the deleting owner's
    // household — this is what the hard-delete sweep's swimmer_id filter
    // buys us, and a regression that broadened the scope would surface here.
    const hhB = await adminDb().select().from(households).where(eq(households.id, householdIdB));
    expect(hhB).toHaveLength(1);
    const swimmersB = await adminDb().select().from(swimmers).where(eq(swimmers.id, swimmerIdB));
    expect(swimmersB).toHaveLength(1);
    const [
      sessionsB,
      ratingsB,
      faultTagsB,
      coachNotesB,
      evalDraftsB,
      meetSwimsB,
      swimmerClubsB,
      leagueRegsB,
      lessonSwimmersB,
    ] = await Promise.all([
      adminDb().select().from(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerIdB)),
      adminDb().select().from(skillRatings).where(eq(skillRatings.swimmerId, swimmerIdB)),
      adminDb().select().from(ratingFaultTags).where(eq(ratingFaultTags.ratingId, seededB.ratingId)),
      adminDb().select().from(coachNotes).where(eq(coachNotes.swimmerId, swimmerIdB)),
      adminDb().select().from(evaluationDrafts).where(eq(evaluationDrafts.swimmerId, swimmerIdB)),
      adminDb().select().from(meetSwims).where(eq(meetSwims.swimmerId, swimmerIdB)),
      adminDb().select().from(swimmerClubs).where(eq(swimmerClubs.swimmerId, swimmerIdB)),
      adminDb().select().from(leagueRegistrations).where(eq(leagueRegistrations.swimmerId, swimmerIdB)),
      adminDb().select().from(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, swimmerIdB)),
    ]);
    expect(sessionsB).toHaveLength(1);
    expect(ratingsB).toHaveLength(1);
    expect(faultTagsB).toHaveLength(1);
    expect(coachNotesB).toHaveLength(1);
    expect(evalDraftsB).toHaveLength(1);
    expect(meetSwimsB).toHaveLength(1);
    expect(swimmerClubsB).toHaveLength(1);
    expect(leagueRegsB).toHaveLength(1);
    expect(lessonSwimmersB).toHaveLength(1);
    // The household-B past lesson is still live (not anonymized).
    const pastRowsB = await adminDb().select().from(lessons).where(eq(lessons.id, pastLessonIdB));
    expect(pastRowsB).toHaveLength(1);
    expect(pastRowsB[0]?.anonymizedAt).toBeNull();
    expect(pastRowsB[0]?.householdId).toBe(householdIdB);
    // Owner B's profile untouched.
    const profileB = await adminDb().select().from(profiles).where(eq(profiles.id, ownerB.userId)).limit(1);
    expect(profileB[0]?.disabledAt).toBeNull();

    // Housekeeping: remove the anonymized lesson rows from A + job row so
    // afterEach doesn't hit RESTRICT FKs against profiles/households from
    // other test fixtures. Household B's rows are cleaned up by the
    // afterEach testUser cleanup since the swimmers/lessons/etc. all FK
    // back to swimmers/profiles that TestUser.cleanup removes.
    await adminDb().delete(coachNotifications).where(eq(coachNotifications.category, "account_deleted"));
    await adminDb().delete(lessons).where(inArray(lessons.id, [pastLessonId, futureLessonId]));
    await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.authUserId, owner.userId));
    // Explicit teardown of household B's seeded rows — the TestUser
    // cleanup helper only handles the profile + household + direct
    // members, not swimmer-scoped children. household_audit_log has an
    // ON DELETE RESTRICT FK on target_swimmer_id (populated by the
    // POST /swimmers `swimmer_added` audit row), so it must be cleared
    // before the swimmer delete can land.
    await adminDb().delete(ratingFaultTags).where(eq(ratingFaultTags.ratingId, seededB.ratingId));
    await adminDb().delete(skillRatings).where(eq(skillRatings.swimmerId, swimmerIdB));
    await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerIdB));
    await adminDb().delete(coachNotes).where(eq(coachNotes.swimmerId, swimmerIdB));
    await adminDb().delete(evaluationDrafts).where(eq(evaluationDrafts.swimmerId, swimmerIdB));
    await adminDb().delete(meetSwims).where(eq(meetSwims.swimmerId, swimmerIdB));
    await adminDb().delete(leagueRegistrations).where(eq(leagueRegistrations.swimmerId, swimmerIdB));
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, swimmerIdB));
    await adminDb().delete(lessons).where(eq(lessons.id, pastLessonIdB));
    await adminDb().delete(householdAuditLog).where(eq(householdAuditLog.targetSwimmerId, swimmerIdB));
    await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerIdB));
    await adminDb().delete(lessonLocations).where(eq(lessonLocations.id, locationIdB));
  });
});

// ── Leave path ───────────────────────────────────────────────────────────────

describe("POST /me/deletion/confirm — leave path", () => {
  it("removes only this member; household and other members untouched; profile scrubbed", async () => {
    const owner = await createTestUser("delete-leave-owner");
    testUsers.push(owner);
    const manager = await createTestUserInHousehold("delete-leave-manager", owner.householdId, "manager");
    testUsers.push(manager);

    const res = await confirmDeletion(manager.accessToken);
    expect(res.status).toBe(204);

    // Household survives.
    const hh = await adminDb().select().from(households).where(eq(households.id, owner.householdId));
    expect(hh).toHaveLength(1);

    // Owner's membership survives.
    const members = await adminDb()
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.householdId, owner.householdId));
    expect(members).toHaveLength(1);
    expect(members[0]?.profileId).toBe(owner.userId);

    // Manager's profile scrubbed in place.
    const profileRow = await adminDb()
      .select()
      .from(profiles)
      .where(eq(profiles.id, manager.userId))
      .limit(1);
    expect(profileRow[0]?.disabledAt).not.toBeNull();
    expect(profileRow[0]?.fullName).toBeNull();

    // member_deleted_account audit row written.
    const auditRows = await adminDb()
      .select()
      .from(householdAuditLog)
      .where(
        and(
          eq(householdAuditLog.householdId, owner.householdId),
          eq(householdAuditLog.action, "member_deleted_account"),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actorId).toBe(manager.userId);

    // Job row for the leave scope.
    const jobRows = await adminDb()
      .select()
      .from(accountDeletionJobs)
      .where(eq(accountDeletionJobs.authUserId, manager.userId));
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0]?.scope).toBe("leave");

    await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.authUserId, manager.userId));
  });

  it("returns 409 must_transfer_first when an owner with a co-manager tries to delete", async () => {
    const owner = await createTestUser("delete-409-owner");
    testUsers.push(owner);
    const manager = await createTestUserInHousehold("delete-409-manager", owner.householdId, "manager");
    testUsers.push(manager);

    const res = await confirmDeletion(owner.accessToken);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("must_transfer_first");

    // Owner's account intact.
    const profileRow = await adminDb().select().from(profiles).where(eq(profiles.id, owner.userId)).limit(1);
    expect(profileRow[0]?.disabledAt).toBeNull();
  });
});

// ── Addition 2: owner + viewers only → solo ──────────────────────────────────

describe("POST /me/deletion/confirm — owner with only viewers (addition 2)", () => {
  it("deletes the household; viewers' memberships gone, viewers' profiles survive", async () => {
    const owner = await createTestUser("delete-viewers-owner");
    testUsers.push(owner);
    const viewer = await createTestUserInHousehold("delete-viewers-viewer", owner.householdId, "viewer");
    testUsers.push(viewer);

    const res = await confirmDeletion(owner.accessToken);
    expect(res.status).toBe(204);

    // Household gone.
    const hh = await adminDb().select().from(households).where(eq(households.id, owner.householdId));
    expect(hh).toHaveLength(0);

    // Viewer's membership gone (cascade from household delete).
    const viewerMembership = await adminDb()
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.profileId, viewer.userId));
    expect(viewerMembership).toHaveLength(0);

    // Viewer's profile untouched (disabledAt is the deletion marker, and
    // the email sentinel pattern is the strongest evidence of scrub —
    // test users don't have fullName set by default, so we check email).
    const viewerProfile = await adminDb()
      .select()
      .from(profiles)
      .where(eq(profiles.id, viewer.userId))
      .limit(1);
    expect(viewerProfile[0]?.disabledAt).toBeNull();
    expect(viewerProfile[0]?.email).not.toMatch(/^deleted-user-/);

    // Owner's profile scrubbed.
    const ownerProfile = await adminDb()
      .select()
      .from(profiles)
      .where(eq(profiles.id, owner.userId))
      .limit(1);
    expect(ownerProfile[0]?.disabledAt).not.toBeNull();
    expect(ownerProfile[0]?.fullName).toBeNull();

    // Job scope = solo.
    const jobRows = await adminDb()
      .select()
      .from(accountDeletionJobs)
      .where(eq(accountDeletionJobs.authUserId, owner.userId));
    expect(jobRows[0]?.scope).toBe("solo");

    await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.authUserId, owner.userId));
  });
});

// ── Addition 5: job row in transaction ───────────────────────────────────────

describe("POST /me/deletion/confirm — job row inside tx (addition 5)", () => {
  it("writes account_deletion_jobs inside the deletion tx so a post-commit crash still leaves retry state", async () => {
    const owner = await createTestUser("delete-job-row");
    testUsers.push(owner);

    const res = await confirmDeletion(owner.accessToken);
    expect(res.status).toBe(204);

    // The job row exists the instant the HTTP response returned — the only
    // writer is inside db.transaction(). If the auth-admin-delete fan-out
    // or the mark-completed step crashed, we'd still see the row here with
    // status in {'pending', 'completed'}; either is proof it was inserted
    // during commit, not after.
    const jobRows = await adminDb()
      .select()
      .from(accountDeletionJobs)
      .where(eq(accountDeletionJobs.authUserId, owner.userId));
    expect(jobRows).toHaveLength(1);
    expect(["pending", "completed"]).toContain(jobRows[0]?.status);
    expect(jobRows[0]?.profileId).toBe(owner.userId);
    expect(jobRows[0]?.authUserId).toBe(owner.userId);

    await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.authUserId, owner.userId));
  });
});

// ── Addition 4: race (owner + one manager delete simultaneously) ─────────────

describe("POST /me/deletion/confirm — race (addition 4)", () => {
  it("two simultaneous deletes end in a valid serial-order outcome; no partial state", async () => {
    const owner = await createTestUser("delete-race-owner");
    testUsers.push(owner);
    const manager = await createTestUserInHousehold("delete-race-manager", owner.householdId, "manager");
    testUsers.push(manager);
    const householdId = owner.householdId;

    // Fire both deletes concurrently. The advisory lock on
    // account-deletion:<profile_id> is keyed per profile (different
    // between these two), so neither is blocked at that step; what
    // serializes them is the FOR UPDATE lock on the households row
    // inside the tx. One wins first — the other sees a changed
    // household state and routes to its correct scope.
    const [ownerRes, managerRes] = await Promise.all([
      confirmDeletion(owner.accessToken),
      confirmDeletion(manager.accessToken),
    ]);

    // Two valid serial orders:
    //
    //   A) manager first: scope=leave, manager leaves. Then owner
    //      runs: alone now → scope=solo, household deleted.
    //      Outcome: owner 204, manager 204, household gone.
    //
    //   B) owner first: sees manager still present → 409. Then
    //      manager runs: scope=leave. Household survives with owner.
    //      Outcome: owner 409, manager 204, household present.
    const outcomes = [ownerRes.status, managerRes.status].sort();
    expect([[204, 204], [204, 409]]).toContainEqual(outcomes);

    const hh = await adminDb().select().from(households).where(eq(households.id, householdId));
    const members = await adminDb().select().from(householdMembers).where(eq(householdMembers.householdId, householdId));

    if (ownerRes.status === 204 && managerRes.status === 204) {
      // Order A: household fully gone.
      expect(hh).toHaveLength(0);
      expect(members).toHaveLength(0);
    } else {
      // Order B: household present with owner alone.
      expect(hh).toHaveLength(1);
      expect(members).toHaveLength(1);
      expect(members[0]?.profileId).toBe(owner.userId);
      expect(members[0]?.role).toBe("owner");
    }

    // Invariants that must hold in both orderings:
    //  - No household row with zero members.
    const emptyHouseholds = await adminDb()
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, householdId));
    for (const row of emptyHouseholds) {
      const m = await adminDb()
        .select({ profileId: householdMembers.profileId })
        .from(householdMembers)
        .where(eq(householdMembers.householdId, row.id));
      expect(m.length).toBeGreaterThan(0);
    }
    //  - No household row with members but no owner.
    if (hh.length > 0) {
      const owners = members.filter((m) => m.role === "owner");
      expect(owners).toHaveLength(1);
    }

    await adminDb().delete(accountDeletionJobs).where(
      inArray(accountDeletionJobs.authUserId, [owner.userId, manager.userId]),
    );
  });
});

// ── Idempotency: double-delete ───────────────────────────────────────────────

describe("POST /me/deletion/confirm — idempotency", () => {
  it("second confirm with the same still-valid token returns 401 (profile disabled)", async () => {
    const owner = await createTestUser("delete-double");
    testUsers.push(owner);

    const first = await confirmDeletion(owner.accessToken);
    expect(first.status).toBe(204);

    // The access token is still cryptographically valid; the auth user
    // hard-delete runs after the response and may or may not have
    // completed by now. Either way, the profile row has disabled_at set
    // and requireUser short-circuits to 401 before the handler runs — so
    // no second transaction is attempted.
    const second = await confirmDeletion(owner.accessToken);
    expect(second.status).toBe(401);

    // Still exactly one job row — the second call never reached runAccountDeletion.
    const jobRows = await adminDb()
      .select()
      .from(accountDeletionJobs)
      .where(eq(accountDeletionJobs.authUserId, owner.userId));
    expect(jobRows).toHaveLength(1);

    await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.authUserId, owner.userId));
  });
});

// ── Addition 1: anonymized lessons in coach views ────────────────────────────

describe("coach reads after an account deletion (addition 1)", () => {
  it("coach schedule, lesson detail, and list return 200 for an anonymized past lesson and surface 'Deleted family' + the location snapshot", async () => {
    const coach = await createTestUser("delete-coach-view-coach");
    testUsers.push(coach);
    // Promote the test user to coach — same trick existing coach tests use.
    await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

    const parent = await createTestUser("delete-coach-view-parent");
    testUsers.push(parent);
    const swimmerId = await createSwimmerForHousehold(parent);
    const locationId = await seedHomePool(parent.householdId);
    const pastLessonId = await seedPastLesson(parent.householdId, locationId, parent.userId, swimmerId);

    const pastLessonLaDate = await (async () => {
      const row = await adminDb()
        .select({ startsAt: lessons.startsAt })
        .from(lessons)
        .where(eq(lessons.id, pastLessonId))
        .limit(1);
      const d = row[0]!.startsAt;
      // Format YYYY-MM-DD in LA.
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(d);
      const partMap: Record<string, string> = {};
      for (const p of parts) partMap[p.type] = p.value;
      return `${partMap["year"]}-${partMap["month"]}-${partMap["day"]}`;
    })();

    // Delete the parent's account — anonymizes the past lesson.
    const delRes = await confirmDeletion(parent.accessToken);
    expect(delRes.status).toBe(204);

    // Re-read the coach's access token freshly since the test coach's
    // profile role was flipped in-DB after signup.
    const coachToken = coach.accessToken;

    // 1. Coach lesson detail on the anonymized lesson — 200, "Deleted
    //    family", location snapshot in locationName.
    const detailRes = await request(app)
      .get(`/coach/lessons/${pastLessonId}`)
      .set("Authorization", `Bearer ${coachToken}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.householdId).toBeNull();
    expect(detailRes.body.householdName).toBe("Deleted family");
    expect(detailRes.body.locationId).toBeNull();
    expect(detailRes.body.locationName).toBe("Home pool");
    expect(detailRes.body.swimmers).toEqual([]);
    expect(detailRes.body.anonymizedAt).not.toBeNull();
    expect(detailRes.body.swimmerCount).toBe(1);

    // 2. Coach schedule for the lesson's LA day — 200, the lesson item
    //    shows "Deleted family" on its householdName override.
    const scheduleRes = await request(app)
      .get(`/coach/schedule?date=${pastLessonLaDate}`)
      .set("Authorization", `Bearer ${coachToken}`);
    expect(scheduleRes.status).toBe(200);
    const lessonItems = (scheduleRes.body as Array<{ type: string; lesson: { id: string; anonymizedAt: string | null }; householdName?: string; locationName: string }>).filter(
      (item) => item.type === "lesson" && item.lesson.id === pastLessonId,
    );
    expect(lessonItems).toHaveLength(1);
    expect(lessonItems[0]?.householdName).toBe("Deleted family");
    expect(lessonItems[0]?.locationName).toBe("Home pool");

    // 3. Coach lessons list — 200, the anonymized row is in the body
    //    with anonymizedAt non-null.
    const listRes = await request(app)
      .get("/coach/lessons")
      .set("Authorization", `Bearer ${coachToken}`);
    expect(listRes.status).toBe(200);
    const anonymizedListRow = (listRes.body as Array<{ id: string; anonymizedAt: string | null }>).find(
      (row) => row.id === pastLessonId,
    );
    expect(anonymizedListRow).toBeDefined();
    expect(anonymizedListRow?.anonymizedAt).not.toBeNull();

    // Cleanup.
    await adminDb().delete(lessons).where(eq(lessons.id, pastLessonId));
    await adminDb().delete(coachNotifications).where(eq(coachNotifications.category, "account_deleted"));
    await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.authUserId, parent.userId));
  });
});

// ── Coach writes on anonymized lessons return 409 lesson_anonymized ─────────

describe("coach writes on an anonymized lesson return 409 lesson_anonymized", () => {
  async function seedAnonymizedLessonInStatus(
    status: "completed" | "no_show" | "approved" | "pending",
  ): Promise<string> {
    const parent = await createTestUser(`anonymize-write-${status}-parent`);
    testUsers.push(parent);
    const swimmerId = await createSwimmerForHousehold(parent);
    const locationId = await seedHomePool(parent.householdId);
    // Seed the lesson first (future for approved/pending, past otherwise).
    const lessonId =
      status === "approved" || status === "pending"
        ? await seedFutureLesson(parent.householdId, locationId, parent.userId, swimmerId)
        : await seedPastLesson(parent.householdId, locationId, parent.userId, swimmerId);
    // Force the desired terminal status before anonymization. seedPastLesson
    // defaults to completed; seedFutureLesson defaults to approved.
    if (status !== "completed" && status !== "approved") {
      await adminDb().update(lessons).set({ status }).where(eq(lessons.id, lessonId));
    }
    // Delete the parent's account — anonymizes the lesson while preserving
    // its current status (future approved → cancelled → anonymized; past
    // lessons keep their status and get anonymized).
    const delRes = await confirmDeletion(parent.accessToken);
    expect(delRes.status).toBe(204);
    // If we need a specific anonymized status that the deletion flow would
    // have overridden (e.g. approved future → canceled), restore it now.
    const row = await adminDb()
      .select({ status: lessons.status, anonymizedAt: lessons.anonymizedAt })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
      .limit(1);
    expect(row[0]?.anonymizedAt).not.toBeNull();
    if (row[0]?.status !== status) {
      await adminDb().update(lessons).set({ status }).where(eq(lessons.id, lessonId));
    }
    return lessonId;
  }

  async function cleanupAnonymizedLesson(lessonId: string): Promise<void> {
    await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
    await adminDb().delete(coachNotifications).where(eq(coachNotifications.category, "account_deleted"));
  }

  it("PATCH /coach/lessons/:id/no-show returns 409 lesson_anonymized on an anonymized completed row (never 500)", async () => {
    const coach = await createTestUser("anonymized-no-show-coach");
    testUsers.push(coach);
    await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

    const lessonId = await seedAnonymizedLessonInStatus("completed");
    try {
      const res = await request(app)
        .patch(`/coach/lessons/${lessonId}/no-show`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("lesson_anonymized");

      // The lesson row was not mutated — status stays completed, no_show_by
      // never set.
      const after = await adminDb()
        .select()
        .from(lessons)
        .where(eq(lessons.id, lessonId))
        .limit(1);
      expect(after[0]?.status).toBe("completed");
      expect(after[0]?.noShowAt).toBeNull();
      expect(after[0]?.noShowBy).toBeNull();
    } finally {
      await cleanupAnonymizedLesson(lessonId);
    }
  });

  it("PATCH /coach/lessons/:id/no-show/undo returns 409 lesson_anonymized on an anonymized no-show row", async () => {
    const coach = await createTestUser("anonymized-undo-no-show-coach");
    testUsers.push(coach);
    await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

    const lessonId = await seedAnonymizedLessonInStatus("no_show");
    try {
      const res = await request(app)
        .patch(`/coach/lessons/${lessonId}/no-show/undo`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("lesson_anonymized");

      const after = await adminDb()
        .select()
        .from(lessons)
        .where(eq(lessons.id, lessonId))
        .limit(1);
      expect(after[0]?.status).toBe("no_show");
    } finally {
      await cleanupAnonymizedLesson(lessonId);
    }
  });

  it("PATCH /lessons/:id (coach path) returns 409 lesson_anonymized on an anonymized row (never 500)", async () => {
    const coach = await createTestUser("anonymized-patch-coach");
    testUsers.push(coach);
    await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

    // approved is the status where the narrow-before-status-check bug
    // would have been most surprising; seed and test that path too.
    const lessonId = await seedAnonymizedLessonInStatus("approved");
    try {
      const res = await request(app)
        .patch(`/lessons/${lessonId}`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({ durationMinutes: 45 });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("lesson_anonymized");
    } finally {
      await cleanupAnonymizedLesson(lessonId);
    }
  });
});

// ── Backgrounds must skip anonymized rows without throwing ──────────────────

describe("background paths are safe with anonymized rows present", () => {
  it("POST /internal/cron/tick does not throw and does not touch anonymized rows", async () => {
    const parent = await createTestUser("anonymized-cron-parent");
    testUsers.push(parent);
    const swimmerId = await createSwimmerForHousehold(parent);
    const locationId = await seedHomePool(parent.householdId);
    // Past completed + past no_show + a future approved — all end up
    // anonymized after the deletion (future approved → cancelled →
    // anonymized).
    const completedId = await seedPastLesson(parent.householdId, locationId, parent.userId, swimmerId);
    const futureId = await seedFutureLesson(parent.householdId, locationId, parent.userId, swimmerId);

    const delRes = await confirmDeletion(parent.accessToken);
    expect(delRes.status).toBe(204);

    try {
      // Pin the cron secret the same way the dedicated cron-lease
      // integration test does: setup.ts sets CRON_SECRET to a known
      // 32-char value if the env hasn't been pre-populated, and the
      // handler reads the lowercase `cron-secret` header name (see
      // requireCronSecret in routes/internal.ts). Previous versions of
      // this test tolerated a 401 fallback for the X-Cron-Secret spelling
      // — that let a header-name regression hide here. Require 200 so a
      // real auth failure fails loudly.
      const cronSecret = process.env["CRON_SECRET"];
      expect(cronSecret).toBeTruthy();
      const res = await request(app)
        .post("/internal/cron/tick")
        .set("cron-secret", cronSecret!)
        .send({});

      expect(res.status).toBe(200);

      // Anonymized rows untouched — status columns match what the
      // deletion flow left behind.
      const [completedAfter, futureAfter] = await Promise.all([
        adminDb().select().from(lessons).where(eq(lessons.id, completedId)).limit(1),
        adminDb().select().from(lessons).where(eq(lessons.id, futureId)).limit(1),
      ]);
      expect(completedAfter[0]?.anonymizedAt).not.toBeNull();
      expect(completedAfter[0]?.status).toBe("completed");
      expect(futureAfter[0]?.anonymizedAt).not.toBeNull();
      expect(futureAfter[0]?.status).toBe("canceled");
    } finally {
      await adminDb().delete(lessons).where(inArray(lessons.id, [completedId, futureId]));
      await adminDb().delete(coachNotifications).where(eq(coachNotifications.category, "account_deleted"));
    }
  });
});

// ── Addition 3: rate limit ───────────────────────────────────────────────────

describe("POST /me/deletion/confirm — rate limit (addition 3)", () => {
  it("returns 429 after 5 failed confirm attempts in the same hour", async () => {
    const owner = await createTestUser("delete-rate-limit");
    testUsers.push(owner);

    // Hit the endpoint 5 times with a wrong password. Each returns 403
    // invalid_password (intentionally not 401 — see "returns 403 invalid
    // _password on wrong password" above for the rationale).
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/me/deletion/confirm")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ password: "wrong-password-xyz", confirmationPhrase: DELETION_PHRASE });
      expect(res.status).toBe(403);
    }

    // 6th attempt is blocked at the limiter — note the limiter increments
    // before the handler runs, so even the right password would be denied.
    const sixth = await request(app)
      .post("/me/deletion/confirm")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ password: TEST_PASSWORD, confirmationPhrase: DELETION_PHRASE });
    expect(sixth.status).toBe(429);

    // Account survives.
    const profileRow = await adminDb()
      .select({ disabledAt: profiles.disabledAt })
      .from(profiles)
      .where(eq(profiles.id, owner.userId))
      .limit(1);
    expect(profileRow[0]?.disabledAt).toBeNull();
  });
});

// ── scrubEmailOutboxForHousehold ────────────────────────────────────────────

describe("scrubEmailOutboxForHousehold", () => {
  // Builds a payload shaped like what services/emails/outbox writes for
  // per-lesson rows. The `swimmerFirstNames` key is the trigger the
  // deletion scrub replaces with a sentinel (see deletion.ts:scrubEmail
  // OutboxForHousehold — the UPDATE only targets payloads that still
  // carry this key, so a second scrub pass is a no-op).
  function piiPayload(swimmerFirstName: string, parentFullName: string) {
    return {
      swimmerFirstNames: [swimmerFirstName],
      parentFullName,
      locationName: "Smith Family Pool",
      startsAtIso: "2026-10-01T18:00:00.000Z",
    };
  }

  it("deletes non-terminal outbox rows for the deleted household, scrubs terminal rows of PII, and leaves another household's rows untouched", async () => {
    // Deleting owner's household (A).
    const ownerA = await createTestUser("delete-outbox-owner-a");
    testUsers.push(ownerA);
    const swimmerA = await createSwimmerForHousehold(ownerA);
    const locationA = await seedHomePool(ownerA.householdId);
    const pastLessonA = await seedPastLesson(ownerA.householdId, locationA, ownerA.userId, swimmerA);
    const futureLessonA = await seedFutureLesson(ownerA.householdId, locationA, ownerA.userId, swimmerA);

    // Control household (B) — its outbox rows must be untouched.
    const ownerB = await createTestUser("delete-outbox-owner-b");
    testUsers.push(ownerB);
    const swimmerB = await createSwimmerForHousehold(ownerB);
    const locationB = await seedHomePool(ownerB.householdId);
    const pastLessonB = await seedPastLesson(ownerB.householdId, locationB, ownerB.userId, swimmerB);

    const nonTerminal = [...LESSON_EMAIL_OUTBOX_NON_TERMINAL_STATUSES];
    const terminal = [...LESSON_EMAIL_OUTBOX_TERMINAL_STATUSES];

    // Seed one row per non-terminal status for household A's past lesson,
    // and one row per terminal status for the future lesson — both scoped
    // via lesson_id. The scrub walks all three scopes (lesson_id in the
    // anonymized set; household_id; batch_id), but lesson_id is the one
    // that always fires regardless of batch presence, so it's the
    // canonical regression surface.
    // CHECK constraint lesson_email_outbox_claim_pair ties status='sending'
    // 1:1 to a non-null claimed_until. Set a future lease on sending rows.
    const inFiveMinutes = new Date(Date.now() + 5 * 60 * 1000);
    const seededIds: string[] = [];
    let sequence = 0;
    for (const status of nonTerminal) {
      const row = await adminDb()
        .insert(lessonEmailOutbox)
        .values({
          lessonId: pastLessonA,
          event: "lesson_canceled",
          sequence: sequence++,
          recipientProfileIds: [ownerA.userId],
          payload: piiPayload("SwimmerA", "Parent A"),
          status,
          ...(status === "sending" && { claimedUntil: inFiveMinutes }),
        })
        .returning({ id: lessonEmailOutbox.id });
      seededIds.push(row[0]!.id);
    }
    for (const status of terminal) {
      const row = await adminDb()
        .insert(lessonEmailOutbox)
        .values({
          lessonId: futureLessonA,
          event: "lesson_canceled",
          sequence: sequence++,
          recipientProfileIds: [ownerA.userId],
          payload: piiPayload("SwimmerA", "Parent A"),
          status,
        })
        .returning({ id: lessonEmailOutbox.id });
      seededIds.push(row[0]!.id);
    }
    // Control row: household B's past lesson with a 'sent' payload
    // carrying PII. Must survive the deletion of A unchanged.
    const controlRowB = await adminDb()
      .insert(lessonEmailOutbox)
      .values({
        lessonId: pastLessonB,
        event: "lesson_canceled",
        sequence: 0,
        recipientProfileIds: [ownerB.userId],
        payload: piiPayload("SwimmerB", "Parent B"),
        status: "sent",
      })
      .returning({ id: lessonEmailOutbox.id });
    const controlIdB = controlRowB[0]!.id;

    // Run deletion on household A.
    const delRes = await confirmDeletion(ownerA.accessToken);
    expect(delRes.status).toBe(204);

    // Non-terminal rows for household A are gone.
    const survivingNonTerminal = await adminDb()
      .select()
      .from(lessonEmailOutbox)
      .where(
        and(
          inArray(lessonEmailOutbox.id, seededIds),
          inArray(lessonEmailOutbox.status, nonTerminal),
        ),
      );
    expect(survivingNonTerminal).toHaveLength(0);

    // Terminal rows survive but their payload has been scrubbed — the
    // swimmer first name and parent full name must not remain. The scrub
    // writes `{ _scrubbed_at: <timestamp> }` as the payload shape (see
    // deletion.ts) so a second pass is a no-op.
    const survivingTerminal = await adminDb()
      .select()
      .from(lessonEmailOutbox)
      .where(
        and(
          inArray(lessonEmailOutbox.id, seededIds),
          inArray(lessonEmailOutbox.status, terminal),
        ),
      );
    expect(survivingTerminal).toHaveLength(terminal.length);
    for (const row of survivingTerminal) {
      const serialized = JSON.stringify(row.payload);
      expect(serialized).not.toContain("SwimmerA");
      expect(serialized).not.toContain("Parent A");
      // The `swimmerFirstNames` key is the exact trigger the second-pass
      // guard looks at — asserting it's gone confirms a re-scrub won't
      // match this row again.
      expect(row.payload).not.toHaveProperty("swimmerFirstNames");
      expect(row.payload).toHaveProperty("_scrubbed_at");
    }

    // Household B's row is untouched: PII intact, status unchanged.
    const controlAfter = await adminDb()
      .select()
      .from(lessonEmailOutbox)
      .where(eq(lessonEmailOutbox.id, controlIdB))
      .limit(1);
    expect(controlAfter).toHaveLength(1);
    expect(controlAfter[0]?.status).toBe("sent");
    const controlPayload = controlAfter[0]!.payload as Record<string, unknown>;
    expect(controlPayload["swimmerFirstNames"]).toEqual(["SwimmerB"]);
    expect(controlPayload["parentFullName"]).toBe("Parent B");

    // Housekeeping — teardown of household A's anonymized lessons + the
    // control household's outbox row + lesson.
    await adminDb().delete(lessonEmailOutbox).where(eq(lessonEmailOutbox.id, controlIdB));
    await adminDb().delete(lessonEmailOutbox).where(inArray(lessonEmailOutbox.id, seededIds));
    await adminDb().delete(coachNotifications).where(eq(coachNotifications.category, "account_deleted"));
    await adminDb().delete(lessons).where(inArray(lessons.id, [pastLessonA, futureLessonA]));
    await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.authUserId, ownerA.userId));
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, swimmerB));
    await adminDb().delete(lessons).where(eq(lessons.id, pastLessonB));
    // household_audit_log.target_swimmer_id → swimmers.id is ON DELETE
    // RESTRICT (the swimmer_added row from POST /swimmers). Clear it
    // before the swimmer delete can land.
    await adminDb().delete(householdAuditLog).where(eq(householdAuditLog.targetSwimmerId, swimmerB));
    await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerB));
    await adminDb().delete(lessonLocations).where(eq(lessonLocations.id, locationB));
  });
});

