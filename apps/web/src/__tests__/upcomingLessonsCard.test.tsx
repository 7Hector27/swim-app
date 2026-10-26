import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import UpcomingLessonsCard from "../content/ParentDashboardContent/UpcomingLessonsCard";
import type { UpcomingLesson } from "@swim-app/shared";

const LESSON_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const SWIMMER_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const LOCATION_ID = "cccccccc-0000-0000-0000-000000000003";

// 2026-10-19T23:00:00.000Z = Mon Oct 19 4:00 PM PDT
const baseLesson: UpcomingLesson = {
  id: LESSON_ID,
  locationId: LOCATION_ID,
  locationName: "Egret Park",
  startsAt: "2026-10-19T23:00:00.000Z",
  durationMinutes: 30,
  type: "private",
  status: "approved",
  swimmers: [{ swimmerId: SWIMMER_ID, firstName: "Alex", lastName: "Smith" }],
  expiresAt: null,
  approvedAt: "2026-10-15T10:00:00.000Z",
  declinedAt: null,
  declineReason: null,
  movedAt: null,
  previousStartsAt: null,
  createdAt: "2026-10-14T10:00:00.000Z",
  batchId: null,
  batchMode: null,
};

describe("UpcomingLessonsCard — empty state", () => {
  it("shows empty message and book link when no lessons", () => {
    render(<UpcomingLessonsCard lessons={[]} total={0} />);
    expect(screen.getByText(/No upcoming lessons booked yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Book a lesson/i })).toBeInTheDocument();
  });
});

describe("UpcomingLessonsCard — lesson row", () => {
  it("renders day-of-week and date number for the lesson", () => {
    render(<UpcomingLessonsCard lessons={[baseLesson]} total={1} />);
    expect(screen.getByText("MON")).toBeInTheDocument();
    expect(screen.getByText("19")).toBeInTheDocument();
  });

  it("renders time range with en-dash", () => {
    render(<UpcomingLessonsCard lessons={[baseLesson]} total={1} />);
    // 4:00 – 4:30 PM
    const timeEl = screen.getByText(/4:00/);
    expect(timeEl.textContent).toMatch(/–/);
    expect(timeEl.textContent).toMatch(/PM/);
  });

  it("renders location name", () => {
    render(<UpcomingLessonsCard lessons={[baseLesson]} total={1} />);
    expect(screen.getByText("Egret Park")).toBeInTheDocument();
  });

  it("renders swimmer first name", () => {
    render(<UpcomingLessonsCard lessons={[baseLesson]} total={1} />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
  });

  it("whole card is a link to the lesson detail page", () => {
    render(<UpcomingLessonsCard lessons={[baseLesson]} total={1} />);
    const links = screen.getAllByRole("link");
    const lessonLink = links.find(
      (el) => (el as HTMLAnchorElement).href?.includes(`/dashboard/lessons/${LESSON_ID}`),
    );
    expect(lessonLink).toBeTruthy();
  });

  it("shows no status badge for approved lessons", () => {
    render(<UpcomingLessonsCard lessons={[baseLesson]} total={1} />);
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
    expect(screen.queryByText("Waiting for Jason")).not.toBeInTheDocument();
  });

  it("shows 'Waiting for Jason' badge for pending lessons", () => {
    const pendingLesson: UpcomingLesson = { ...baseLesson, status: "pending", approvedAt: null };
    render(<UpcomingLessonsCard lessons={[pendingLesson]} total={1} />);
    expect(screen.getByText("Waiting for Jason")).toBeInTheDocument();
  });
});

describe("UpcomingLessonsCard — total count and See all", () => {
  it("shows total count in heading", () => {
    render(<UpcomingLessonsCard lessons={[baseLesson, baseLesson, baseLesson]} total={17} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Upcoming lessons (17)");
  });

  it("shows 'See all' link when total exceeds shown lessons", () => {
    render(<UpcomingLessonsCard lessons={[baseLesson, baseLesson, baseLesson]} total={17} />);
    const seeAll = screen.getByRole("link", { name: /See all/i });
    expect(seeAll).toBeInTheDocument();
    expect((seeAll as HTMLAnchorElement).href).toContain("/dashboard/lessons");
  });

  it("hides 'See all' when shown lessons equals total (no more exist)", () => {
    render(<UpcomingLessonsCard lessons={[baseLesson, baseLesson]} total={2} />);
    expect(screen.queryByRole("link", { name: /See all/i })).not.toBeInTheDocument();
  });

  it("heading count matches the API total, not the number of rows shown", () => {
    render(<UpcomingLessonsCard lessons={[baseLesson]} total={9} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("(9)");
    expect(screen.queryByText("(1)")).not.toBeInTheDocument();
  });
});
