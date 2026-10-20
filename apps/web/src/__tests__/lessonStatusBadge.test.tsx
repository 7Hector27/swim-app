import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import LessonStatusBadge from "../components/LessonStatusBadge/LessonStatusBadge";

describe("LessonStatusBadge — approved", () => {
  it("renders nothing for approved status", () => {
    const { container } = render(
      <LessonStatusBadge status="approved" viewer="parent" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LessonStatusBadge — pending", () => {
  it("shows 'Waiting for Jason' for parent viewer", () => {
    render(<LessonStatusBadge status="pending" viewer="parent" />);
    expect(screen.getByText("Waiting for Jason")).toBeInTheDocument();
  });

  it("shows 'Waiting for approval' for coach viewer", () => {
    render(<LessonStatusBadge status="pending" viewer="coach" />);
    expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
  });
});

describe("LessonStatusBadge — canceled", () => {
  it("shows 'Canceled'", () => {
    render(<LessonStatusBadge status="canceled" viewer="parent" />);
    expect(screen.getByText("Canceled")).toBeInTheDocument();
  });
});

describe("LessonStatusBadge — declined", () => {
  it("shows 'Declined'", () => {
    render(<LessonStatusBadge status="declined" viewer="parent" />);
    expect(screen.getByText("Declined")).toBeInTheDocument();
  });
});

describe("LessonStatusBadge — expired", () => {
  it("shows 'Expired'", () => {
    render(<LessonStatusBadge status="expired" viewer="parent" />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });
});
