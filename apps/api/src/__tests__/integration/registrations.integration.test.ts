import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq } from "drizzle-orm";
import { createApp } from "../../app";
import { householdAuditLog, leagueRegistrations, swimmers } from "../../db/schema";
import { adminDb, closeAdminDb, createTestUser } from "./helpers";

const logger = pino({ level: "silent" });
const app = createApp(logger);

const createdSwimmerIds = new Set<string>();

async function hardDeleteSwimmer(swimmerId: string): Promise<void> {
  await adminDb().delete(leagueRegistrations).where(eq(leagueRegistrations.swimmerId, swimmerId));
  await adminDb().delete(householdAuditLog).where(eq(householdAuditLog.targetSwimmerId, swimmerId));
  await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
}

afterEach(async () => {
  for (const swimmerId of createdSwimmerIds) {
    await hardDeleteSwimmer(swimmerId).catch(() => {
      /* ignore — row may already be gone */
    });
  }
  createdSwimmerIds.clear();
});

afterAll(async () => {
  await closeAdminDb();
});

function validSwimmerBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Testy",
    lastName: "McTestface",
    birthDate: "2015-06-01",
    sex: "female" as const,
    isPublic: false,
    clubs: [],
    ...overrides,
  };
}

async function createSwimmer(accessToken: string): Promise<string> {
  const res = await request(app)
    .post("/swimmers")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(validSwimmerBody());
  expect(res.status).toBe(201);
  const swimmerId = res.body.id as string;
  createdSwimmerIds.add(swimmerId);
  return swimmerId;
}

// ── Register ──────────────────────────────────────────────────────────────────

