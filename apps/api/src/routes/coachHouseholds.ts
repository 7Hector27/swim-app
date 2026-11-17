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
import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  approximatePrivateHours,
  balanceDisplayType,
  BalanceHistoryQuerySchema,
  CashOutBreakdownSchema,
  CashOutResponseSchema,
  CoachAdjustBalanceBodySchema,
  CoachFamiliesPageQuerySchema,
  COACH_FAMILIES_PAGE_SIZE,
  IdParamsSchema,
  type BalanceHistoryEntry,
  type BalanceHistoryQuery,
  type BalanceHistoryResponse,
  type BalanceResponse,
  type CashOutBreakdown,
  type CashOutResponse,
  type CoachAdjustBalanceBody,
  type CoachAdjustBalanceResponse,
  type CoachFamiliesPageQuery,
  type CoachHouseholdBalanceListResponse,
  type CoachHouseholdBalanceSummary,
  type CoachHouseholdBalanceSummaryResponse,
  type IdParams,
  type NeedsManualRefundJob,
  type NeedsManualRefundListResponse,
} from "@swim-app/shared";

import { db } from "../db/client";
import {
  cashRefundJobs,
  households,
  householdMembers,
  householdBalanceLedger,
  profiles,
  swimmers,
} from "../db/schema";
import { getEnv } from "../lib/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import {
  applyLedgerEntry,
  executeCashOut,
  getCashOutBreakdown,
  getHouseholdBalance,
  kickCashRefundDrain,
  reasonForBanner,
  withBalanceLock,
} from "../services/balance";
import { enqueueBalanceAdjustedEmail } from "../services/emails/balanceAdjustedOutbox";
import { sendLessonEmailOutboxRow } from "../services/emails/sender";

export const coachHouseholdsRouter = Router();

// ── GET /coach/households/balances ──────────────────────────────────────────
//
// Paged roster: 20 households per page, with server-side search + sort.
// `search` is a case-insensitive substring match against household name
// OR any member's full name. `sort` picks between balance-asc, name-asc,
// and last-activity-desc. Response carries `items` plus pagination
// metadata and `lowBalanceCount` (families under one lesson's price,
// scoped to the same search) so the UI can render the top-of-page
// callouts without a second roundtrip.
//
// Everything runs in one REPEATABLE READ read-only transaction so the
// roster, aggregates, and the low-balance count see the same snapshot;
// without this a concurrent cash-out could skew the count relative to
// the rows on screen.

// $60 — one 30-min 1-swimmer lesson. Shared with the UI callout threshold.
const LOW_BALANCE_THRESHOLD_CENTS = 6_000;

