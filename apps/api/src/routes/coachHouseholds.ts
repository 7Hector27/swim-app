// Coach-side household-balance endpoints (ADR 036 Phase 6).
//
// Three read endpoints and one write endpoint:
//
//   GET  /coach/households/balances               — list every household
//   GET  /coach/households/:householdId/balance    — one household's balance
//   GET  /coach/households/:householdId/balance/history
//                                                  — paginated ledger history
//   POST /coach/households/:householdId/balance/adjust
//                                                  — coach-initiated adjustment
//
// All of these sit under /coach so they inherit the requireUser + requireCoach
// chain from `coachRouter`. Response shapes for the per-household endpoints
// mirror `/me/balance` + `/me/balance/history` on purpose — the parent and
// the coach see the exact same rows, so the shared schemas are the contract.
//
// Mount note: the existing `GET /coach/households` search endpoint lives in
// coachLessons.ts. These additional endpoints use suffixed paths
// (`/balances`, `/:id/balance`, `/:id/balance/history`) so there's no
// routing ambiguity between them.

import { Router } from "express";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import {
  approximatePrivateHours,
  BalanceHistoryQuerySchema,
  IdParamsSchema,
  type BalanceHistoryEntry,
  type BalanceHistoryQuery,
  type BalanceHistoryResponse,
  type BalanceResponse,
  type CoachHouseholdBalanceListResponse,
  type CoachHouseholdBalanceSummary,
  type IdParams,
} from "@swim-app/shared";

import { db } from "../db/client";
import {
  households,
  householdMembers,
  householdBalanceLedger,
  profiles,
  swimmers,
} from "../db/schema";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { getHouseholdBalance } from "../services/balance/ledger";

export const coachHouseholdsRouter = Router();

// ── GET /coach/households/balances ──────────────────────────────────────────
//
// One row per household so Jason can scan the full roster and spot low-balance
// families. Totals come from a single `SUM GROUP BY household_id` over the
// ledger — same append-only read path `getHouseholdBalance` uses, in bulk.
// Members and swimmer counts are a pair of additional cheap queries filtered
// by `inArray`. Returns name-alphabetical so the UI can apply its own sort
// (by balance ascending for low-first) without the server flipping the list
// on every request.

