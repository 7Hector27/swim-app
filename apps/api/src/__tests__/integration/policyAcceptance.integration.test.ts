// Policy acceptance (ADR 036 Phase 8 Part B Stop 3) — end-to-end against
// the test Supabase stack. Covers signup-time acceptance, the stale-version
// 422, the /me/policies/missing + /me/policies/accept endpoints, the
// append-only trigger carve-out, and the account-deletion anonymization.

import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, desc, eq, sql } from "drizzle-orm";

import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  deleteSupabaseUser,
  type TestUser,
} from "./helpers";
import {
  householdAuditLog,
  householdMembers,
  households,
  lessonEmailOutbox,
  profiles,
  userPolicyAcceptances,
} from "../../db/schema";
import {
  PAYMENTS_REFUND_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "@swim-app/shared";

const app = createApp(pino({ level: "silent" }));

// Users created via POST /auth/signup — tracked so afterEach can clean up.
// Each entry carries its Supabase user id + household id so we can tear
// down FKs in the right order.
type SignedUpUser = { userId: string; householdId: string };
const signedUpUsers: SignedUpUser[] = [];
const createdTestUsers: TestUser[] = [];

async function signUpUser(args: {
  email: string;
  password?: string;
  acceptedPolicyVersions?: {
    terms: string;
    privacy: string;
    payments_refund: string;
  };
}): Promise<request.Response> {
  return request(app)
    .post("/auth/signup")
    .send({
      fullName: "Policy Test Parent",
      email: args.email,
      password: args.password ?? "integration-test-password-1",
      birthDate: "1990-01-01",
      acceptedTerms: true,
      acceptedPolicyVersions:
        args.acceptedPolicyVersions ?? {
          terms: TERMS_VERSION,
          privacy: PRIVACY_VERSION,
          payments_refund: PAYMENTS_REFUND_VERSION,
        },
    });
}

function uniqueEmail(prefix: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}@test.local`;
}

async function trackSignedUp(email: string): Promise<SignedUpUser> {
  // Resolve the user id + household id by walking the profile row. The
  // profile exists because the on_auth_user_created trigger committed
  // inside the signup transaction.
  const profileRows = await adminDb()
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.email, email));
  const userId = profileRows[0]!.id;
  const memberRows = await adminDb()
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.profileId, userId));
  const householdId = memberRows[0]!.householdId;
  const record = { userId, householdId };
  signedUpUsers.push(record);
  return record;
}

async function signInUser(email: string, password: string): Promise<string> {
  const supabaseUrl = process.env["SUPABASE_URL"]!;
  const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  });
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("sign-in failed for policy test user");
  }
  return data.access_token;
}

// Email confirmation flow isn't gated in the local stack — signUp returns
// a user id immediately. But the test stack requires email confirmation
// to issue a session, so we flip the confirmed flag via the admin API
// before signing in.
async function confirmSupabaseEmail(userId: string): Promise<void> {
  const supabaseUrl = process.env["SUPABASE_URL"]!;
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ email_confirm: true }),
  });
}

async function cleanupSignedUp(record: SignedUpUser): Promise<void> {
  // The append-only trigger on user_policy_acceptances blocks a plain
  // DELETE, so bypass it under session_replication_role=replica (same
  // pattern as the balance ledger's integration cleanup).
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`DELETE FROM user_policy_acceptances WHERE user_id = ${record.userId}::uuid`,
    );
  });
  await adminDb()
    .delete(householdAuditLog)
    .where(eq(householdAuditLog.householdId, record.householdId));
  await adminDb()
    .delete(householdMembers)
    .where(eq(householdMembers.householdId, record.householdId));
  await adminDb().delete(households).where(eq(households.id, record.householdId));
  await deleteSupabaseUser(record.userId);
  await adminDb().delete(profiles).where(eq(profiles.id, record.userId));
}

afterEach(async () => {
  // Sweep any coach_account_deleted outbox rows the deletion-flow test
  // left behind — the accountDeletionRealFlows test asserts exactly one
  // row per deletion and will fail if our deletion exercise leaves
  // residue in the outbox.
  try {
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(eq(lessonEmailOutbox.event, "coach_account_deleted"));
  } catch {
    /* best-effort */
  }
  for (const record of signedUpUsers.splice(0)) {
    await cleanupSignedUp(record).catch(() => {
      /* best-effort */
    });
  }
  for (const user of createdTestUsers.splice(0)) {
    await user.cleanup().catch(() => {
      /* best-effort */
    });
  }
});

afterAll(async () => {
  await closeAdminDb();
});

describe("POST /auth/signup — policy acceptance writes", () => {
  it("inserts three user_policy_acceptances rows with source='signup'", async () => {
    const email = uniqueEmail("policy-signup-ok");
    const res = await signUpUser({ email });
    expect(res.status).toBe(201);

    const record = await trackSignedUp(email);
    const rows = await adminDb()
      .select({
        policySlug: userPolicyAcceptances.policySlug,
        version: userPolicyAcceptances.version,
        source: userPolicyAcceptances.source,
      })
      .from(userPolicyAcceptances)
      .where(eq(userPolicyAcceptances.userId, record.userId))
      .orderBy(userPolicyAcceptances.policySlug);

    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.policySlug))).toEqual(
      new Set(["terms", "privacy", "payments_refund"]),
    );
    for (const row of rows) {
      expect(row.source).toBe("signup");
    }
    const bySlug = Object.fromEntries(rows.map((row) => [row.policySlug, row.version]));
    expect(bySlug["terms"]).toBe(TERMS_VERSION);
    expect(bySlug["privacy"]).toBe(PRIVACY_VERSION);
    expect(bySlug["payments_refund"]).toBe(PAYMENTS_REFUND_VERSION);

    // Each acceptance is paired with a household_audit_log row.
    const auditRows = await adminDb()
      .select({ action: householdAuditLog.action })
      .from(householdAuditLog)
      .where(
        and(
          eq(householdAuditLog.householdId, record.householdId),
          eq(householdAuditLog.action, "policy_accepted_signup"),
        ),
      );
    expect(auditRows).toHaveLength(3);
  });

  it("signup with stale acceptedPolicyVersions returns 422 and creates no user", async () => {
    const email = uniqueEmail("policy-signup-stale");
    const res = await signUpUser({
      email,
      acceptedPolicyVersions: {
        terms: "1999-01-01",
        privacy: PRIVACY_VERSION,
        payments_refund: PAYMENTS_REFUND_VERSION,
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("stale_policy_versions");

    // No profile row should have been created.
    const profileRows = await adminDb()
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, email));
    expect(profileRows).toHaveLength(0);
  });
});

describe("GET /me/policies/missing", () => {
  it("returns empty missing[] when all three are current", async () => {
    const owner = await createTestUser("policy-missing-current");
    createdTestUsers.push(owner);
    // Seed three current-version acceptances.
    for (const slug of ["terms", "privacy", "payments_refund"] as const) {
      await adminDb().insert(userPolicyAcceptances).values({
        userId: owner.userId,
        policySlug: slug,
        version:
          slug === "terms"
            ? TERMS_VERSION
            : slug === "privacy"
              ? PRIVACY_VERSION
              : PAYMENTS_REFUND_VERSION,
        source: "signup",
      });
    }
    const res = await request(app)
      .get("/me/policies/missing")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.missing).toEqual([]);
  });

  it("surfaces slugs whose current version is ahead of the user's latest acceptance", async () => {
    const owner = await createTestUser("policy-missing-stale");
    createdTestUsers.push(owner);
    // Current terms + old payments_refund; no privacy row at all.
    await adminDb().insert(userPolicyAcceptances).values({
      userId: owner.userId,
      policySlug: "terms",
      version: TERMS_VERSION,
      source: "signup",
    });
    await adminDb().insert(userPolicyAcceptances).values({
      userId: owner.userId,
      policySlug: "payments_refund",
      version: "1999-01-01",
      source: "signup",
    });

    const res = await request(app)
      .get("/me/policies/missing")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    const bySlug = Object.fromEntries(
      (res.body.missing as Array<{ policySlug: string; currentVersion: string; lastAcceptedVersion: string | null }>).map(
        (row) => [row.policySlug, row],
      ),
    );
    expect(bySlug["privacy"]).toEqual({
      policySlug: "privacy",
      currentVersion: PRIVACY_VERSION,
      lastAcceptedVersion: null,
    });
    expect(bySlug["payments_refund"]).toEqual({
      policySlug: "payments_refund",
      currentVersion: PAYMENTS_REFUND_VERSION,
      lastAcceptedVersion: "1999-01-01",
    });
    expect(bySlug["terms"]).toBeUndefined();
  });
});

describe("POST /me/policies/accept", () => {
  it("writes one row per acceptance with source='reaccept_prompt' and audit", async () => {
    const owner = await createTestUser("policy-accept-ok");
    createdTestUsers.push(owner);

    const res = await request(app)
      .post("/me/policies/accept")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        acceptances: [
          { policySlug: "terms", version: TERMS_VERSION },
          { policySlug: "privacy", version: PRIVACY_VERSION },
          { policySlug: "payments_refund", version: PAYMENTS_REFUND_VERSION },
        ],
      });
    expect(res.status).toBe(201);
    expect(new Set(res.body.acceptedSlugs)).toEqual(
      new Set(["terms", "privacy", "payments_refund"]),
    );

    const rows = await adminDb()
      .select({ policySlug: userPolicyAcceptances.policySlug, source: userPolicyAcceptances.source })
      .from(userPolicyAcceptances)
      .where(eq(userPolicyAcceptances.userId, owner.userId));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.source).toBe("reaccept_prompt");
    }
    const auditRows = await adminDb()
      .select({ action: householdAuditLog.action })
      .from(householdAuditLog)
      .where(
        and(
          eq(householdAuditLog.householdId, owner.householdId),
          eq(householdAuditLog.action, "policy_accepted_reprompt"),
        ),
      );
    expect(auditRows).toHaveLength(3);
  });

  it("returns 422 when no acceptances are submitted", async () => {
    const owner = await createTestUser("policy-accept-empty");
    createdTestUsers.push(owner);
    const res = await request(app)
      .post("/me/policies/accept")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ acceptances: [] });
    expect(res.status).toBe(422);
  });
});

describe("user_policy_acceptances append-only trigger", () => {
  it("blocks UPDATE of non-identity columns outside the identity-nullification carve-out", async () => {
    const owner = await createTestUser("policy-trigger-update");
    createdTestUsers.push(owner);
    const inserted = await adminDb()
      .insert(userPolicyAcceptances)
      .values({
        userId: owner.userId,
        policySlug: "terms",
        version: TERMS_VERSION,
        source: "signup",
      })
      .returning({ id: userPolicyAcceptances.id });
    const rowId = inserted[0]!.id;

    await expect(
      adminDb().execute(
        sql`UPDATE user_policy_acceptances SET version = '1999-01-01' WHERE id = ${rowId}::uuid`,
      ),
    ).rejects.toThrow(/append-only/i);

    await expect(
      adminDb().execute(sql`DELETE FROM user_policy_acceptances WHERE id = ${rowId}::uuid`),
    ).rejects.toThrow(/append-only/i);

    // Identity nullify IS allowed.
    await adminDb().execute(
      sql`UPDATE user_policy_acceptances SET user_id = NULL WHERE id = ${rowId}::uuid`,
    );
    const after = await adminDb()
      .select({ userId: userPolicyAcceptances.userId })
      .from(userPolicyAcceptances)
      .where(eq(userPolicyAcceptances.id, rowId));
    expect(after[0]!.userId).toBeNull();
  });
});

describe("account deletion anonymizes user_policy_acceptances.user_id", () => {
  it("nulls user_id on the deleted user's acceptance rows", async () => {
    // Fresh signup through the real route so we get three rows + an
    // on_auth_user_created household + the policy acceptance rows.
    const email = uniqueEmail("policy-deletion");
    const password = "integration-test-password-1";
    const signUpRes = await signUpUser({ email, password });
    expect(signUpRes.status).toBe(201);

    const record = await trackSignedUp(email);
    // Confirm email + attest age so the account-deletion endpoint accepts.
    await confirmSupabaseEmail(record.userId);
    await adminDb()
      .update(profiles)
      .set({ ageAttestedAt: new Date() })
      .where(eq(profiles.id, record.userId));

    const accessToken = await signInUser(email, password);

    // Preview first — POST, not GET; any auth-compatible body works
    // because the validate() middleware only enforces body shape via
    // Zod {} on the preview endpoint.
    const previewRes = await request(app)
      .post("/me/deletion/preview")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(previewRes.status).toBe(200);

    const confirmRes = await request(app)
      .post("/me/deletion/confirm")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password, confirmationPhrase: "delete" });
    expect(confirmRes.status).toBe(204);

    // The acceptance rows survived with user_id nulled. Discriminate the
    // ghosts of this user from any other test's ghosts by walking by
    // acceptedAt desc — the three most-recent null-user_id rows belong
    // to this test (we just created them + nulled them inside a single
    // tx moments ago).
    const allRows = await adminDb()
      .select({
        policySlug: userPolicyAcceptances.policySlug,
        userId: userPolicyAcceptances.userId,
      })
      .from(userPolicyAcceptances)
      .orderBy(desc(userPolicyAcceptances.acceptedAt))
      .limit(10);
    const matchedRows = allRows.filter((row) => row.userId === null);
    expect(matchedRows.length).toBeGreaterThanOrEqual(3);

    // No row for this user still points at the profile id.
    const liveRows = await adminDb()
      .select({ id: userPolicyAcceptances.id })
      .from(userPolicyAcceptances)
      .where(eq(userPolicyAcceptances.userId, record.userId));
    expect(liveRows).toHaveLength(0);

    // Clean-up: the deletion transaction already dropped audit + household
    // rows. The acceptance ghosts (null user_id) survive by design for
    // audit retention — leave them. The Supabase auth user may or may
    // not have been hard-deleted by the post-commit microtask yet, so
    // best-effort cleanup.
    signedUpUsers.splice(signedUpUsers.indexOf(record), 1);
    await deleteSupabaseUser(record.userId).catch(() => {
      /* best-effort */
    });
  });
});
