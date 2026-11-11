import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { DeletionPreviewResponse } from "@swim-app/shared";

// Replace the server action with a spy (same shape as the sibling
// deleteAccountSection test file) so the form render doesn't blow up on
// the uninitialized action.
const { mockConfirm, initialState } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  initialState: { status: "idle" as const },
}));

vi.mock("@/content/AccountContent/deleteAccountActions", () => ({
  confirmDeletionAction: mockConfirm,
  initialDeleteAccountState: initialState,
}));

import DeleteAccountSection from "../content/AccountContent/DeleteAccountSection";

function previewWithCashOut(args: {
  refundableCents: number;
  writeOffCents: number;
  callerRole?: "owner" | "manager";
}): DeletionPreviewResponse {
  return {
    householdName: "Smith household",
    memberCount: 1,
    swimmers: [{ firstName: "Alex", lastInitial: "S." }],
    pastLessonCount: 2,
    futureLessonCount: 1,
    ownerMustTransferFirst: false,
    callerRole: args.callerRole ?? "owner",
    balanceCents: args.refundableCents + args.writeOffCents,
    cashOutPreview: {
      totalCardPaidCents: args.refundableCents,
      totalCashRefundedCents: 0,
      netLessonSpendingCents: 0,
      currentBalanceCents: args.refundableCents + args.writeOffCents,
      refundableCents: args.refundableCents,
      writeOffCents: args.writeOffCents,
    },
  };
}

describe("DeleteAccountSection — cash-out breakdown copy (ADR 036 Phase 8 Part B)", () => {
  it("renders both the refund and forfeit lines when cashOutPreview is fully populated", async () => {
    const user = userEvent.setup();
    render(
      <DeleteAccountSection
        preview={previewWithCashOut({ refundableCents: 5000, writeOffCents: 2500 })}
      />,
    );
    // The preview copy is gated behind the Delete-account button —
    // click it so the copy expands.
    await user.click(screen.getByTestId("delete-account-expand"));
    expect(screen.getByTestId("delete-account-preview-cashout")).toBeInTheDocument();
    expect(screen.getByTestId("delete-account-preview-refund")).toHaveTextContent(
      "$50.00",
    );
    expect(screen.getByTestId("delete-account-preview-writeoff")).toHaveTextContent(
      "$25.00",
    );
  });

  it("hides the whole cash-out paragraph when cashOutPreview is null", async () => {
    const user = userEvent.setup();
    render(
      <DeleteAccountSection
        preview={{
          householdName: "Smith household",
          memberCount: 1,
          swimmers: [],
          pastLessonCount: 0,
          futureLessonCount: 0,
          ownerMustTransferFirst: false,
          callerRole: "owner",
          balanceCents: 0,
          cashOutPreview: null,
        }}
      />,
    );
    await user.click(screen.getByTestId("delete-account-expand"));
    expect(screen.queryByTestId("delete-account-preview-cashout")).toBeNull();
  });

  it("hides only the refund half when refundableCents is zero", async () => {
    const user = userEvent.setup();
    render(
      <DeleteAccountSection
        preview={previewWithCashOut({ refundableCents: 0, writeOffCents: 1000 })}
      />,
    );
    await user.click(screen.getByTestId("delete-account-expand"));
    expect(screen.getByTestId("delete-account-preview-cashout")).toBeInTheDocument();
    expect(screen.queryByTestId("delete-account-preview-refund")).toBeNull();
    expect(screen.getByTestId("delete-account-preview-writeoff")).toHaveTextContent(
      "$10.00",
    );
  });

  it("hides only the forfeit half when writeOffCents is zero", async () => {
    const user = userEvent.setup();
    render(
      <DeleteAccountSection
        preview={previewWithCashOut({ refundableCents: 4200, writeOffCents: 0 })}
      />,
    );
    await user.click(screen.getByTestId("delete-account-expand"));
    expect(screen.getByTestId("delete-account-preview-cashout")).toBeInTheDocument();
    expect(screen.getByTestId("delete-account-preview-refund")).toHaveTextContent(
      "$42.00",
    );
    expect(screen.queryByTestId("delete-account-preview-writeoff")).toBeNull();
  });

  it("hides the paragraph when both refundableCents and writeOffCents are zero", async () => {
    const user = userEvent.setup();
    render(
      <DeleteAccountSection
        preview={previewWithCashOut({ refundableCents: 0, writeOffCents: 0 })}
      />,
    );
    await user.click(screen.getByTestId("delete-account-expand"));
    expect(screen.queryByTestId("delete-account-preview-cashout")).toBeNull();
  });
});
