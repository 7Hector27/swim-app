import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { DeletionPreviewResponse } from "@swim-app/shared";

// The confirm form is wired through useActionState to a server action.
// We replace the action with a controllable spy so each test decides
// what the server returns for that call. The action signature is
// (prev, formData) => Promise<DeleteAccountState>; the component sees
// its return via useActionState.
const { mockConfirm, initialState } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  initialState: { status: "idle" as const },
}));

vi.mock("@/content/AccountContent/deleteAccountActions", () => ({
  confirmDeletionAction: mockConfirm,
  initialDeleteAccountState: initialState,
}));

import DeleteAccountSection from "../content/AccountContent/DeleteAccountSection";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function soloAlonePreview(): DeletionPreviewResponse {
  return {
    householdName: "Smith household",
    memberCount: 1,
    swimmers: [{ firstName: "Alex", lastInitial: "S." }],
    pastLessonCount: 4,
    futureLessonCount: 2,
    ownerMustTransferFirst: false,
    callerRole: "owner",
  };
}

function leavePreview(): DeletionPreviewResponse {
  return {
    householdName: "Smith household",
    memberCount: 2,
    swimmers: [],
    pastLessonCount: 1,
    futureLessonCount: 0,
    ownerMustTransferFirst: false,
    callerRole: "manager",
  };
}

function ownerWithViewersPreview(): DeletionPreviewResponse {
  return {
    householdName: "Smith household",
    memberCount: 3,
    swimmers: [{ firstName: "Mia", lastInitial: "S." }],
    pastLessonCount: 0,
    futureLessonCount: 1,
    ownerMustTransferFirst: false,
    callerRole: "owner",
  };
}

function blockedPreview(): DeletionPreviewResponse {
  return {
    householdName: "Smith household",
    memberCount: 3,
    swimmers: [],
    pastLessonCount: 0,
    futureLessonCount: 0,
    ownerMustTransferFirst: true,
    callerRole: "owner",
  };
}

// The real useActionState defers to the action asynchronously. Our mock
// resolves to the state it was configured to return and the component
// re-renders on the next tick.
beforeEach(() => {
  vi.clearAllMocks();
  mockConfirm.mockResolvedValue({ status: "idle" });
});

// ── Preview copy per case ────────────────────────────────────────────────────

describe("DeleteAccountSection — preview copy", () => {
  it("solo-alone case: lists swimmers, upcoming lessons, and the kept-past-lessons note", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection preview={soloAlonePreview()} />);
    await user.click(screen.getByTestId("delete-account-expand"));

    const preview = screen.getByTestId("delete-account-preview");
    expect(preview).toHaveTextContent(/only person on Smith household/i);
    expect(screen.getByTestId("delete-account-preview-swimmers")).toHaveTextContent(/Alex S\./);
    expect(screen.getByTestId("delete-account-preview-future")).toHaveTextContent(/2 upcoming lesson/);
    expect(screen.getByTestId("delete-account-preview-kept")).toHaveTextContent(
      /Past lessons stay on Coach Jason/i,
    );
    expect(screen.getByTestId("delete-account-preview-kept")).toHaveTextContent(/4 past lesson/);
  });

  it("owner-with-viewers case: explains viewers are released, no transfer blocker", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection preview={ownerWithViewersPreview()} />);
    await user.click(screen.getByTestId("delete-account-expand"));

    const preview = screen.getByTestId("delete-account-preview");
    expect(preview).toHaveTextContent(/other members on it are viewers only/i);
    expect(preview).toHaveTextContent(/viewers on this household stay signed in/i);
    // Not the blocked panel.
    expect(screen.queryByTestId("delete-account-blocked")).not.toBeInTheDocument();
    // The confirm form is rendered.
    expect(screen.getByTestId("delete-account-confirm-button")).toBeInTheDocument();
  });

  it("leave case: explains the household and other members stay", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection preview={leavePreview()} />);
    await user.click(screen.getByTestId("delete-account-expand"));

    const preview = screen.getByTestId("delete-account-preview");
    expect(preview).toHaveTextContent(/removed from Smith household/i);
    expect(preview).toHaveTextContent(/other members all stay/i);
    expect(screen.getByTestId("delete-account-confirm-button")).toBeInTheDocument();
  });

  it("blocked owner case: shows the transfer link, no confirm form", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection preview={blockedPreview()} />);
    await user.click(screen.getByTestId("delete-account-expand"));

    expect(screen.getByTestId("delete-account-blocked")).toHaveTextContent(
      /transfer ownership before you can close/i,
    );
    const link = screen.getByTestId("delete-account-transfer-link");
    expect(link).toHaveAttribute("href", "/household");
    expect(screen.queryByTestId("delete-account-confirm-button")).not.toBeInTheDocument();
  });
});

// ── Button-disabled state driven by the typed phrase ────────────────────────

