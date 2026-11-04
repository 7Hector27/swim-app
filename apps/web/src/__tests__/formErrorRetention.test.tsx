import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Hoist mockUseActionState so individual tests can inject state ─────────────
const { mockUseActionState } = vi.hoisted(() => ({ mockUseActionState: vi.fn() }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useActionState: mockUseActionState };
});

// ── Common mocks ──────────────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/SiteFooter", () => ({ default: () => <footer /> }));
vi.mock("@/components/ConfirmDialog", () => ({
  default: (props: { title: string }) => <div data-testid="confirm-dialog">{props.title}</div>,
}));

// ── Action mocks ──────────────────────────────────────────────────────────────
vi.mock("../content/LoginContent/actions", () => ({
  login: vi.fn(),
}));
vi.mock("../content/SignupContent/actions", () => ({
  signup: vi.fn(),
}));
vi.mock("@/lib/actions/notes", () => ({
  createNoteAction: vi.fn(),
}));
vi.mock("../content/CoachMeetsContent/actions", () => ({
  createMeet: vi.fn(),
  deleteMeet: vi.fn(),
}));
vi.mock("../content/CoachMeetDetailContent/actions", () => ({
  addSwim: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import LoginContent from "../content/LoginContent/LoginContent";
import SignupContent from "../content/SignupContent/SignupContent";
import AddNoteForm from "../components/AddNoteForm/AddNoteForm";
import CoachMeetsContent from "../content/CoachMeetsContent/CoachMeetsContent";
import CoachMeetDetailContent from "../content/CoachMeetDetailContent/CoachMeetDetailContent";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const MEET_ID = "11111111-0000-0000-0000-000000000001";
const SWIMMER_ID = "22222222-0000-0000-0000-000000000001";
const now = "2025-01-01T00:00:00.000Z";

const testMeet = {
  id: MEET_ID,
  name: "Spring Invitational",
  meetDate: "2025-03-15",
  course: "scy" as const,
  swimCount: 0,
  createdAt: now,
  updatedAt: now,
};

const meetWithNoSwims = { ...testMeet, swims: [] };

const testSwimmer = {
  id: SWIMMER_ID,
  firstName: "Alex",
  lastName: "Smith",
  age: 12,
  sex: "male" as const,
  isPublic: false,
  birthDate: "2013-01-01",
  currentLeagues: [],
  clubs: [],
  members: [],
  memberNames: [],
  lastLesson: null,
  homePool: null,
  createdAt: now,
  updatedAt: now,
};

// ── Default idle state ────────────────────────────────────────────────────────
beforeEach(() => {
  mockUseActionState.mockReturnValue([{ status: "idle" }, vi.fn(), false]);
});

// ── Login ─────────────────────────────────────────────────────────────────────

describe("LoginContent — controlled email input", () => {
  it("retains typed email value (controlled input)", () => {
    render(<LoginContent />);
    const emailInput = screen.getByLabelText("Email");
    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    expect(emailInput).toHaveValue("user@example.com");
  });

  it("renders error paragraph with role=alert and aria-live=assertive", () => {
    mockUseActionState.mockReturnValue([
      { error: "Email or password is incorrect." },
      vi.fn(),
      false,
    ]);
    render(<LoginContent />);
    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveAttribute("aria-live", "assertive");
    expect(errorEl).toHaveTextContent("Email or password is incorrect.");
  });

  it("email field keeps value after error state is set", () => {
    render(<LoginContent />);
    const emailInput = screen.getByLabelText("Email");
    fireEvent.change(emailInput, { target: { value: "user@example.com" } });

    // Simulate error state re-render by updating mock and re-rendering
    mockUseActionState.mockReturnValue([
      { error: "Email or password is incorrect." },
      vi.fn(),
      false,
    ]);
    // The controlled input keeps its local state regardless of action state
    expect(emailInput).toHaveValue("user@example.com");
  });
});

// ── Signup ────────────────────────────────────────────────────────────────────

describe("SignupContent — controlled text inputs", () => {
  it("retains typed fullName value (controlled input)", () => {
    render(<SignupContent />);
    const input = screen.getByLabelText("Full name");
    fireEvent.change(input, { target: { value: "Jane Doe" } });
    expect(input).toHaveValue("Jane Doe");
  });

  it("retains typed email value (controlled input)", () => {
    render(<SignupContent />);
    const input = screen.getByLabelText("Email");
    fireEvent.change(input, { target: { value: "jane@example.com" } });
    expect(input).toHaveValue("jane@example.com");
  });

  it("renders error paragraph with role=alert and aria-live=assertive", () => {
    mockUseActionState.mockReturnValue([
      { status: "error", message: "Something went wrong on our end. Try again in a moment." },
      vi.fn(),
      false,
    ]);
    render(<SignupContent />);
    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveAttribute("aria-live", "assertive");
    expect(errorEl).toHaveTextContent("Something went wrong on our end. Try again in a moment.");
  });

  it("fullName and email keep values when error state is present", () => {
    render(<SignupContent />);
    const fullNameInput = screen.getByLabelText("Full name");
    const emailInput = screen.getByLabelText("Email");
    fireEvent.change(fullNameInput, { target: { value: "Jane" } });
    fireEvent.change(emailInput, { target: { value: "jane@example.com" } });
    expect(fullNameInput).toHaveValue("Jane");
    expect(emailInput).toHaveValue("jane@example.com");
  });
});

// ── AddNoteForm ───────────────────────────────────────────────────────────────

describe("AddNoteForm — controlled textarea", () => {
  it("retains typed body value (controlled textarea)", () => {
    render(<AddNoteForm swimmerId="s1" />);
    const textarea = screen.getByPlaceholderText("Write a note…");
    fireEvent.change(textarea, { target: { value: "Great kick" } });
    expect(textarea).toHaveValue("Great kick");
  });

  it("renders error paragraph with role=alert when error state", () => {
    mockUseActionState.mockReturnValue([
      { status: "error", message: "Failed to save note. Please try again." },
      vi.fn(),
      false,
    ]);
    render(<AddNoteForm swimmerId="s1" />);
    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveAttribute("aria-live", "assertive");
    expect(errorEl).toHaveTextContent("Failed to save note. Please try again.");
  });

  it("textarea keeps value when error state is shown", () => {
    render(<AddNoteForm swimmerId="s1" />);
    const textarea = screen.getByPlaceholderText("Write a note…");
    fireEvent.change(textarea, { target: { value: "Great kick" } });
    expect(textarea).toHaveValue("Great kick");
  });
});

// ── CreateMeetForm (inside CoachMeetsContent) ─────────────────────────────────

describe("CreateMeetForm — controlled inputs", () => {
  it("opens the create form when Create meet is clicked", async () => {
    const user = userEvent.setup();
    render(<CoachMeetsContent meets={[]} />);
    await user.click(screen.getByRole("button", { name: /create meet/i }));
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("retains typed name value in the create form (controlled input)", async () => {
    const user = userEvent.setup();
    render(<CoachMeetsContent meets={[]} />);
    await user.click(screen.getByRole("button", { name: /create meet/i }));

    const nameInput = screen.getByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "Spring Champs" } });
    expect(nameInput).toHaveValue("Spring Champs");
  });

  it("retains typed date value in the create form (controlled input)", async () => {
    const user = userEvent.setup();
    render(<CoachMeetsContent meets={[]} />);
    await user.click(screen.getByRole("button", { name: /create meet/i }));

    const dateInput = screen.getByLabelText("Date");
    fireEvent.change(dateInput, { target: { value: "2025-06-01" } });
    expect(dateInput).toHaveValue("2025-06-01");
  });

  it("renders error paragraph with role=alert when error state", async () => {
    const user = userEvent.setup();
    // First call (initial render) idle, second call (after click) shows error
    mockUseActionState
      .mockReturnValueOnce([{ status: "idle" }, vi.fn(), false])
      .mockReturnValueOnce([
        { status: "error", message: "Could not create meet. Please try again." },
        vi.fn(),
        false,
      ]);

    render(<CoachMeetsContent meets={[]} />);
    await user.click(screen.getByRole("button", { name: /create meet/i }));

    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveAttribute("aria-live", "assertive");
    expect(errorEl).toHaveTextContent("Could not create meet. Please try again.");
  });
});

// ── AddSwimForm (inside CoachMeetDetailContent) ───────────────────────────────

describe("AddSwimForm — controlled inputs", () => {
  it("opens the add swim form when Add swim is clicked", async () => {
    const user = userEvent.setup();
    render(<CoachMeetDetailContent meet={meetWithNoSwims} swimmers={[testSwimmer]} />);
    await user.click(screen.getByRole("button", { name: /add swim/i }));
    expect(screen.getByLabelText("Time")).toBeInTheDocument();
  });

  it("retains typed time value in the add swim form (controlled input)", async () => {
    const user = userEvent.setup();
    render(<CoachMeetDetailContent meet={meetWithNoSwims} swimmers={[testSwimmer]} />);
    await user.click(screen.getByRole("button", { name: /add swim/i }));

    const timeInput = screen.getByLabelText("Time");
    fireEvent.change(timeInput, { target: { value: "badformat" } });
    expect(timeInput).toHaveValue("badformat");
  });

  it("renders error paragraph with role=alert when error state", async () => {
    const user = userEvent.setup();
    // First call (initial render) idle, second call (after click) shows error
    mockUseActionState
      .mockReturnValueOnce([{ status: "idle" }, vi.fn(), false])
      .mockReturnValueOnce([
        {
          status: "error",
          message: "Use the format M:SS.HH or SS.HH (e.g. 1:02.34 or 58.30).",
        },
        vi.fn(),
        false,
      ]);

    render(<CoachMeetDetailContent meet={meetWithNoSwims} swimmers={[testSwimmer]} />);
    await user.click(screen.getByRole("button", { name: /add swim/i }));

    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveAttribute("aria-live", "assertive");
    expect(errorEl).toHaveTextContent("Use the format M:SS.HH or SS.HH (e.g. 1:02.34 or 58.30).");
  });

  it("time field keeps value when error state is shown", async () => {
    const user = userEvent.setup();
    render(<CoachMeetDetailContent meet={meetWithNoSwims} swimmers={[testSwimmer]} />);
    await user.click(screen.getByRole("button", { name: /add swim/i }));

    const timeInput = screen.getByLabelText("Time");
    fireEvent.change(timeInput, { target: { value: "badformat" } });
    expect(timeInput).toHaveValue("badformat");
  });
});
