import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

describe("AccountDeletedModal", () => {
  it("renders nothing when the ?account-deleted param is absent", () => {
    mockParams = new URLSearchParams();
    const { container } = render(<AccountDeletedModal />);
    expect(container.firstChild).toBeNull();
  });

  it("opens with 'Your account has been deleted' when ?account-deleted=1 is present", () => {
    mockParams = new URLSearchParams("account-deleted=1");
    render(<AccountDeletedModal />);
    expect(screen.getByTestId("account-deleted-modal")).toBeInTheDocument();
    expect(screen.getByText(/your account has been deleted/i)).toBeInTheDocument();
    // Short line on what was removed — the short summary called out in
    // ADR 034's post-delete handoff copy.
    expect(screen.getByText(/upcoming lessons were cancelled/i)).toBeInTheDocument();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
  });

  it("stays closed if the param has a different value (one-time flag only)", () => {
    mockParams = new URLSearchParams("account-deleted=0");
    const { container } = render(<AccountDeletedModal />);
    expect(container.firstChild).toBeNull();
  });

  it("closes the modal and strips the param when Got it is clicked", () => {
    mockParams = new URLSearchParams("account-deleted=1");
    render(<AccountDeletedModal />);
    fireEvent.click(screen.getByTestId("account-deleted-modal-close"));
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(1);
    // router.replace is called with the clean pathname (no ?account-deleted).
    // A reload after closing must not re-open the modal.
    expect(mockReplace).toHaveBeenCalledWith("/");
  });
});