coachHouseholdsRouter.get(
  "/households/balances",
  validate({}),
  asyncHandler(async (_req, res) => {
    const householdRows = await db
      .select({ id: households.id, name: households.name })
      .from(households)
      .orderBy(asc(households.name));

    if (householdRows.length === 0) {
      res.json([] as CoachHouseholdBalanceListResponse);
      return;
    }
    const ids = householdRows.map((row) => row.id);

    const [memberRows, swimmerCountRows, balanceRows, lastActivityRows] =
      await Promise.all([
        // Full-name list for the UI's "who's in it" column.
        db
          .select({
            householdId: householdMembers.householdId,
            fullName: profiles.fullName,
          })
          .from(householdMembers)
          .innerJoin(profiles, eq(profiles.id, householdMembers.profileId))
          .where(inArray(householdMembers.householdId, ids)),
        // Active (non-archived) swimmers per household.
        db
          .select({
            householdId: swimmers.householdId,
            count: sql<string>`COUNT(*)`,
          })
          .from(swimmers)
          .where(
            and(
              inArray(swimmers.householdId, ids),
              sql`${swimmers.archivedAt} IS NULL`,
            ),
          )
          .groupBy(swimmers.householdId),
        // Current balance via a single grouped SUM — mirrors the one-off
        // `getHouseholdBalance` read but amortized across the roster.
        db
          .select({
            householdId: householdBalanceLedger.householdId,
            sum: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)`,
          })
          .from(householdBalanceLedger)
          .where(inArray(householdBalanceLedger.householdId, ids))
          .groupBy(householdBalanceLedger.householdId),
        // Most recent ledger createdAt per household so "last activity"
        // is the real ledger boundary, not a swimmer edit or audit row.
        // postgres-js returns MAX(timestamptz) as an ISO string, not a Date;
        // keep the string here and let the response cast to ISO downstream.
        db
          .select({
            householdId: householdBalanceLedger.householdId,
            lastAt: sql<string>`MAX(${householdBalanceLedger.createdAt})::text`,
          })
          .from(householdBalanceLedger)
          .where(inArray(householdBalanceLedger.householdId, ids))
          .groupBy(householdBalanceLedger.householdId),
      ]);

    const membersByHousehold = new Map<string, string[]>();
    for (const row of memberRows) {
      const list = membersByHousehold.get(row.householdId) ?? [];
      if (row.fullName) list.push(row.fullName);
      membersByHousehold.set(row.householdId, list);
    }
    const countsByHousehold = new Map<string, number>();
    for (const row of swimmerCountRows) {
      countsByHousehold.set(row.householdId, Number(row.count));
    }
    // Ledger rows may carry a null household_id after a Phase-8 account
    // deletion anonymizes them — those rows aren't tied to any household
    // the coach can see, so drop them from both aggregates.
    const balanceByHousehold = new Map<string, number>();
    for (const row of balanceRows) {
      if (row.householdId === null) continue;
      balanceByHousehold.set(row.householdId, Number(row.sum));
    }
    const lastActivityByHousehold = new Map<string, string>();
    for (const row of lastActivityRows) {
      if (row.householdId === null) continue;
      if (row.lastAt) lastActivityByHousehold.set(row.householdId, row.lastAt);
    }

    const results: CoachHouseholdBalanceSummary[] = householdRows.map((row) => {
      const lastAt = lastActivityByHousehold.get(row.id);
      // postgres-js returns the aggregate as a raw PG timestamp string
      // (e.g. "2024-10-30 17:05:00+00"), which isn't valid ISO for the
      // client. Round-trip through Date to normalize.
      const lastActivityAt = lastAt ? new Date(lastAt).toISOString() : null;
      return {
        householdId: row.id,
        householdName: row.name,
        memberFullNames: membersByHousehold.get(row.id) ?? [],
        activeSwimmerCount: countsByHousehold.get(row.id) ?? 0,
        balanceCents: balanceByHousehold.get(row.id) ?? 0,
        lastActivityAt,
      };
    });

    res.json(results satisfies CoachHouseholdBalanceListResponse);
  }),
);

// ── GET /coach/households/:householdId/balance ─────────────────────────────

coachHouseholdsRouter.get(
  "/households/:id/balance",
  validate({ params: IdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    // Confirm the household exists so we return 404 instead of a silent
    // `{ balanceCents: 0 }` on a typo or deleted-household id.
    const householdRows = await db
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, id))
      .limit(1);
    if (householdRows.length === 0) {
      res.status(404).json({ error: "household_not_found" });
      return;
    }
    const balanceCents = await getHouseholdBalance(id);
    const response: BalanceResponse = {
      balanceCents,
      approximatePrivateHours: approximatePrivateHours(balanceCents),
    };
    res.json(response);
  }),
);

// ── GET /coach/households/:householdId/balance/history ─────────────────────
//
// Reverse-chronological ledger view, same shape + cursor scheme as
// /me/balance/history. Centralizing the cursor helpers in a shared module
// would be premature — one more caller is fine; both implementations stay
// on the same (createdAt, id) convention so the cursor an older /me row
// produces parses correctly on either route.

const HISTORY_PAGE_SIZE = 50;

interface HistoryCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined): HistoryCursor | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<HistoryCursor>;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function displayTypeFor(row: {
  entryType: string;
  reason: string | null;
}): string {
  switch (row.entryType) {
    case "lesson_charge":
      return "Lesson";
    case "refund_to_balance":
      return "Refund";
    case "card_topup":
      return "Added credit";
    case "package_purchase":
      return "Package purchased";
    case "package_bonus":
      return "Package bonus credit";
    case "coach_adjustment":
      return row.reason ? `Jason adjusted · ${row.reason}` : "Jason adjusted";
    case "free_lesson":
      return "Free lesson";
    default:
      return row.entryType;
  }
}

coachHouseholdsRouter.get(
  "/households/:id/balance/history",
  validate({ params: IdParamsSchema, query: BalanceHistoryQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const query = req.query as unknown as BalanceHistoryQuery;
    const cursor = decodeCursor(query.cursor);

    const householdRows = await db
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, id))
      .limit(1);
    if (householdRows.length === 0) {
      res.status(404).json({ error: "household_not_found" });
      return;
    }

    const whereClauses = [eq(householdBalanceLedger.householdId, id)];
    if (cursor) {
      whereClauses.push(
        or(
          lt(householdBalanceLedger.createdAt, new Date(cursor.createdAt)),
          and(
            eq(householdBalanceLedger.createdAt, new Date(cursor.createdAt)),
            lt(householdBalanceLedger.id, cursor.id),
          ),
        )!,
      );
    }

    const rows = await db
      .select({
        id: householdBalanceLedger.id,
        entryType: householdBalanceLedger.entryType,
        amountCents: householdBalanceLedger.amountCents,
        reason: householdBalanceLedger.reason,
        createdAt: householdBalanceLedger.createdAt,
      })
      .from(householdBalanceLedger)
      .where(and(...whereClauses))
      .orderBy(desc(householdBalanceLedger.createdAt), desc(householdBalanceLedger.id))
      .limit(HISTORY_PAGE_SIZE + 1);

    const hasMore = rows.length > HISTORY_PAGE_SIZE;
    const pageRows = rows.slice(0, HISTORY_PAGE_SIZE);

    if (pageRows.length === 0) {
      const emptyResponse: BalanceHistoryResponse = { entries: [], nextCursor: null };
      res.json(emptyResponse);
      return;
    }

    // Running-balance-after-each-row: same approach as /me/balance/history.
    // Fetch SUM for everything strictly older than the earliest row on this
    // page, then walk oldest→newest adding each row's amount.
    const earliest = pageRows[pageRows.length - 1]!;
    const sumRows = await db
      .select({
        sum: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)`,
      })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, id),
          or(
            lt(householdBalanceLedger.createdAt, earliest.createdAt),
            and(
              eq(householdBalanceLedger.createdAt, earliest.createdAt),
              lt(householdBalanceLedger.id, earliest.id),
            ),
          )!,
        ),
      );
    let acc = Number(sumRows[0]?.sum ?? "0");
    const reversed = [...pageRows].reverse();
    const runningById = new Map<string, number>();
    for (const row of reversed) {
      acc += row.amountCents;
      runningById.set(row.id, acc);
    }

    const entries: BalanceHistoryEntry[] = pageRows.map((row) => ({
      id: row.id,
      entryType: row.entryType,
      amountCents: row.amountCents,
      runningBalanceCents: runningById.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
      displayType: displayTypeFor(row),
    }));
    const last = pageRows[pageRows.length - 1]!;
    const response: BalanceHistoryResponse = {
      entries,
      nextCursor: hasMore
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
    };
    res.json(response);
  }),
);

