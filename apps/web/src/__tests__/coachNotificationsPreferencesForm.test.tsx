import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockFetch, mockPatch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockPatch: vi.fn(),
}));

vi.mock("@/lib/api/coachAlerts", () => ({
  fetchNotificationPreferences: mockFetch,
  patchNotificationPreferences: mockPatch,
}));

import PreferencesForm from "../content/AccountContent/NotificationsSection/PreferencesForm";

const defaultPrefs = {
  bookingRequestEnabled: true,
  bookingRequestEmailBackupEnabled: true,
  requestExpiringSoonEnabled: true,
  parentChangeEnabled: true,
  autoApprovedMode: "summary" as const,
  dailySummaryEnabled: true,
  dailySummaryTimeLocal: "08:00:00",
  quietHoursEnabled: true,
  quietHoursStartLocal: "21:00:00",
  quietHoursEndLocal: "07:00:00",
  lockScreenDetail: "first_initial" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true, data: defaultPrefs });
  mockPatch.mockResolvedValue({ ok: true, data: defaultPrefs });
});

describe("PreferencesForm", () => {
  it("loads and renders the toggles", async () => {
    render(<PreferencesForm />);
    await waitFor(() =>
      expect(screen.getByText(/new booking requests/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/expiring requests/i)).toBeInTheDocument();
    expect(screen.getByText(/parent cancels or reschedules/i)).toBeInTheDocument();
    expect(screen.getByText(/calendar disconnected/i)).toBeInTheDocument();
    expect(screen.getByText(/always on/i)).toBeInTheDocument();
  });

  it("saves immediately when a toggle changes", async () => {
    render(<PreferencesForm />);
    await waitFor(() =>
      expect(screen.getByText(/new booking requests/i)).toBeInTheDocument(),
    );
    const checkbox = screen.getAllByRole("checkbox")[0]!;
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith({ bookingRequestEnabled: false }),
    );
    await waitFor(() => expect(screen.getByText(/saved/i)).toBeInTheDocument());
  });

  it("normalizes the time field to HH:MM when editing quiet hours start", async () => {
    render(<PreferencesForm />);
    await waitFor(() =>
      expect(screen.getByText(/new booking requests/i)).toBeInTheDocument(),
    );
    const timeField = screen.getAllByLabelText(/start/i).find(
      (el) => (el as HTMLInputElement).type === "time",
    ) as HTMLInputElement;
    expect(timeField.value).toBe("21:00");
    fireEvent.change(timeField, { target: { value: "22:30" } });
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith({ quietHoursStartLocal: "22:30" }),
    );
  });

  it("surfaces a save error", async () => {
    mockPatch.mockResolvedValueOnce({ ok: false, status: 500 });
    render(<PreferencesForm />);
    await waitFor(() =>
      expect(screen.getByText(/new booking requests/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    await waitFor(() => expect(screen.getByText(/could not save/i)).toBeInTheDocument());
  });
});
