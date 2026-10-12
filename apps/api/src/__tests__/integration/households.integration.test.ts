import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { createApp } from "../../app";
import { closeAdminDb, createTestUser } from "./helpers";

const logger = pino({ level: "silent" });
const app = createApp(logger);

afterAll(async () => {
  await closeAdminDb();
});

describe("GET /households/mine", () => {
  it("returns household id, name, myRole=owner, member list, and empty swimmerIds", async () => {
    const user = await createTestUser("household-mine");
    try {
      const res = await request(app)
        .get("/households/mine")
        .set("Authorization", `Bearer ${user.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(user.householdId);
      expect(typeof res.body.name).toBe("string");
      expect(res.body.myRole).toBe("owner");
      expect(Array.isArray(res.body.members)).toBe(true);
      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].profileId).toBe(user.userId);
      expect(res.body.members[0].role).toBe("owner");
      expect(Array.isArray(res.body.swimmerIds)).toBe(true);
      expect(res.body.swimmerIds).toHaveLength(0);
    } finally {
      await user.cleanup();
    }
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/households/mine");
    expect(res.status).toBe(401);
  });

  it("swimmerIds includes active swimmers", async () => {
    const user = await createTestUser("household-swimmers");
    try {
      const createRes = await request(app)
        .post("/swimmers")
        .set("Authorization", `Bearer ${user.accessToken}`)
        .send({
          firstName: "Testy",
          lastName: "McTestface",
          birthDate: "2015-06-01",
          sex: "female" as const,
          isPublic: false,
          clubs: [],
        });
      expect(createRes.status).toBe(201);
      const swimmerId = createRes.body.id as string;

      const res = await request(app)
        .get("/households/mine")
        .set("Authorization", `Bearer ${user.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.swimmerIds).toContain(swimmerId);
    } finally {
      await user.cleanup();
    }
  });
});
