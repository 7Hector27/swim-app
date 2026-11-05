import { describe, it, expect } from "vitest";

import {
  DELETION_CONFIRMATION_PHRASE,
  matchesDeletionConfirmationPhrase,
} from "../schemas/accountDeletion";

describe("matchesDeletionConfirmationPhrase", () => {
  it("matches the canonical lowercase phrase", () => {
    expect(matchesDeletionConfirmationPhrase(DELETION_CONFIRMATION_PHRASE)).toBe(true);
    expect(matchesDeletionConfirmationPhrase("delete my account")).toBe(true);
  });

  it("matches with autocapitalized first word (iPhone default)", () => {
    expect(matchesDeletionConfirmationPhrase("Delete my account")).toBe(true);
  });

  it("matches uppercase and mixed case", () => {
    expect(matchesDeletionConfirmationPhrase("DELETE MY ACCOUNT")).toBe(true);
    expect(matchesDeletionConfirmationPhrase("DeLeTe My AcCoUnT")).toBe(true);
  });

  it("trims leading and trailing whitespace", () => {
    expect(matchesDeletionConfirmationPhrase("delete my account ")).toBe(true);
    expect(matchesDeletionConfirmationPhrase("  delete my account")).toBe(true);
    expect(matchesDeletionConfirmationPhrase("\tdelete my account\n")).toBe(true);
    expect(matchesDeletionConfirmationPhrase("  Delete my account  ")).toBe(true);
  });

  it("rejects wrong words, wrong order, or extra interior whitespace", () => {
    expect(matchesDeletionConfirmationPhrase("delete account")).toBe(false);
    expect(matchesDeletionConfirmationPhrase("delete my acount")).toBe(false);
    expect(matchesDeletionConfirmationPhrase("delete my  account")).toBe(false); // two spaces mid-phrase
    expect(matchesDeletionConfirmationPhrase("delete the account")).toBe(false);
    expect(matchesDeletionConfirmationPhrase("account delete my")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(matchesDeletionConfirmationPhrase("")).toBe(false);
    expect(matchesDeletionConfirmationPhrase("   ")).toBe(false);
  });
});
