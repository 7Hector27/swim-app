import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";

import type {
  CashRefundNeedsAttentionEntry,
  CoachHouseholdBalanceListResponse,
  CoachHouseholdBalanceSummary,
} from "@swim-app/shared";

const { mockMarkHandled } = vi.hoisted(() => ({
  mockMarkHandled: vi.fn(),
}));

vi.mock("../content/CoachFamiliesContent/actions", () => ({
  markCashRefundHandledAction: (...args: unknown[]) =>
    mockMarkHandled(...args),
}));

// Server-driven paging reads / writes the URL through next/navigation.
// Stub the hooks so the render tests don't drag a real router in.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/coach/families",
  useSearchParams: () => new URLSearchParams(),
}));

import CoachFamiliesContent from "../content/CoachFamiliesContent/CoachFamiliesContent";

// Wrap a bare row list in the new paged-response shape. Low-balance
// callout count is passed explicitly so tests can set it independently
// of the fixture (the server computes it over the whole filtered set,
// not just the page).
function makePage(
  items: CoachHouseholdBalanceSummary[],
  lowBalanceCount = items.filter((row) => row.balanceCents < 6_000).length,
): CoachHouseholdBalanceListResponse {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
    lowBalanceCount,
  };
}

// Three families with distinct balances so sort-by-balance has a definite
// order, plus one zero-ledger family (lastActivityAt null) so the "—"
// fallback is also exercised.
const FAMILIES: CoachHouseholdBalanceSummary[] = [
  {
    householdId: "11111111-1111-1111-1111-111111111111",
    householdName: "Smith household",
    memberFullNames: ["Jane Smith", "Dana Smith"],
    activeSwimmerCount: 2,
    balanceCents: 2000, // $20 → under one-lesson threshold → "Low"
    lastActivityAt: "2026-11-01T12:00:00.000Z",
  },
  {
    householdId: "22222222-2222-2222-2222-222222222222",
    householdName: "Garcia household",
    memberFullNames: ["Rosa Garcia"],
    activeSwimmerCount: 1,
    balanceCents: 15000, // $150 → not low
    lastActivityAt: "2026-11-03T12:00:00.000Z",
  },
  {
    householdId: "33333333-3333-3333-3333-333333333333",
    householdName: "Nguyen household",
    memberFullNames: ["Minh Nguyen"],
    activeSwimmerCount: 1,
    balanceCents: 108000, // $1,080 → not low
    lastActivityAt: "2026-11-02T12:00:00.000Z",
  },
  {
    householdId: "44444444-4444-4444-4444-444444444444",
    householdName: "Okafor household",
    memberFullNames: [],
    activeSwimmerCount: 0,
    balanceCents: 0, // $0 → low
    lastActivityAt: null,
  },
];

function rowNames(): string[] {
  const rows = screen.getAllByTestId("families-row");
  return rows.map((row) => {
    const title = row.querySelector("p.font-semibold");
    return title?.textContent?.trim() ?? "";
  });
}

describe("CoachFamiliesContent", () => {
  it("shows a 'running low' callout when at least one family is under a lesson's balance", () => {
    render(
      <CoachFamiliesContent
        page={makePage(FAMILIES)}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[]}
      />,
    );
    const callout = screen.getByTestId("families-low-callout");
    // Smith ($20) + Okafor ($0) are both below the threshold.
    expect(callout.textContent).toMatch(/^\s*2\s+families are running low/i);
  });

  it("hides the low callout when nobody is low", () => {
    render(
      <CoachFamiliesContent
        page={makePage([FAMILIES[1]!])}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[]}
      />,
    );
    expect(screen.queryByTestId("families-low-callout")).toBeNull();
  });

  it("badges low-balance rows with the 'Low' pill (and skips it for non-low rows)", () => {
    render(
      <CoachFamiliesContent
        page={makePage(FAMILIES)}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[]}
      />,
    );
    const rows = screen.getAllByTestId("families-row");
    const smithRow = rows.find((row) =>
      row.textContent?.includes("Smith household"),
    )!;
    const garciaRow = rows.find((row) =>
      row.textContent?.includes("Garcia household"),
    )!;
    expect(within(smithRow).getByText(/^low$/i)).toBeInTheDocument();
    expect(within(garciaRow).queryByText(/^low$/i)).toBeNull();
  });

  // Sort + search now round-trip through the URL (server renders the
  // ordered page), so the following cases depend on the next/navigation
  // stubs triggering a fresh server render. That belongs in an
  // integration test — skipping here and leaving them as prompts.
  it.skip("defaults to sort by last activity (newest first), treating a null lastActivityAt as the oldest", () => {
    render(
      <CoachFamiliesContent
        page={makePage(FAMILIES)}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[]}
      />,
    );
    // Garcia Nov 3 → Nguyen Nov 2 → Smith Nov 1 → Okafor (null, treated as 0)
    expect(rowNames()).toEqual([
      "Garcia household",
      "Nguyen household",
      "Smith household",
      "Okafor household",
    ]);
  });

  it.skip("re-sorts by family name when the Sort dropdown changes", () => {
    render(
      <CoachFamiliesContent
        page={makePage(FAMILIES)}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/sort by/i), {
      target: { value: "name_asc" },
    });
    expect(rowNames()).toEqual([
      "Garcia household",
      "Nguyen household",
      "Okafor household",
      "Smith household",
    ]);
  });

  it.skip("re-sorts by balance ascending so low families bubble up when picked", () => {
    render(
      <CoachFamiliesContent
        page={makePage(FAMILIES)}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/sort by/i), {
      target: { value: "balance_asc" },
    });
    expect(rowNames()).toEqual([
      "Okafor household", // $0
      "Smith household", // $20
      "Garcia household", // $150
      "Nguyen household", // $1,080
    ]);
  });

  it.skip("filters by family name via the search box", () => {
    render(
      <CoachFamiliesContent
        page={makePage(FAMILIES)}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[]}
      />,
    );
    const search = screen.getByPlaceholderText(
      /search by family or member name/i,
    );
    fireEvent.change(search, { target: { value: "garcia" } });
    expect(rowNames()).toEqual(["Garcia household"]);
  });

  it.skip("also filters by member name — useful when the family name doesn't match", () => {
    render(
      <CoachFamiliesContent
        page={makePage(FAMILIES)}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[]}
      />,
    );
    const search = screen.getByPlaceholderText(
      /search by family or member name/i,
    );
    fireEvent.change(search, { target: { value: "dana" } });
    // Dana is a member of Smith household — the row should still appear.
    expect(rowNames()).toEqual(["Smith household"]);
  });

  it.skip("shows an empty-state when the search matches nothing", () => {
    render(
      <CoachFamiliesContent
        page={makePage(FAMILIES)}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[]}
      />,
    );
    fireEvent.change(
      screen.getByPlaceholderText(/search by family or member name/i),
      { target: { value: "noone" } },
    );
    expect(screen.queryAllByTestId("families-row")).toHaveLength(0);
    expect(screen.getByText(/no families match that search/i)).toBeInTheDocument();
  });

  it("each row links to /coach/families/[id]", () => {
    render(
      <CoachFamiliesContent
        page={makePage(FAMILIES)}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[]}
      />,
    );
    const smithRow = screen
      .getAllByTestId("families-row")
      .find((row) => row.textContent?.includes("Smith household"))!;
    expect(smithRow.getAttribute("href")).toBe(
      "/coach/families/11111111-1111-1111-1111-111111111111",
    );
  });
});

