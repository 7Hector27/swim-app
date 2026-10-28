import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Children of NotificationsSection load their own async data; mock the
// client API so the render pass settles.
const { mockPrefs, mockSubs } = vi.hoisted(() => ({
  mockPrefs: vi.fn(),
  mockSubs: vi.fn(),
}));

vi.mock("@/lib/api/coachAlerts", () => ({
  fetchPushSubscriptions: mockSubs,
  registerPushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
  sendTestPush: vi.fn(),
  fetchNotificationPreferences: mockPrefs,
  patchNotificationPreferences: vi.fn(),
}));

// Replace the inner-most children so we don't drag in Supabase / fetch
// deps; the point of this test is the data path from page → AccountContent
// → NotificationsSection, not re-covering what the dedicated tests cover.
vi.mock("@/content/AccountContent/EditProfileForm", () => ({
  default: () => <div data-testid="edit-profile" />,
}));
vi.mock("@/content/AccountContent/GoogleCalendarCard", () => ({
  default: () => <div data-testid="gcal-card" />,
}));
vi.mock("@/content/AccountContent/actions", () => ({
  logout: vi.fn(),
}));

import AccountContent from "../content/AccountContent/AccountContent";

const coachProfile = {
  email: "jason@axiomaquatics.io",
  fullName: "Jason Coach",
  phone: null,
  role: "coach" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSubs.mockResolvedValue({ ok: true, data: { items: [] } });
  mockPrefs.mockResolvedValue({
    ok: true,
    data: {
      bookingRequestEnabled: true,
      bookingRequestEmailBackupEnabled: true,
      requestExpiringSoonEnabled: true,
      parentChangeEnabled: true,
      autoApprovedMode: "summary",
      dailySummaryEnabled: true,
      dailySummaryTimeLocal: "08:00:00",
      quietHoursEnabled: true,
      quietHoursStartLocal: "21:00:00",
      quietHoursEndLocal: "07:00:00",
      lockScreenDetail: "first_initial",
    },
  });
});

describe("AccountContent → NotificationsSection prop plumbing", () => {
  it("renders the Notifications section for a coach with the VAPID key as a prop", async () => {
    render(
      <AccountContent
        profile={coachProfile}
        googleCalendarStatus={null}
        googleConnectError={false}
        googleDisconnectError={false}
        vapidPublicKey="AAAA"
      />,
    );
    // Heading proves the section mounted; devices list proves the client
    // children got their props and the mocked data loaded without the
    // old EnvValidationError crash.
    expect(screen.getByRole("heading", { name: /notifications/i })).toBeInTheDocument();
    await waitFor(() => expect(mockPrefs).toHaveBeenCalled());
    await waitFor(() => expect(mockSubs).toHaveBeenCalled());
  });

  it("does not render the Notifications section for parents", () => {
    render(
      <AccountContent
        profile={{ ...coachProfile, role: "parent" }}
        googleCalendarStatus={null}
        googleConnectError={false}
        googleDisconnectError={false}
        vapidPublicKey={undefined}
      />,
    );
    expect(screen.queryByRole("heading", { name: /notifications/i })).not.toBeInTheDocument();
  });
});
