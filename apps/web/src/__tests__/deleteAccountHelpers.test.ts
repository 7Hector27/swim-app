import { describe, it, expect } from "vitest";

import type { DeletionPreviewResponse } from "@swim-app/shared";

import {
  classifyDeleteAccountCase,
  formatRetryAfterMinutes,
} from "../content/AccountContent/deleteAccountHelpers";

function base(): DeletionPreviewResponse {
  return {
    householdName: "Test household",
    memberCount: 1,
    swimmers: [],
    pastLessonCount: 0,
    futureLessonCount: 0,
    ownerMustTransferFirst: false,
    callerRole: "owner",
  };
}

describe("classifyDeleteAccountCase", () => {
  it("single-member household → solo_alone", () => {
    expect(classifyDeleteAccountCase({ ...base(), memberCount: 1 })).toBe("solo_alone");
  });

  it("owner with other members and no transfer requirement → solo_owner_with_viewers", () => {
    expect(
      classifyDeleteAccountCase({
        ...base(),
        memberCount: 3,
        callerRole: "owner",
        ownerMustTransferFirst: false,
      }),
    ).toBe("solo_owner_with_viewers");
  });

  it("non-owner with other members → leave", () => {
    expect(
      classifyDeleteAccountCase({
        ...base(),
        memberCount: 2,
        callerRole: "manager",
      }),
    ).toBe("leave");
    expect(
      classifyDeleteAccountCase({
        ...base(),
        memberCount: 2,
        callerRole: "viewer",
      }),
    ).toBe("leave");
  });

  it("ownerMustTransferFirst always wins, regardless of role or member count", () => {
    expect(
      classifyDeleteAccountCase({
        ...base(),
        memberCount: 3,
        callerRole: "owner",
        ownerMustTransferFirst: true,
      }),
    ).toBe("blocked_owner_must_transfer");
  });
});

describe("formatRetryAfterMinutes", () => {
  it("null → 'in an hour' (safe default — the limiter is 1h)", () => {
    expect(formatRetryAfterMinutes(null)).toBe("in an hour");
  });

  it("rounds sub-minute values up to 1 minute", () => {
    expect(formatRetryAfterMinutes(5)).toBe("in 1 minute");
    expect(formatRetryAfterMinutes(59)).toBe("in 1 minute");
  });

  it("formats 1 minute singular, > 1 plural", () => {
    expect(formatRetryAfterMinutes(60)).toBe("in 1 minute");
    expect(formatRetryAfterMinutes(120)).toBe("in 2 minutes");
    expect(formatRetryAfterMinutes(60 * 25)).toBe("in 25 minutes");
  });

  it("switches to hours past 60 minutes, singular vs plural", () => {
    expect(formatRetryAfterMinutes(60 * 60)).toBe("in 1 hour");
    expect(formatRetryAfterMinutes(60 * 60 * 2)).toBe("in 2 hours");
  });

  it("negative / zero fall back to the safe default", () => {
    expect(formatRetryAfterMinutes(0)).toBe("in an hour");
    expect(formatRetryAfterMinutes(-30)).toBe("in an hour");
  });
});
