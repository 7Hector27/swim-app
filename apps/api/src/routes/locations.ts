import { Router } from "express";
import { and, eq, isNull, or } from "drizzle-orm";
import type { LessonLocation, SetHomePoolBody } from "@swim-app/shared";
import { SetHomePoolBodySchema } from "@swim-app/shared";
import { db } from "../db/client";
import { lessonLocations } from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireHouseholdRole } from "../middleware/requireHouseholdRole";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";

export const locationsRouter = Router();

locationsRouter.use(requireUser, requireParent, requireHouseholdMember);

// GET /locations — named pools + caller's home pool
locationsRouter.get(
  "/",
  validate({}),
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(lessonLocations)
      .where(
        and(
          eq(lessonLocations.isActive, true),
          or(
            isNull(lessonLocations.householdId),
            eq(lessonLocations.householdId, req.householdId),
          ),
        ),
      )
      .orderBy(lessonLocations.sortOrder);

    const body: LessonLocation[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      city: row.city,
      state: row.state,
      zip: row.zip,
      isHomePool: row.householdId !== null,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    }));

    res.json(body);
  }),
);

// PUT /households/mine/home-pool — create or replace home pool (mounted via householdsRouter)
export function registerHomePoolRoutes(router: Router): void {
  router.put(
    "/mine/home-pool",
    requireUser,
    requireParent,
    requireHouseholdMember,
    requireHouseholdRole("owner"),
    validate({ body: SetHomePoolBodySchema }),
    asyncHandler(async (req, res) => {
      const body = req.body as SetHomePoolBody;
      const { householdId } = req;

      const { newLocation, replaced } = await db.transaction(async (tx) => {
        const deactivated = await tx
          .update(lessonLocations)
          .set({ isActive: false })
          .where(
            and(
              eq(lessonLocations.householdId, householdId),
              eq(lessonLocations.isActive, true),
            ),
          )
          .returning({ id: lessonLocations.id });

        const rows = await tx
          .insert(lessonLocations)
          .values({
            name: "Home pool",
            address: body.address,
            city: body.city,
            state: body.state,
            zip: body.zip,
            householdId,
            isActive: true,
            sortOrder: 99,
          })
          .returning();

        return { newLocation: rows[0]!, replaced: deactivated.length > 0 };
      });

      const responseBody: LessonLocation = {
        id: newLocation.id,
        name: newLocation.name,
        address: newLocation.address,
        city: newLocation.city,
        state: newLocation.state,
        zip: newLocation.zip,
        isHomePool: true,
        isActive: true,
        sortOrder: newLocation.sortOrder,
      };

      res.status(replaced ? 200 : 201).json(responseBody);
    }),
  );

  router.delete(
    "/mine/home-pool",
    requireUser,
    requireParent,
    requireHouseholdMember,
    requireHouseholdRole("owner"),
    validate({}),
    asyncHandler(async (req, res) => {
      const { householdId } = req;

      await db
        .update(lessonLocations)
        .set({ isActive: false })
        .where(
          and(
            eq(lessonLocations.householdId, householdId),
            eq(lessonLocations.isActive, true),
          ),
        );

      res.status(204).end();
    }),
  );
}
