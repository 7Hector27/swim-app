import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// jsdom doesn't implement <dialog> methods — stub showModal + close.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  vi.clearAllMocks();
});

const mockReplace = vi.fn();
let mockParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/",
  useSearchParams: () => mockParams,
}));

import AccountDeletedModal from "@/components/AccountDeletedModal";

describe("AccountDeletedModal — refund / forfeit callout (ADR 036 Phase 8 Part B)", () => {
  it("renders the refund line with the dollar amount when ?refunded is present", () => {
    mockParams = new URLSearchParams("account-deleted=1&refunded=2500");
    render(<AccountDeletedModal />);
    const line = screen.getByTestId("account-deleted-cashout-line");
    expect(line).toBeInTheDocument();
    expect(screen.getByTestId("account-deleted-refunded")).toHaveTextContent(
      "$25.00",
    );
    expect(line.textContent).toMatch(/refund to your card/i);
    expect(line.textContent).toMatch(/appear in a few business days/i);
    // Forfeited isn't in the URL → that half of the sentence is hidden.
    expect(screen.queryByTestId("account-deleted-forfeited")).toBeNull();
  });

  it("renders the forfeit line only (no refund line) when only ?forfeited is present", () => {
    mockParams = new URLSearchParams("account-deleted=1&forfeited=1500");
    render(<AccountDeletedModal />);
    const line = screen.getByTestId("account-deleted-cashout-line");
    expect(line).toBeInTheDocument();
    expect(screen.getByTestId("account-deleted-forfeited")).toHaveTextContent(
      "$15.00",
    );
    expect(line.textContent).toMatch(/forfeited/i);
    // No refund half → the "typically appear in a few business days"
    // tail is hidden too.
    expect(screen.queryByTestId("account-deleted-refunded")).toBeNull();
    expect(line.textContent).not.toMatch(/business days/i);
  });

  it("renders both halves when both params are present", () => {
    mockParams = new URLSearchParams(
      "account-deleted=1&refunded=3000&forfeited=500",
    );
    render(<AccountDeletedModal />);
    expect(screen.getByTestId("account-deleted-refunded")).toHaveTextContent(
      "$30.00",
    );
    expect(screen.getByTestId("account-deleted-forfeited")).toHaveTextContent(
      "$5.00",
    );
  });

  it("hides the cash-out line entirely when both refunded and forfeited are zero", () => {
    mockParams = new URLSearchParams(
      "account-deleted=1&refunded=0&forfeited=0",
    );
    render(<AccountDeletedModal />);
    expect(screen.queryByTestId("account-deleted-cashout-line")).toBeNull();
  });

  it("hides the cash-out line when the params are absent (legacy 204 path)", () => {
    mockParams = new URLSearchParams("account-deleted=1");
    render(<AccountDeletedModal />);
    expect(screen.queryByTestId("account-deleted-cashout-line")).toBeNull();
  });
});
