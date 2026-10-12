import type { RequestHandler } from "express";
import { HOUSEHOLD_ROLE_RANK, type HouseholdRole } from "@swim-app/shared";

export function requireHouseholdRole(minimumRole: HouseholdRole): RequestHandler {
  return (req, res, next) => {
    const role = req.householdRole as HouseholdRole | undefined;
    if (role === undefined) {
      next(new Error("requireHouseholdRole called without requireHouseholdMember"));
      return;
    }
    if (HOUSEHOLD_ROLE_RANK[role] < HOUSEHOLD_ROLE_RANK[minimumRole]) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