describe("DeleteAccountSection — confirm button disabled state", () => {
  it("is disabled until the phrase matches (trimmed + case-insensitive), then enabled", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection preview={soloAlonePreview()} />);
    await user.click(screen.getByTestId("delete-account-expand"));

    const button = screen.getByTestId("delete-account-confirm-button");
    const input = screen.getByTestId("delete-account-phrase-input");

    expect(button).toBeDisabled();

    // Partial match.
    await user.type(input, "delete my acc");
    expect(button).toBeDisabled();

    // Typo — stays disabled.
    await user.clear(input);
    await user.type(input, "delete me account");
    expect(button).toBeDisabled();

    // Canonical lowercase match.
    await user.clear(input);
    await user.type(input, "delete my account");
    expect(button).toBeEnabled();

    // Trailing whitespace is now accepted — the client mirrors the
    // server's trim-and-lowercase rule so an iOS autocomplete that
    // tacks on a trailing space doesn't disable the button.
    await user.type(input, " ");
    expect(button).toBeEnabled();
  });

  it("accepts iPhone-autocapitalized and all-uppercase variants (trim + case-insensitive)", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection preview={soloAlonePreview()} />);
    await user.click(screen.getByTestId("delete-account-expand"));

    const button = screen.getByTestId("delete-account-confirm-button");
    const input = screen.getByTestId("delete-account-phrase-input");

    // First-word autocapitalization — the common iOS case.
    await user.type(input, "Delete my account");
    expect(button).toBeEnabled();

    // All uppercase.
    await user.clear(input);
    await user.type(input, "DELETE MY ACCOUNT");
    expect(button).toBeEnabled();

    // Leading + trailing padding.
    await user.clear(input);
    await user.type(input, "  delete my account  ");
    expect(button).toBeEnabled();
  });

  it("sets mobile-friendly input attributes to tame iOS autocorrect and spellcheck", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection preview={soloAlonePreview()} />);
    await user.click(screen.getByTestId("delete-account-expand"));

    const input = screen.getByTestId("delete-account-phrase-input");
    expect(input.getAttribute("autoCapitalize")).toBe("none");
    expect(input.getAttribute("autoCorrect")).toBe("off");
    // React sets spellCheck={false} as `spellcheck="false"` in the DOM.
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("autoComplete")).toBe("off");
  });
});

// ── Error branches ──────────────────────────────────────────────────────────

describe("DeleteAccountSection — error states do not sign the user out", () => {
  it("shows the invalid-password error inline on a 403 response — no redirect, no sign-out call", async () => {
    mockConfirm.mockResolvedValueOnce({ status: "invalid_password" });
    const user = userEvent.setup();
    render(<DeleteAccountSection preview={soloAlonePreview()} />);
    await user.click(screen.getByTestId("delete-account-expand"));

    await user.type(screen.getByLabelText(/your password/i), "wrong");
    await user.type(screen.getByTestId("delete-account-phrase-input"), "delete my account");
    await user.click(screen.getByTestId("delete-account-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-account-error-invalid-password")).toHaveTextContent(
        /password didn't match/i,
      );
    });
    // Form still mounted — no navigation / sign-out happened in this unit.
    expect(screen.getByTestId("delete-account-confirm-button")).toBeInTheDocument();
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows the rate-limit message with a retry-after hint in minutes", async () => {
    mockConfirm.mockResolvedValueOnce({ status: "rate_limited", retryAfterSeconds: 60 * 25 });
    const user = userEvent.setup();
    render(<DeleteAccountSection preview={soloAlonePreview()} />);
    await user.click(screen.getByTestId("delete-account-expand"));

    await user.type(screen.getByLabelText(/your password/i), "any");
    await user.type(screen.getByTestId("delete-account-phrase-input"), "delete my account");
    await user.click(screen.getByTestId("delete-account-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-account-error-rate-limited")).toHaveTextContent(
        /try again in 25 minutes/i,
      );
    });
  });

  it("shows an 'Another adult joined …' message on a 409 must_transfer_first race", async () => {
    mockConfirm.mockResolvedValueOnce({ status: "must_transfer_first" });
    const user = userEvent.setup();
    render(<DeleteAccountSection preview={soloAlonePreview()} />);
    await user.click(screen.getByTestId("delete-account-expand"));

    await user.type(screen.getByLabelText(/your password/i), "any");
    await user.type(screen.getByTestId("delete-account-phrase-input"), "delete my account");
    await user.click(screen.getByTestId("delete-account-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-account-error-must-transfer")).toHaveTextContent(
        /Another adult joined this household/i,
      );
    });
    // The old copy said "co-owner" — regression guard.
    expect(
      screen.queryByTestId("delete-account-error-must-transfer")!.textContent ?? "",
    ).not.toMatch(/co-owner/i);
  });

  it("falls back to a generic error message for anything else (500, network)", async () => {
    mockConfirm.mockResolvedValueOnce({ status: "generic_error" });
    const user = userEvent.setup();
    render(<DeleteAccountSection preview={soloAlonePreview()} />);
    await user.click(screen.getByTestId("delete-account-expand"));

    await user.type(screen.getByLabelText(/your password/i), "any");
    await user.type(screen.getByTestId("delete-account-phrase-input"), "delete my account");
    await user.click(screen.getByTestId("delete-account-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-account-error-generic")).toHaveTextContent(
        /something went wrong/i,
      );
    });
  });
});

// ── Success path (sign-out + redirect) ──────────────────────────────────────

describe("DeleteAccountSection — success handoff", () => {
  // The server action redirects to /account/deleted on 204 by throwing a
  // Next.js redirect(). From the component's perspective that surfaces as
  // the action's returned promise rejecting with a NEXT_REDIRECT marker.
  // Testing the exact redirect belongs in the action's own tests; here
  // we assert the component drives the action with the right inputs on
  // the happy path.
  it("submits password + confirmation phrase to the server action on confirm", async () => {
    mockConfirm.mockResolvedValueOnce({ status: "idle" });
    const user = userEvent.setup();
    render(<DeleteAccountSection preview={soloAlonePreview()} />);
    await user.click(screen.getByTestId("delete-account-expand"));

    await user.type(screen.getByLabelText(/your password/i), "right-password");
    await user.type(screen.getByTestId("delete-account-phrase-input"), "delete my account");
    await user.click(screen.getByTestId("delete-account-confirm-button"));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    const formData = mockConfirm.mock.calls[0]![1] as FormData;
    expect(formData.get("password")).toBe("right-password");
    expect(formData.get("confirmationPhrase")).toBe("delete my account");
  });
});
