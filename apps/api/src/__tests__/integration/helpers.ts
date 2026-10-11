// Helpers for integration tests. Each helper hits a real local Supabase stack:
// it creates a real auth user via the admin API, signs them in to get a JWT,
// attests their age so requireUser accepts them, and returns a cleanup fn.

import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { guardians, profiles, swimmers } from "../../db/schema";

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

export type TestUser = {
  userId: string;
  email: string;
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
 * Creates a real Supabase auth user, signs them in, attests their age so
 * requireUser accepts them, and returns a cleanup function that deletes the
 * auth user (which cascades to profile and dependent rows).
 */
export async function createTestUser(emailPrefix: string): Promise<TestUser> {
  const email = uniqueEmail(emailPrefix);
  const password = DEFAULT_TEST_PASSWORD;

  const userId = await createSupabaseUser(email, password);

  try {
    await attestAge(userId);
    const accessToken = await signIn(email, password);

    return {
      userId,
      email,
      accessToken,
      cleanup: async () => {
        // Delete this user's swimmers before deleting the auth user.
        // swimmers.publicConsentBy references profiles with ON DELETE RESTRICT,
        // so the auth cascade would fail if any swimmer rows still reference this profile.
        const guardianRows = await adminDb()
          .select({ swimmerId: guardians.swimmerId })
          .from(guardians)
          .where(eq(guardians.profileId, userId));
        for (const row of guardianRows) {
          await adminDb()
            .delete(swimmers)
            .where(eq(swimmers.id, row.swimmerId));
        }
        await deleteSupabaseUser(userId);
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
