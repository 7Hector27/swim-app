import type { RequestHandler } from 'express';

const ROLE_ORDER = { owner: 3, manager: 2, viewer: 1 } as const;
type HouseholdRole = keyof typeof ROLE_ORDER;

export function requireHouseholdRole(minimumRole: HouseholdRole): RequestHandler {
  return (req, res, next) => {
    if (ROLE_ORDER[req.householdRole] < ROLE_ORDER[minimumRole]) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
