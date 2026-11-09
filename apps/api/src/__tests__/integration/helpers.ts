// Helpers for integration tests. Each helper hits a real local Supabase stack:
// it creates a real auth user via the admin API, signs them in to get a JWT,
// attests their age so requireUser accepts them, and returns a cleanup fn.

import { createClient } from "@supabase/supabase-js";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  coachNotifications,
  householdAuditLog,
  householdBalanceLedger,
  householdMembers,
  households,
  lessons,
  meetSwims,
  profiles,
  swimmerClubs,
  swimmers,
} from "../../db/schema";
import { __settlePendingCoachAlertsForTests } from "../../lib/lessonApproval";

// All env vars are validated in setup.ts before any test code runs.
// These getters use non-null assertions since setup.ts guarantees presence.

const DEFAULT_TEST_PASSWORD = "integration-test-password-1";

function getSupabaseUrl(): string {
  return process.env["SUPABASE_URL"]!;
}

function getServiceRoleKey(): string {
  return process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
}

function getAnonKey(): string {
  return process.env["SUPABASE_PUBLISHABLE_KEY"]!;
}

function getIntegrationDatabaseUrl(): string {
  return process.env["INTEGRATION_DATABASE_URL"]!;
}

// Direct DB connection using service-role equivalent (the local postgres super
// user). Used for test setup (age attestation) and assertions. Kept separate
// from the app's db client so we never share pooled connections with the app
// under test.
let adminPool: ReturnType<typeof postgres> | null = null;
let adminDbSingleton: ReturnType<typeof drizzle> | null = null;

export function adminDb(): ReturnType<typeof drizzle> {
  if (adminDbSingleton) return adminDbSingleton;
  adminPool = postgres(getIntegrationDatabaseUrl());
  adminDbSingleton = drizzle(adminPool);
  return adminDbSingleton;
}

export async function closeAdminDb(): Promise<void> {
  if (adminPool) {
    await adminPool.end();
    adminPool = null;
    adminDbSingleton = null;
  }
}

/**
 * Settle in-flight notify* stub work, then delete every coach_notifications
 * row that references the given household's lessons. Call this BEFORE
 * deleting lessons / batches / households in test cleanup — the
 * coach_notifications.lesson_id and .batch_id FKs are ON DELETE RESTRICT
 * (ADR 031: in production, lessons and batches are never hard-deleted, so
 * RESTRICT is correct for the live app and tests delete in the right order).
 */
export async function settleAndCleanupCoachNotificationsForHousehold(
  householdId: string,
): Promise<void> {
  await __settlePendingCoachAlertsForTests();
  const lessonRows = await adminDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.householdId, householdId));
  const lessonIds = lessonRows.map((row) => row.id);
  if (lessonIds.length > 0) {
    await adminDb()
      .delete(coachNotifications)
      .where(inArray(coachNotifications.lessonId, lessonIds));
  }
}

/**
 * Credits a household's balance in one insert — writes a coach_adjustment
 * ledger row with the given actor and a `reason` that marks it as test
 * seed data. The balance derivation (`SUM(amount_cents)`) picks it up
 * immediately; booking paths see the full seeded amount.
 *
 * Doesn't take the balance advisory lock — tests call this at setup time,
 * before any booking activity, so no concurrent writer exists. The lock
 * is only required when a reader is going to decide a write based on
 * what it sees (ADR 036 §1 concurrency).
 */
export async function seedHouseholdBalanceForTest(
  args: {
    householdId: string;
    actorId: string;
    amountCents: number;
    reason?: string;
  },
): Promise<void> {
  await adminDb().insert(householdBalanceLedger).values({
    householdId: args.householdId,
    actorId: args.actorId,
    entryType: "coach_adjustment",
    amountCents: args.amountCents,
    reason: args.reason ?? "integration-test-seed",
  });
}

