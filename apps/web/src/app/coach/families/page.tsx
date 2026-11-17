import type { Metadata } from "next";

import { COACH_FAMILIES_SORT_KEYS, type CoachFamiliesSortKey } from "@swim-app/shared";

import CoachFamiliesContent from "@/content/CoachFamiliesContent";
import {
  fetchCoachFamilies,
  fetchCoachNeedsAttention,
} from "@/lib/api/coachHouseholds";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Families · Axiom Aquatics",
};

const DEFAULT_SORT: CoachFamiliesSortKey = "activity_desc";

function parsePage(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function parseSort(raw: string | undefined): CoachFamiliesSortKey {
  if (raw === undefined) return DEFAULT_SORT;
  const match = COACH_FAMILIES_SORT_KEYS.find((key) => key === raw);
  return match ?? DEFAULT_SORT;
}

export default async function CoachFamiliesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  if (!auth) return null;

  const searchParams = await props.searchParams;
  const pickFirst = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;
  const page = parsePage(pickFirst(searchParams["page"]));
  const sort = parseSort(pickFirst(searchParams["sort"]));
  const search = pickFirst(searchParams["search"])?.trim();
  const normalizedSearch = search === "" ? undefined : search;

  const [familiesResult, needsAttentionResult] = await Promise.all([
    fetchCoachFamilies(auth.accessToken, {
      page,
      sort,
      ...(normalizedSearch !== undefined && { search: normalizedSearch }),
    }),
    fetchCoachNeedsAttention(auth.accessToken),
  ]);
  if (!familiesResult.ok) {
    throw new Error(`Failed to load families (${familiesResult.reason})`);
  }
  // Non-critical: if the attention list fetch fails we render the page
  // without the section. The per-family banner on each family page is
  // still live, so no refund ever goes un-surfaced.
  const initialNeedsAttention = needsAttentionResult.ok
    ? needsAttentionResult.data.jobs
    : [];

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-24">
          <CoachFamiliesContent
            page={familiesResult.data}
            sort={sort}
            search={normalizedSearch ?? ""}
            initialNeedsAttention={initialNeedsAttention}
          />
        </div>
      </main>
    </div>
  );
}
