// Payments routes (ADR 036 Phase 3 + 5).
//
// POST /payments/checkout-session — creates a Stripe-hosted Checkout session
// and returns the URL the client redirects to. The body carries only pricing
// inputs (`kind` + the discriminated union); the amount is computed
// server-side from the shared pricing module and the authenticated user's
// household id is read from the session, never the body.
//
// GET /me/balance — authoritative household balance in integer cents plus
// an approximate private-hours derivation from the pricing module. Phase 5.
//
// GET /me/balance/history — reverse-chronological ledger entries for the
// caller's household with plain-language labels + running balance per row.
// Paginated at HISTORY_PAGE_SIZE rows via an opaque cursor. Phase 5.
//
// The webhook route lives in app.ts rather than this router so it can be
// wired before `express.json()` with its own raw-body middleware.

import { Router } from "express";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";

import {
  approximatePrivateHours,
  balanceDisplayType,
  BalanceHistoryQuerySchema,
  CheckoutSessionBodySchema,
  type BalanceHistoryEntry,
  type BalanceHistoryQuery,
  type BalanceHistoryResponse,
  type BalanceResponse,
  type CheckoutSessionBody,
  type CheckoutSessionResponse,
} from "@swim-app/shared";

import { db } from "../db/client";
import { householdBalanceLedger } from "../db/schema";
import { getEnv } from "../lib/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireCurrentPolicyAcceptance } from "../middleware/requireCurrentPolicyAcceptance";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireParent } from "../middleware/requireParent";
import { requireUser } from "../middleware/requireUser";
import { validate } from "../middleware/validate";
import { getHouseholdBalance } from "../services/balance";
import { createCheckoutSession } from "../services/stripe";

export const paymentsRouter = Router();
export const balanceRouter = Router();

paymentsRouter.post(
  "/checkout-session",
  requireUser,
  requireParent,
  requireHouseholdMember,
  // ADR 036 Phase 8 Part B Stop 3 piece 3: both top-ups and packages
  // ride this one route. Gated so a parent with a stale policy
  // acceptance can't fund their balance before re-accepting.
  requireCurrentPolicyAcceptance,
  validate({ body: CheckoutSessionBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as CheckoutSessionBody;

    const result = await createCheckoutSession({
      householdId: req.householdId,
      actorId: req.profile.id,
      siteUrl: getEnv().siteUrl,
      body,
    });

    const response: CheckoutSessionResponse = {
      url: result.url,
      sessionId: result.sessionId,
    };
    res.status(201).json(response);
  }),
);

// ── GET /me/balance (Phase 5) ────────────────────────────────────────────────

balanceRouter.get(
  "/me/balance",
  requireUser,
  requireParent,
  requireHouseholdMember,
  validate({}),
  asyncHandler(async (req, res) => {
    const balanceCents = await getHouseholdBalance(req.householdId);
    const response: BalanceResponse = {
      balanceCents,
      approximatePrivateHours: approximatePrivateHours(balanceCents),
    };
    res.json(response);
  }),
);

// ── GET /me/balance/history (Phase 5) ────────────────────────────────────────
//
// Reverse-chronological ledger entries for the caller's household. Each row
// carries a plain-language `displayType` ("Lesson", "Refund", "Added
// credit", "Package: Cannonball (2 swimmers)", "Jason adjusted") and the
// running balance after the row, so the client renders a one-row-one-number
// table without re-summing on every render. Pagination is cursor-based —
// the server encodes (created_at, id) so a deterministic order survives
// identical-timestamp rows that an atomic package purchase might emit.

// 20 rows per page matches the "Load more" affordance in the balance
// history UI — enough to see a few weeks of activity at a glance
// without pushing the lesson-booking context off the screen on a
// phone. The running balance stays correct across pages because the
// server anchors the per-page sum to the ledger's temporal boundary,
// not the cursor position (see assemble loop below).
const HISTORY_PAGE_SIZE = 20;

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

balanceRouter.get(
  "/me/balance/history",
  requireUser,
  requireParent,
  requireHouseholdMember,
  validate({ query: BalanceHistoryQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as BalanceHistoryQuery;
    const cursor = decodeCursor(query.cursor);

    // Fetch one row beyond the page size so we know whether to issue a
    // next cursor. The partial `(household_id, created_at DESC)` index
    // (migration 0076) covers this read.
    const whereClauses = [eq(householdBalanceLedger.householdId, req.householdId)];
    if (cursor) {
      // Strict lex-less than on (created_at DESC, id DESC) — rows "older"
      // than the cursor's position. Composite cursor keeps pagination
      // deterministic under identical createdAt values.
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

    // Compute running balance per row. We can't do this per-page with just
    // the page's rows — "running balance AFTER row N" needs the sum of
    // everything up to and including row N (DESC order means row N
    // includes everything older too). So: fetch SUM(amount_cents) WHERE
    // created_at <= pageRows[last].createdAt, then subtract each row's
    // own impact as we walk the page.
    //
    // For a household with hundreds of entries per year this is a
    // sub-millisecond SUM — the same shape getHouseholdBalance uses.
    if (pageRows.length > 0) {
      const earliest = pageRows[pageRows.length - 1]!;
      const sumRows = await db
        .select({
          sum: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)`,
        })
        .from(householdBalanceLedger)
        .where(
          and(
            eq(householdBalanceLedger.householdId, req.householdId),
            or(
              lt(householdBalanceLedger.createdAt, earliest.createdAt),
              and(
                eq(householdBalanceLedger.createdAt, earliest.createdAt),
                lt(householdBalanceLedger.id, earliest.id),
              ),
            )!,
          ),
        );
      // Start at the balance up to but not including the earliest row on
      // this page; we'll add each row's amount as we walk backwards.
      let acc = Number(sumRows[0]?.sum ?? "0");
      // Walk oldest → newest, assigning the running-balance *after* each
      // row.
      const reversed = [...pageRows].reverse();
      const walk = reversed.map((row) => {
        acc += row.amountCents;
        return { id: row.id, running: acc };
      });
      // Flip back to newest-first and pick the running balance per row.
      const runningById = new Map(walk.map((entry) => [entry.id, entry.running]));
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
      return;
    }

    const emptyResponse: BalanceHistoryResponse = { entries: [], nextCursor: null };
    res.json(emptyResponse);
  }),
);