/**
 * Hard-deletes the test household's ledger + audit rows at cleanup time.
 * The append-only trigger blocks a plain DELETE, so we bypass it under
 * session_replication_role=replica (same pattern as
 * balanceLedger.integration.test.ts / stripeWebhook.integration.test.ts).
 */
export async function clearHouseholdBalanceForTest(householdId: string): Promise<void> {
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`DELETE FROM household_balance_ledger WHERE household_id = ${householdId}::uuid`,
    );
  });
}

/**
 * Fully removes a swimmer row and all rows that reference it with ON DELETE
 * RESTRICT foreign keys: household_audit_log.target_swimmer_id and
 * swimmer_clubs.swimmer_id.  Always use this instead of a bare swimmer delete
 * in test cleanup so the FK chain is respected.
 */
export async function hardDeleteSwimmer(swimmerId: string): Promise<void> {
  await adminDb().delete(meetSwims).where(eq(meetSwims.swimmerId, swimmerId));
  await adminDb().delete(householdAuditLog).where(eq(householdAuditLog.targetSwimmerId, swimmerId));
  await adminDb().delete(swimmerClubs).where(eq(swimmerClubs.swimmerId, swimmerId));
  await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
}

export type TestUser = {
  userId: string;
  email: string;
  householdId: string;
  accessToken: string;
  cleanup: () => Promise<void>;
};

function uniqueEmail(prefix: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}@test.local`;
}

async function createSupabaseUser(
  email: string,
  password: string,
): Promise<string> {
  const url = `${getSupabaseUrl()}/auth/v1/admin/users`;
  const key = getServiceRoleKey();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create Supabase user (${response.status}): ${text}`,
    );
  }

  const data = (await response.json()) as { id?: string };
  if (!data.id) {
    throw new Error("Supabase admin create user response missing id");
  }
  return data.id;
}

async function deleteSupabaseUser(userId: string): Promise<void> {
  const url = `${getSupabaseUrl()}/auth/v1/admin/users/${userId}`;
  const key = getServiceRoleKey();
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(
      `Failed to delete Supabase user (${response.status}): ${text}`,
    );
  }
}

async function signIn(email: string, password: string): Promise<string> {
  const client = createClient(getSupabaseUrl(), getAnonKey());
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    throw new Error(
      `Failed to sign in test user: ${error?.message ?? "no session returned"}`,
    );
  }

  return data.session.access_token;
}

async function attestAge(userId: string): Promise<void> {
  await adminDb()
    .update(profiles)
    .set({ ageAttestedAt: new Date() })
    .where(eq(profiles.id, userId));
}

/**
 * Creates a real Supabase auth user, signs them in, and attests their age so
 * requireUser accepts them. The on_auth_user_created trigger creates the
 * household + owner membership atomically; this helper queries that record.
 *
 * Parent bookings charge the balance (ADR 036 Phase 4); each test that
 * exercises POST /lessons must seed its household's balance up-front via
 * `seedHouseholdBalanceForTest` (or helpers that wrap it). The deliberate
 * choice not to auto-seed here: Phase 8 hasn't relaxed the append-only
 * trigger to permit ledger nullification during account deletion, so a
 * ledger row would break the /me/deletion/confirm path.
 */