// Build the per-household balance + last-activity aggregates joined
// to the roster. Same ledger-sum path that powers `getHouseholdBalance`,
// in bulk. A LEFT JOIN keeps households with zero ledger rows in the
// result (balance = 0, last activity = null). Takes the optional search
// filter so the summary count and the paged select share one source of
// truth — without this the UI's pager / low-balance callout drifted
// away from the items array whenever a search was active.
function buildRosterQuery(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  whereCondition?: SQL<unknown> | undefined,
) {
  const base = tx
    .select({
      id: households.id,
      name: households.name,
      balanceCents: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)`.as(
        "balance_cents",
      ),
      lastAt: sql<string | null>`MAX(${householdBalanceLedger.createdAt})::text`.as(
        "last_at",
      ),
    })
    .from(households)
    .leftJoin(
      householdBalanceLedger,
      eq(householdBalanceLedger.householdId, households.id),
    );
  const filtered = whereCondition !== undefined ? base.where(whereCondition) : base;
  return filtered.groupBy(households.id, households.name);
}

coachHouseholdsRouter.get(
  "/households/balances",
  validate({ query: CoachFamiliesPageQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as CoachFamiliesPageQuery;
    const page = query.page;
    const sort = query.sort;
    const search = query.search;

    // Search filter: name OR any member's full name (ILIKE). The EXISTS
    // subquery keeps the main household row set deduped — joining
    // household_members directly would multiply rows.
    const searchPattern = search ? `%${search}%` : null;
    const searchFilter =
      searchPattern === null
        ? undefined
        : or(
            ilike(households.name, searchPattern),
            exists(
              db
                .select({ one: sql`1` })
                .from(householdMembers)
                .innerJoin(profiles, eq(profiles.id, householdMembers.profileId))
                .where(
                  and(
                    eq(householdMembers.householdId, households.id),
                    ilike(profiles.fullName, searchPattern),
                  ),
                ),
            ),
          );

    const { rosterRows, totalCount, lowBalanceCount, pagedRows, memberRows, swimmerCountRows } =
      await db.transaction(
        async (tx) => {
          const whereCondition = searchFilter;
          const base = buildRosterQuery(tx, whereCondition).as("roster");

          // Count + low-balance tally in a single pass. The subquery is
          // already filtered inside buildRosterQuery, so total and
          // lowBalanceCount reflect the same set that the paged select
          // below returns in items.
          const summary = await tx
            .select({
              total: sql<string>`COUNT(*)`,
              lowCount: sql<string>`COUNT(*) FILTER (WHERE ${base.balanceCents}::bigint < ${LOW_BALANCE_THRESHOLD_CENTS})`,
            })
            .from(base);
          const totalCount = Number(summary[0]?.total ?? 0);
          const lowBalanceCount = Number(summary[0]?.lowCount ?? 0);

          if (totalCount === 0) {
            return {
              rosterRows: [],
              totalCount,
              lowBalanceCount,
              pagedRows: [],
              memberRows: [],
              swimmerCountRows: [],
            };
          }

          // Page selection: same aggregate shape, with the chosen sort.
          // Sort order maps to the three UI dropdown values.
          const sortClause =
            sort === "balance_asc"
              ? [asc(sql`balance_cents`), asc(sql`name`)]
              : sort === "name_asc"
                ? [asc(sql`name`)]
                : // activity_desc — nulls last so brand-new households
                  // (no ledger rows yet) don't float to the top of the
                  // "most recently active" list.
                  [sql`last_at DESC NULLS LAST`, asc(sql`name`)];

          const offset = (page - 1) * COACH_FAMILIES_PAGE_SIZE;

          // Re-declare the roster CTE with the same filter so the page
          // slice matches the count. Using a CTE lets us apply both the
          // search WHERE and the ORDER BY over the same derived columns.
          const pagedRowsRaw = await tx
            .select({
              id: households.id,
              name: households.name,
              balanceCents: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)`.as(
                "balance_cents",
              ),
              lastAt: sql<string | null>`MAX(${householdBalanceLedger.createdAt})::text`.as(
                "last_at",
              ),
            })
            .from(households)
            .leftJoin(
              householdBalanceLedger,
              eq(householdBalanceLedger.householdId, households.id),
            )
            .where(whereCondition)
            .groupBy(households.id, households.name)
            .orderBy(...sortClause)
            .limit(COACH_FAMILIES_PAGE_SIZE)
            .offset(offset);

          if (pagedRowsRaw.length === 0) {
            return {
              rosterRows: [],
              totalCount,
              lowBalanceCount,
              pagedRows: [],
              memberRows: [],
              swimmerCountRows: [],
            };
          }

          const pageIds = pagedRowsRaw.map((row) => row.id);
          const [memberRows, swimmerCountRows] = await Promise.all([
            tx
              .select({
                householdId: householdMembers.householdId,
                fullName: profiles.fullName,
              })
              .from(householdMembers)
              .innerJoin(profiles, eq(profiles.id, householdMembers.profileId))
              .where(inArray(householdMembers.householdId, pageIds)),
            tx
              .select({
                householdId: swimmers.householdId,
                count: sql<string>`COUNT(*)`,
              })
              .from(swimmers)
              .where(
                and(
                  inArray(swimmers.householdId, pageIds),
                  sql`${swimmers.archivedAt} IS NULL`,
                ),
              )
              .groupBy(swimmers.householdId),
          ]);

          return {
            rosterRows: pagedRowsRaw,
            totalCount,
            lowBalanceCount,
            pagedRows: pagedRowsRaw,
            memberRows,
            swimmerCountRows,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );

    void rosterRows;

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

    const items: CoachHouseholdBalanceSummary[] = pagedRows.map((row) => {
      const lastActivityAt = row.lastAt ? new Date(row.lastAt).toISOString() : null;
      return {
        householdId: row.id,
        householdName: row.name,
        memberFullNames: membersByHousehold.get(row.id) ?? [],
        activeSwimmerCount: countsByHousehold.get(row.id) ?? 0,
        balanceCents: Number(row.balanceCents),
        lastActivityAt,
      };
    });

    const response: CoachHouseholdBalanceListResponse = {
      items,
      page,
      pageSize: COACH_FAMILIES_PAGE_SIZE,
      total: totalCount,
      lowBalanceCount,
    };
    res.json(response);
  }),
);