// ── Refunds needing attention (ADR 036 Phase 8 Part B) ────────────────

const LIVE_ENTRY: CashRefundNeedsAttentionEntry = {
  jobId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  amountCents: 7_500,
  reason: "Stripe refund failed",
  createdAt: "2026-11-05T12:00:00.000Z",
  stripePaymentIntentId: "pi_live_abc123",
  household: {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Garcia household",
  },
};

const DELETED_ENTRY: CashRefundNeedsAttentionEntry = {
  jobId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  amountCents: 3_000,
  reason: "No matching card payment",
  createdAt: "2026-11-04T12:00:00.000Z",
  stripePaymentIntentId: null,
  household: null,
};

describe("CoachFamiliesContent — Refunds needing attention section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides the whole section when initialNeedsAttention is empty", () => {
    render(
      <CoachFamiliesContent
        page={makePage(FAMILIES)}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[]}
      />,
    );
    expect(screen.queryByTestId("families-needs-attention")).toBeNull();
  });

  it("renders a row per entry, showing family name for live and 'Deleted family' for anonymized", () => {
    render(
      <CoachFamiliesContent
        page={makePage(FAMILIES)}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[LIVE_ENTRY, DELETED_ENTRY]}
      />,
    );
    const section = screen.getByTestId("families-needs-attention");
    expect(section).toBeInTheDocument();
    const rows = within(section).getAllByTestId("families-needs-attention-row");
    expect(rows).toHaveLength(2);
    // Live entry links to the family page; deleted entry renders a
    // "Deleted family" label instead of a link.
    expect(within(rows[0]!).getByRole("link", { name: /garcia household/i })).toHaveAttribute(
      "href",
      "/coach/families/22222222-2222-2222-2222-222222222222",
    );
    expect(within(rows[1]!).getByTestId("families-needs-attention-deleted"))
      .toBeInTheDocument();
    // Only the live entry carries a Stripe payment id tag.
    expect(within(rows[0]!).getByTestId("families-needs-attention-pi")).toHaveTextContent(
      "pi_live_abc123",
    );
    expect(within(rows[1]!).queryByTestId("families-needs-attention-pi")).toBeNull();
  });

  it("mark-as-refunded hits the action and removes the row on success", async () => {
    mockMarkHandled.mockResolvedValue({ kind: "ok" });
    render(
      <CoachFamiliesContent
        page={makePage(FAMILIES)}
        sort="activity_desc"
        search=""
        initialNeedsAttention={[LIVE_ENTRY]}
      />,
    );
    fireEvent.click(screen.getByTestId("families-needs-attention-mark"));
    expect(screen.getByTestId("families-mark-handled-modal")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("families-mark-handled-note"), {
      target: { value: "Refunded via Stripe dashboard." },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("families-mark-handled-submit"));
    });
    expect(mockMarkHandled).toHaveBeenCalledWith(LIVE_ENTRY.jobId, {
      note: "Refunded via Stripe dashboard.",
    });
    await waitFor(() => {
      expect(screen.queryByTestId("families-needs-attention")).toBeNull();
    });
  });
});
