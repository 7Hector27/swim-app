import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import CtaBandSection from "@/content/HomepageContent/CtaBandSection";

describe("CtaBandSection — signed-out (default)", () => {
  it("shows the account-creation copy and links to /signup", () => {
    render(<CtaBandSection />);
    expect(
      screen.getByRole("heading", { name: "Ready to get in the water?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Create a parent account and book your first lesson."),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Create an account" });
    expect(link).toHaveAttribute("href", "/signup");
  });

  it("renders the same copy when variant is passed explicitly", () => {
    render(<CtaBandSection variant="signed-out" />);
    expect(
      screen.getByRole("heading", { name: "Ready to get in the water?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });
});

describe("CtaBandSection — parent-active (owner or manager)", () => {
  it("prompts a booking and links to /dashboard/book", () => {
    render(<CtaBandSection variant="parent-active" />);
    expect(
      screen.getByRole("heading", { name: "Ready for your next lesson?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pick a time that works and we'll see you in the water."),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Book a lesson" });
    expect(link).toHaveAttribute("href", "/dashboard/book");
  });
});

describe("CtaBandSection — parent-viewer", () => {
  it("points viewers at the lessons list, not the booking flow", () => {
    render(<CtaBandSection variant="parent-viewer" />);
    expect(
      screen.getByRole("heading", { name: "See what's coming up" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Check your family's upcoming lessons."),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View lessons" });
    expect(link).toHaveAttribute("href", "/dashboard/lessons");
    // Viewers should not see the booking CTA.
    expect(screen.queryByRole("link", { name: "Book a lesson" })).toBeNull();
  });
});

describe("CtaBandSection — coach", () => {
  it("sends the coach to the schedule", () => {
    render(<CtaBandSection variant="coach" />);
    expect(
      screen.getByRole("heading", { name: "Ready for the week?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Your schedule and booking requests are one tap away."),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open schedule" });
    expect(link).toHaveAttribute("href", "/coach/schedule");
  });
});
