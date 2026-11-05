// Pure-function tests for the shared scope decision. Preview and
// confirm both call decideDeletionScope so the UI can never surface
// a different story than the engine actually enforces (ADR 034).

import { describe, it, expect } from "vitest";

import { decideDeletionScope } from "../services/accountDeletion";

describe("decideDeletionScope", () => {
  it("solo — caller is the only member", () => {
    expect(decideDeletionScope("owner", [])).toEqual({ kind: "solo" });
    expect(decideDeletionScope("manager", [])).toEqual({ kind: "solo" });
    expect(decideDeletionScope("viewer", [])).toEqual({ kind: "solo" });
  });

  it("solo — owner with only viewers remaining (the case the old preview mishandled)", () => {
    expect(decideDeletionScope("owner", ["viewer"])).toEqual({ kind: "solo" });
    expect(decideDeletionScope("owner", ["viewer", "viewer", "viewer"])).toEqual({
      kind: "solo",
    });
  });

  it("must_transfer — owner with another owner or manager present", () => {
    expect(decideDeletionScope("owner", ["manager"])).toEqual({ kind: "must_transfer" });
    expect(decideDeletionScope("owner", ["manager", "viewer"])).toEqual({
      kind: "must_transfer",
    });
    // The partial unique index enforces one-owner-per-household, so two
    // owners is a shape the DB won't allow. The helper is still well-
    // defined for it as a belt-and-suspenders check.
    expect(decideDeletionScope("owner", ["owner"])).toEqual({ kind: "must_transfer" });
  });

  it("leave — manager with any other adult present", () => {
    expect(decideDeletionScope("manager", ["owner"])).toEqual({ kind: "leave" });
    expect(decideDeletionScope("manager", ["owner", "viewer"])).toEqual({ kind: "leave" });
    expect(decideDeletionScope("manager", ["owner", "manager", "viewer"])).toEqual({
      kind: "leave",
    });
  });

  it("leave — viewer with any other adult present", () => {
    expect(decideDeletionScope("viewer", ["owner"])).toEqual({ kind: "leave" });
    expect(decideDeletionScope("viewer", ["manager"])).toEqual({ kind: "leave" });
    expect(decideDeletionScope("viewer", ["owner", "manager"])).toEqual({ kind: "leave" });
  });

  it("solo — non-owner caller with only other viewers would be reachable only via a bad invariant, but the helper handles it", () => {
    // The one-owner invariant means a household with a manager/viewer
    // caller must also contain an owner. If the invariant somehow broke,
    // the helper still returns solo (no adults left after the caller).
    expect(decideDeletionScope("manager", ["viewer"])).toEqual({ kind: "solo" });
    expect(decideDeletionScope("viewer", ["viewer"])).toEqual({ kind: "solo" });
  });
});
