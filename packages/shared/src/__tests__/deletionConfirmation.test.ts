import { describe, it, expect } from "vitest";

import {
  DELETION_CONFIRMATION_PHRASE,
  matchesDeletionConfirmationPhrase,
} from "../schemas/accountDeletion";

describe("matchesDeletionConfirmationPhrase", () => {
  it("matches the canonical lowercase phrase", () => {
    expect(matchesDeletionConfirmationPhrase(DELETION_CONFIRMATION_PHRASE)).toBe(true);
    expect(matchesDeletionConfirmationPhrase("delete")).toBe(true);
  });

  it("matches with autocapitalized first letter (iPhone default)", () => {
    expect(matchesDeletionConfirmationPhrase("Delete")).toBe(true);
  });

  it("matches uppercase and mixed case", () => {
    expect(matchesDeletionConfirmationPhrase("DELETE")).toBe(true);
    expect(matchesDeletionConfirmationPhrase("DeLeTe")).toBe(true);
  });

  it("trims leading and trailing whitespace", () => {
    expect(matchesDeletionConfirmationPhrase("delete ")).toBe(true);
    expect(matchesDeletionConfirmationPhrase("  delete")).toBe(true);
    expect(matchesDeletionConfirmationPhrase("\tdelete\n")).toBe(true);
    expect(matchesDeletionConfirmationPhrase("  Delete  ")).toBe(true);
  });

  it("rejects wrong words or extra interior content", () => {
    expect(matchesDeletionConfirmationPhrase("delete my account")).toBe(false);
    expect(matchesDeletionConfirmationPhrase("delet")).toBe(false);
    expect(matchesDeletionConfirmationPhrase("del ete")).toBe(false);
    expect(matchesDeletionConfirmationPhrase("DELETE!")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(matchesDeletionConfirmationPhrase("")).toBe(false);
    expect(matchesDeletionConfirmationPhrase("   ")).toBe(false);
  });
});
