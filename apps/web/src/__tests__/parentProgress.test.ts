import { describe, it, expect } from "vitest";

import type { ParentSwimmer } from "@swim-app/shared";

function resolveProgressDestination(
  swimmers: ParentSwimmer[],
): { type: "redirect"; path: string } | { type: "picker" } {
  if (swimmers.length === 0) return { type: "redirect", path: "/dashboard" };
  const first = swimmers[0];
  if (swimmers.length === 1 && first) {
    return { type: "redirect", path: `/dashboard/swimmers/${first.id}/progress` };
  }
  return { type: "picker" };
}

const makeSwimmer = (id: string): ParentSwimmer => ({
  id,
  firstName: "Alex",
  lastName: "Smith",
  birthDate: "2015-06-01",
  sex: "male",
  isPublic: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  clubs: [],
  currentLeagues: [],
});

describe("progress page routing", () => {
  it("redirects to dashboard when there are no swimmers", () => {
    expect(resolveProgressDestination([])).toEqual({
      type: "redirect",
      path: "/dashboard",
    });
  });

  it("redirects straight to the swimmer's progress page when there is exactly one swimmer", () => {
    const result = resolveProgressDestination([makeSwimmer("swimmer-1")]);
    expect(result).toEqual({
      type: "redirect",
      path: "/dashboard/swimmers/swimmer-1/progress",
    });
  });

  it("shows the picker when there are multiple swimmers", () => {
    const result = resolveProgressDestination([
      makeSwimmer("swimmer-1"),
      makeSwimmer("swimmer-2"),
    ]);
    expect(result).toEqual({ type: "picker" });
  });
});