export async function createTestUser(emailPrefix: string): Promise<TestUser> {
  const email = uniqueEmail(emailPrefix);
  const password = DEFAULT_TEST_PASSWORD;

  const userId = await createSupabaseUser(email, password);

  try {
    await attestAge(userId);

    const memberRows = await adminDb()
      .select({ householdId: householdMembers.householdId })
      .from(householdMembers)
      .where(eq(householdMembers.profileId, userId))
      .limit(1);

    if (!memberRows[0]) {
      throw new Error(`Trigger did not create a household membership for ${userId}`);
    }
    const householdId = memberRows[0].householdId;

    const accessToken = await signIn(email, password);

    return {
      userId,
      email,
      householdId,
      accessToken,
      cleanup: async () => {
        // Hard-delete each swimmer individually so the RESTRICT FK chain is
        // respected: audit_log.target_swimmer_id → swimmer → profile.
        const swimmerRows = await adminDb()
          .select({ id: swimmers.id })
          .from(swimmers)
          .where(eq(swimmers.householdId, householdId));
        for (const row of swimmerRows) {
          await hardDeleteSwimmer(row.id);
        }
        // Ledger is append-only; the trigger blocks a plain DELETE so we
        // bypass it under session_replication_role=replica. Done before
        // the household delete even though the FK is ON DELETE SET NULL,
        // so leftover test rows don't accumulate forever.
        await clearHouseholdBalanceForTest(householdId);
        // Delete remaining audit log rows (member_added etc. with no swimmer ref).
        await adminDb().delete(householdAuditLog).where(eq(householdAuditLog.householdId, householdId));
        // Delete members before household (profileId has ON DELETE RESTRICT on profiles).
        await adminDb().delete(householdMembers).where(eq(householdMembers.householdId, householdId));
        await adminDb().delete(households).where(eq(households.id, householdId));
        // ADR 034: profiles.id → auth.users.id is no longer ON DELETE CASCADE,
        // so deleting the auth user no longer removes the profile row. Delete
        // the profile explicitly to avoid leaving orphans across test runs.
        await deleteSupabaseUser(userId);
        await adminDb().delete(profiles).where(eq(profiles.id, userId));
      },
    };
  } catch (err) {
    // Best-effort cleanup if setup fails partway through.
    await deleteSupabaseUser(userId).catch(() => {
      /* ignore */
    });
    throw err;
  }
}

/**
 * Creates a user and places them in an existing household with a given role.
 * The trigger creates a household for every new user, so this helper deletes
 * the auto-created household and inserts the user into the target household.
 *
 * Use this to test role-based access control from a viewer or manager perspective.
 */
export async function createTestUserInHousehold(
  emailPrefix: string,
  targetHouseholdId: string,
  role: "owner" | "manager" | "viewer",
): Promise<TestUser> {
  const email = uniqueEmail(emailPrefix);
  const password = DEFAULT_TEST_PASSWORD;

  const userId = await createSupabaseUser(email, password);

  try {
    await attestAge(userId);

    // The trigger created a household for this user. Find it, then clean it up
    // so we can place the user in the target household instead.
    const autoMemberRows = await adminDb()
      .select({ householdId: householdMembers.householdId })
      .from(householdMembers)
      .where(eq(householdMembers.profileId, userId))
      .limit(1);

    const autoHouseholdId = autoMemberRows[0]?.householdId;

    if (autoHouseholdId) {
      await adminDb().delete(householdAuditLog).where(eq(householdAuditLog.householdId, autoHouseholdId));
      await adminDb().delete(householdMembers).where(eq(householdMembers.householdId, autoHouseholdId));
      await adminDb().delete(households).where(eq(households.id, autoHouseholdId));
    }

    await adminDb().insert(householdMembers).values({
      householdId: targetHouseholdId,
      profileId: userId,
      role,
    });

    const accessToken = await signIn(email, password);

    return {
      userId,
      email,
      householdId: targetHouseholdId,
      accessToken,
      cleanup: async () => {
        // Remove any audit log entries this user created in the target household.
        await adminDb().delete(householdAuditLog).where(eq(householdAuditLog.actorId, userId));
        await adminDb().delete(householdMembers).where(eq(householdMembers.profileId, userId));
        // ADR 034: profiles.id → auth.users.id is no longer ON DELETE CASCADE.
        await deleteSupabaseUser(userId);
        await adminDb().delete(profiles).where(eq(profiles.id, userId));
      },
    };
  } catch (err) {
    await deleteSupabaseUser(userId).catch(() => {
      /* ignore */
    });
    throw err;
  }
}