describe("PUT /swimmers/:id/registrations/:league — register", () => {
  it("returns 200 and creates an active row in the DB", async () => {
    const parent = await createTestUser("reg-register");
    try {
      const swimmerId = await createSwimmer(parent.accessToken);

      const res = await request(app)
        .put(`/swimmers/${swimmerId}/registrations/club`)
        .set("Authorization", `Bearer ${parent.accessToken}`);
      expect(res.status).toBe(200);

      const rows = await adminDb()
        .select()
        .from(leagueRegistrations)
        .where(
          and(
            eq(leagueRegistrations.swimmerId, swimmerId),
            eq(leagueRegistrations.league, "club"),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.withdrawnAt).toBeNull();
      expect(rows[0]?.registeredOn).toBeTruthy();
    } finally {
      await parent.cleanup();
    }
  });

  it("is idempotent: second PUT on an active registration returns 200 without adding a row", async () => {
    const parent = await createTestUser("reg-idempotent");
    try {
      const swimmerId = await createSwimmer(parent.accessToken);

      await request(app)
        .put(`/swimmers/${swimmerId}/registrations/summer_league`)
        .set("Authorization", `Bearer ${parent.accessToken}`);

      const res = await request(app)
        .put(`/swimmers/${swimmerId}/registrations/summer_league`)
        .set("Authorization", `Bearer ${parent.accessToken}`);
      expect(res.status).toBe(200);

      const rows = await adminDb()
        .select()
        .from(leagueRegistrations)
        .where(eq(leagueRegistrations.swimmerId, swimmerId));
      expect(rows).toHaveLength(1);
    } finally {
      await parent.cleanup();
    }
  });
});

// ── Withdraw ──────────────────────────────────────────────────────────────────

describe("DELETE /swimmers/:id/registrations/:league — withdraw", () => {
  it("returns 204 and sets withdrawn_at in the DB", async () => {
    const parent = await createTestUser("reg-withdraw");
    try {
      const swimmerId = await createSwimmer(parent.accessToken);

      await request(app)
        .put(`/swimmers/${swimmerId}/registrations/club`)
        .set("Authorization", `Bearer ${parent.accessToken}`);

      const res = await request(app)
        .delete(`/swimmers/${swimmerId}/registrations/club`)
        .set("Authorization", `Bearer ${parent.accessToken}`);
      expect(res.status).toBe(204);

      const rows = await adminDb()
        .select()
        .from(leagueRegistrations)
        .where(eq(leagueRegistrations.swimmerId, swimmerId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.withdrawnAt).not.toBeNull();
    } finally {
      await parent.cleanup();
    }
  });

  it("returns 404 when not registered for the current season", async () => {
    const parent = await createTestUser("reg-delete-404");
    try {
      const swimmerId = await createSwimmer(parent.accessToken);

      const res = await request(app)
        .delete(`/swimmers/${swimmerId}/registrations/club`)
        .set("Authorization", `Bearer ${parent.accessToken}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: "Not registered" });
    } finally {
      await parent.cleanup();
    }
  });
});

// ── Re-register keeps registered_on ──────────────────────────────────────────

describe("re-register after withdraw", () => {
  it("keeps the original registered_on date", async () => {
    const parent = await createTestUser("reg-reregister");
    try {
      const swimmerId = await createSwimmer(parent.accessToken);

      await request(app)
        .put(`/swimmers/${swimmerId}/registrations/club`)
        .set("Authorization", `Bearer ${parent.accessToken}`);

      const firstRows = await adminDb()
        .select({ registeredOn: leagueRegistrations.registeredOn })
        .from(leagueRegistrations)
        .where(eq(leagueRegistrations.swimmerId, swimmerId));
      const originalDate = firstRows[0]?.registeredOn;
      expect(originalDate).toBeTruthy();

      await request(app)
        .delete(`/swimmers/${swimmerId}/registrations/club`)
        .set("Authorization", `Bearer ${parent.accessToken}`);

      await request(app)
        .put(`/swimmers/${swimmerId}/registrations/club`)
        .set("Authorization", `Bearer ${parent.accessToken}`);

      const reRows = await adminDb()
        .select({
          registeredOn: leagueRegistrations.registeredOn,
          withdrawnAt: leagueRegistrations.withdrawnAt,
        })
        .from(leagueRegistrations)
        .where(eq(leagueRegistrations.swimmerId, swimmerId));
      expect(reRows).toHaveLength(1);
      expect(reRows[0]?.withdrawnAt).toBeNull();
      expect(reRows[0]?.registeredOn).toBe(originalDate);
    } finally {
      await parent.cleanup();
    }
  });
});

// ── Parent B isolation ────────────────────────────────────────────────────────

describe("parent isolation", () => {
  it("Parent B gets 404 on PUT for Parent A's swimmer", async () => {
    const parentA = await createTestUser("reg-iso-a-put");
    const parentB = await createTestUser("reg-iso-b-put");
    try {
      const swimmerId = await createSwimmer(parentA.accessToken);

      const res = await request(app)
        .put(`/swimmers/${swimmerId}/registrations/club`)
        .set("Authorization", `Bearer ${parentB.accessToken}`);
      expect(res.status).toBe(404);
    } finally {
      await parentB.cleanup();
      await parentA.cleanup();
    }
  });

  it("Parent B gets 404 on DELETE for Parent A's swimmer", async () => {
    const parentA = await createTestUser("reg-iso-a-del");
    const parentB = await createTestUser("reg-iso-b-del");
    try {
      const swimmerId = await createSwimmer(parentA.accessToken);

      await request(app)
        .put(`/swimmers/${swimmerId}/registrations/club`)
        .set("Authorization", `Bearer ${parentA.accessToken}`);

      const res = await request(app)
        .delete(`/swimmers/${swimmerId}/registrations/club`)
        .set("Authorization", `Bearer ${parentB.accessToken}`);
      expect(res.status).toBe(404);
    } finally {
      await parentB.cleanup();
      await parentA.cleanup();
    }
  });
});

// ── currentLeagues in GET /swimmers/me and GET /swimmers/:id ─────────────────

describe("currentLeagues in swimmer responses", () => {
  it("GET /swimmers/me includes registered leagues and excludes withdrawn ones", async () => {
    const parent = await createTestUser("reg-current-me");
    try {
      const swimmerId = await createSwimmer(parent.accessToken);

      await request(app)
        .put(`/swimmers/${swimmerId}/registrations/club`)
        .set("Authorization", `Bearer ${parent.accessToken}`);
      await request(app)
        .put(`/swimmers/${swimmerId}/registrations/summer_league`)
        .set("Authorization", `Bearer ${parent.accessToken}`);
      await request(app)
        .delete(`/swimmers/${swimmerId}/registrations/summer_league`)
        .set("Authorization", `Bearer ${parent.accessToken}`);

      const res = await request(app)
        .get("/swimmers/me")
        .set("Authorization", `Bearer ${parent.accessToken}`);
      expect(res.status).toBe(200);

      const swimmer = (res.body as Array<{ id: string; currentLeagues: string[] }>).find(
        (s) => s.id === swimmerId,
      );
      expect(swimmer?.currentLeagues).toEqual(["club"]);
    } finally {
      await parent.cleanup();
    }
  });

  it("GET /swimmers/:id includes currentLeagues", async () => {
    const parent = await createTestUser("reg-current-id");
    try {
      const swimmerId = await createSwimmer(parent.accessToken);

      await request(app)
        .put(`/swimmers/${swimmerId}/registrations/summer_league`)
        .set("Authorization", `Bearer ${parent.accessToken}`);

      const res = await request(app)
        .get(`/swimmers/${swimmerId}`)
        .set("Authorization", `Bearer ${parent.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.currentLeagues).toEqual(["summer_league"]);
    } finally {
      await parent.cleanup();
    }
  });
});