// ── GET /coach/households/:householdId/summary ─────────────────────────────
//
// Single-household summary, same shape as a row from the paged list.
// Detail-page server component reads household name + members + swimmer
// count from here now that the roster list is paged (the detail page
// can't assume a given id is on page 1 any more).

coachHouseholdsRouter.get(
  "/households/:id/summary",
  validate({ params: IdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const { householdRow, memberRows, swimmerCountRows, balanceSumRow, lastActivityRow } =
      await db.transaction(
        async (tx) => {
          const householdRows = await tx
            .select({ id: households.id, name: households.name })
            .from(households)
            .where(eq(households.id, id))
            .limit(1);
          const householdRow = householdRows[0] ?? null;
          if (!householdRow) {
            return {
              householdRow: null,
              memberRows: [],
              swimmerCountRows: [],
              balanceSumRow: null,
              lastActivityRow: null,
            };
          }
          const [memberRows, swimmerCountRows, balanceSumRows, lastActivityRows] =
            await Promise.all([
              tx
                .select({
                  householdId: householdMembers.householdId,
                  fullName: profiles.fullName,
                })
                .from(householdMembers)
                .innerJoin(profiles, eq(profiles.id, householdMembers.profileId))
                .where(eq(householdMembers.householdId, id)),
              tx
                .select({
                  householdId: swimmers.householdId,
                  count: sql<string>`COUNT(*)`,
                })
                .from(swimmers)
                .where(
                  and(
                    eq(swimmers.householdId, id),
                    sql`${swimmers.archivedAt} IS NULL`,
                  ),
                )
                .groupBy(swimmers.householdId),
              tx
                .select({
                  sum: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)`,
                })
                .from(householdBalanceLedger)
                .where(eq(householdBalanceLedger.householdId, id)),
              tx
                .select({
                  lastAt: sql<string | null>`MAX(${householdBalanceLedger.createdAt})::text`,
                })
                .from(householdBalanceLedger)
                .where(eq(householdBalanceLedger.householdId, id)),
            ]);
          return {
            householdRow,
            memberRows,
            swimmerCountRows,
            balanceSumRow: balanceSumRows[0] ?? null,
            lastActivityRow: lastActivityRows[0] ?? null,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );

    if (householdRow === null) {
      res.status(404).json({ error: "household_not_found" });
      return;
    }

    const memberFullNames = memberRows
      .map((row) => row.fullName)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    const activeSwimmerCount = Number(swimmerCountRows[0]?.count ?? 0);
    const balanceCents = Number(balanceSumRow?.sum ?? 0);
    const lastActivityAt = lastActivityRow?.lastAt
      ? new Date(lastActivityRow.lastAt).toISOString()
      : null;

    const response: CoachHouseholdBalanceSummaryResponse = {
      householdId: householdRow.id,
      householdName: householdRow.name,
      memberFullNames,
      activeSwimmerCount,
      balanceCents,
      lastActivityAt,
    };
    res.json(response);
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

const HISTORY_PAGE_SIZE = 10;

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
      displayType: balanceDisplayType(row),
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

// ── POST /coach/households/:householdId/balance/adjust ──────────────────────
//
// Coach-initiated adjustment. Signed `amountCents` + required `reason`. A
// negative amount that would drop the running balance below zero is rejected
// with 422 insufficient_balance; the write + its audit row land in the same
// transaction via `applyLedgerEntry` inside `withBalanceLock`, so the
// read-check-write cycle is atomic per CLAUDE.md's audit-log rule and ADR
// 036 §1.
//
// Phase 7 will wire the balance_adjusted email outbox row. The ledger
// service already writes `balance_coach_adjusted` into
// `household_audit_log` in the same transaction, so the outbox dispatcher
// can key off that audit action — no email-specific hook lives here yet.

coachHouseholdsRouter.post(
  "/households/:id/balance/adjust",
  validate({ params: IdParamsSchema, body: CoachAdjustBalanceBodySchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const body = req.body as CoachAdjustBalanceBody;

    const householdRows = await db
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, id))
      .limit(1);
    if (householdRows.length === 0) {
      res.status(404).json({ error: "household_not_found" });
      return;
    }

    const siteUrl = getEnv().siteUrl;
    const trimmedReason = body.reason.trim();
    const result = await withBalanceLock(id, async (tx) => {
      const currentBalance = await getHouseholdBalance(id, tx);
      const nextBalance = currentBalance + body.amountCents;
      if (nextBalance < 0) {
        return {
          kind: "insufficient_balance" as const,
          balanceCents: currentBalance,
          // For a negative amount, "price" is the absolute magnitude we
          // can't cover — reuses the parent-side 422 shape so UI mapping
          // (readInsufficientBalanceBody) stays uniform.
          priceCents: -body.amountCents,
          shortfallCents: -body.amountCents - currentBalance,
        };
      }
      const ledgerId = await applyLedgerEntry(tx, {
        entryType: "coach_adjustment",
        householdId: id,
        actorId: req.profile.id,
        amountCents: body.amountCents,
        reason: trimmedReason,
      });
      // ADR 036 Phase 7: enqueue the family-facing email in the same
      // transaction. The adjust modal warns Jason the family sees this
      // reason — the payload stores it verbatim.
      const outboxId = await enqueueBalanceAdjustedEmail(tx, {
        householdId: id,
        amountCents: body.amountCents,
        newBalanceCents: nextBalance,
        reason: trimmedReason,
        siteUrl,
      });
      return {
        kind: "ok" as const,
        ledgerId,
        balanceCents: nextBalance,
        outboxId,
      };
    });

    if (result.kind === "insufficient_balance") {
      req.log.warn(
        {
          event: "insufficient_balance",
          route: "POST /coach/households/:id/balance/adjust",
          householdId: id,
          balanceCents: result.balanceCents,
          priceCents: result.priceCents,
          shortfallCents: result.shortfallCents,
        },
        "coach adjustment rejected: would take balance below zero",
      );
      res.status(422).json({
        error: "insufficient_balance",
        balanceCents: result.balanceCents,
        priceCents: result.priceCents,
        shortfallCents: result.shortfallCents,
      });
      return;
    }

    const response: CoachAdjustBalanceResponse = {
      balanceCents: result.balanceCents,
      ledgerId: result.ledgerId,
    };
    res.status(201).json(response);
    // Post-commit microtask — the transaction is already committed by
    // the time this fires. A rollback would've thrown above and we never
    // reach here, so the outbox row either exists or the `outboxId` is
    // null (edge case: no household members to email).
    if (result.outboxId !== null) {
      queueMicrotask(() => {
        void sendLessonEmailOutboxRow(result.outboxId!);
      });
    }
  }),
);

// ── GET /coach/households/:householdId/balance/cash-out/preview ────────────
//
// Returns the breakdown Jason sees before clicking "Refund leftover balance"
// on the family detail page (ADR 036 Phase 8 Part B Stop 2). Pure read; no
// ledger writes. The same breakdown runs again inside executeCashOut's
// transaction so the preview is advisory — a concurrent coach adjustment
// between preview and confirm is resolved by the write-side balance lock.

coachHouseholdsRouter.get(
  "/households/:id/balance/cash-out/preview",
  validate({ params: IdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const householdRows = await db
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, id))
      .limit(1);
    if (householdRows.length === 0) {
      res.status(404).json({ error: "household_not_found" });
      return;
    }
    const breakdown: CashOutBreakdown = await getCashOutBreakdown(id);
    // Shape confirmation — the schema is the contract with the UI.
    res.json(CashOutBreakdownSchema.parse(breakdown));
  }),
);

// ── POST /coach/households/:householdId/balance/cash-out ────────────────────
//
// Writes the cash_refund + balance_writeoff ledger rows and their drain
// jobs inside one transaction, then kicks the post-commit drain. Also
// enqueues the parent `balance_cashed_out` email (ADR 036 Phase 7). The
// deletion-path variant (`skipEmail: true`) is NOT used here — a coach-
// initiated cash-out always notifies the family.

coachHouseholdsRouter.post(
  "/households/:id/balance/cash-out",
  validate({ params: IdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const householdRows = await db
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, id))
      .limit(1);
    if (householdRows.length === 0) {
      res.status(404).json({ error: "household_not_found" });
      return;
    }

    const result = await executeCashOut({
      householdId: id,
      actorId: req.profile.id,
    });

    const response: CashOutResponse = {
      breakdown: result.breakdown,
      refundJobCount: result.cashRefundJobIds.length,
      needsManualHandlingCents: result.needsManualHandlingCents,
    };
    res.status(200).json(CashOutResponseSchema.parse(response));

    // Post-commit kick — the drain claims the just-written jobs and
    // calls Stripe immediately. Passing the id list bypasses the
    // 2-minute cron-tick lead window on next_attempt_at so refunds
    // don't wait for the next tick. Residual needs-manual-handling
    // jobs are excluded from drainEligibleJobIds (no payment intent
    // to refund against).
    if (result.drainEligibleJobIds.length > 0) {
      kickCashRefundDrain(req.log, result.drainEligibleJobIds);
    }
    // Family receipt — queue the outbox send so the HTTP response
    // returns promptly. Null outboxId is the "no recipients" edge case.
    if (result.emailOutboxId !== null) {
      const emailOutboxId = result.emailOutboxId;
      queueMicrotask(() => {
        void sendLessonEmailOutboxRow(emailOutboxId);
      });
    }
  }),
);

// ── GET /coach/households/:householdId/needs-manual-refund ─────────────────
//
// Returns the pending needs-manual-handling cash-refund jobs the coach
// family-page banner surfaces. Reason strings are mapped through
// `reasonForBanner` so the UI never sees Stripe internals.

coachHouseholdsRouter.get(
  "/households/:id/needs-manual-refund",
  validate({ params: IdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const householdRows = await db
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, id))
      .limit(1);
    if (householdRows.length === 0) {
      res.status(404).json({ error: "household_not_found" });
      return;
    }

    const jobRows = await db
      .select({
        id: cashRefundJobs.id,
        amountCents: cashRefundJobs.amountCents,
        needsManualReason: cashRefundJobs.needsManualReason,
        createdAt: cashRefundJobs.createdAt,
      })
      .from(cashRefundJobs)
      .where(
        and(
          eq(cashRefundJobs.householdId, id),
          eq(cashRefundJobs.status, "needs_manual_handling"),
        ),
      )
      .orderBy(desc(cashRefundJobs.createdAt));

    const jobs: NeedsManualRefundJob[] = jobRows.map((row) => ({
      id: row.id,
      amountCents: row.amountCents,
      reason: reasonForBanner(row.needsManualReason),
      createdAt: row.createdAt.toISOString(),
    }));
    const response: NeedsManualRefundListResponse = { jobs };
    res.json(response);
  }),
);
