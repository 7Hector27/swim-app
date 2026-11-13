import { vi, describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const { mockAcceptPoliciesAction } = vi.hoisted(() => ({
  mockAcceptPoliciesAction: vi.fn(),
}));

vi.mock("@/content/PolicyUpdatedContent/actions", () => ({
  acceptPoliciesAction: mockAcceptPoliciesAction,
}));

import PolicyUpdatedContent from "@/content/PolicyUpdatedContent/PolicyUpdatedContent";

const SITE_URL = "http://localhost:3000";

const sampleMissing = [
  {
    policySlug: "privacy" as const,
    currentVersion: "2026-11-11",
    lastAcceptedVersion: null,
  },
  {
    policySlug: "payments_refund" as const,
    currentVersion: "2026-11-11",
    lastAcceptedVersion: "2025-01-15",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockAcceptPoliciesAction.mockReset();
});

describe("PolicyUpdatedContent — re-acceptance interstitial (ADR 036 Phase 8 Part B Stop 3)", () => {
  it("lists every missing policy with its label and version metadata", () => {
    render(<PolicyUpdatedContent missing={sampleMissing} next="/dashboard" siteUrl={SITE_URL} />);
    expect(screen.getByTestId("policy-updated-item-privacy")).toHaveTextContent("Privacy Policy");
    expect(screen.getByTestId("policy-updated-item-privacy")).toHaveTextContent(
      "you haven't accepted a version yet",
    );
    expect(screen.getByTestId("policy-updated-item-payments_refund")).toHaveTextContent(
      "Payments & Refund Policy",
    );
    expect(screen.getByTestId("policy-updated-item-payments_refund")).toHaveTextContent(
      "you previously accepted 2025-01-15",
    );
  });

  it("disables the Accept button until the checkbox is ticked", () => {
    render(<PolicyUpdatedContent missing={sampleMissing} next="/dashboard" siteUrl={SITE_URL} />);
    const button = screen.getByTestId("policy-updated-accept");
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByTestId("policy-updated-checkbox"));
    expect(button).not.toBeDisabled();
  });

  it("calls the action and redirects to ?next on success", async () => {
    mockAcceptPoliciesAction.mockResolvedValue({
      status: "ok",
      data: { acceptedSlugs: ["privacy", "payments_refund"] },
    });
    // jsdom's window.location is read-only; stub only the setter.
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "", assign: assignSpy },
    });

    render(
      <PolicyUpdatedContent
        missing={sampleMissing}
        next="/dashboard/book?resume=1"
        siteUrl={SITE_URL}
      />,
    );
    fireEvent.click(screen.getByTestId("policy-updated-checkbox"));
    fireEvent.click(screen.getByTestId("policy-updated-accept"));
    await vi.waitFor(() => {
      expect(mockAcceptPoliciesAction).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(window.location.href).toBe("/dashboard/book?resume=1");
    });
  });

  it("falls back to /dashboard when next is an unsafe absolute URL", async () => {
    mockAcceptPoliciesAction.mockResolvedValue({
      status: "ok",
      data: { acceptedSlugs: ["privacy"] },
    });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "" },
    });
    render(
      <PolicyUpdatedContent
        missing={sampleMissing}
        next="https://evil.example/pwn"
        siteUrl={SITE_URL}
      />,
    );
    fireEvent.click(screen.getByTestId("policy-updated-checkbox"));
    fireEvent.click(screen.getByTestId("policy-updated-accept"));
    await vi.waitFor(() => {
      expect(window.location.href).toBe("/dashboard");
    });
  });

  it("shows an error message when the action returns status: error", async () => {
    mockAcceptPoliciesAction.mockResolvedValue({ status: "error" });
    render(<PolicyUpdatedContent missing={sampleMissing} next="/dashboard" siteUrl={SITE_URL} />);
    fireEvent.click(screen.getByTestId("policy-updated-checkbox"));
    fireEvent.click(screen.getByTestId("policy-updated-accept"));
    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /couldn.?t record your acceptance/i,
      );
    });
  });
});
