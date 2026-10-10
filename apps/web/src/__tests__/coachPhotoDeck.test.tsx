import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
  }: {
    src: string;
    alt: string;
    className?: string;
  }) => <img src={src} alt={alt} className={className} />,
}));

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

import CoachPhotoDeck from "../content/HomepageContent/CoachPhotoDeck";

const photos = [
  { src: "/a.jpg", alt: "Photo A" },
  { src: "/b.jpg", alt: "Photo B" },
  { src: "/c.jpg", alt: "Photo C" },
];

beforeEach(() => {
  // Default: reduced motion so button clicks swap instantly (no transitionend needed)
  mockMatchMedia(true);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("CoachPhotoDeck", () => {
  it("shows the first photo on load", () => {
    render(<CoachPhotoDeck photos={photos} />);
    expect(screen.getByAltText("Photo A")).toBeInTheDocument();
  });

  it("advances to the next photo on next button click", () => {
    render(<CoachPhotoDeck photos={photos} />);
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(screen.getByAltText("Photo B")).toBeInTheDocument();
  });

  it("wraps from the last photo back to the first", () => {
    render(<CoachPhotoDeck photos={photos} />);
    const nextBtn = screen.getByRole("button", { name: "Next photo" });
    fireEvent.click(nextBtn); // → B
    fireEvent.click(nextBtn); // → C
    fireEvent.click(nextBtn); // → A (wrap)
    expect(screen.getByAltText("Photo A")).toBeInTheDocument();
  });

  it("goes to the previous photo on prev button click", () => {
    render(<CoachPhotoDeck photos={photos} />);
    const nextBtn = screen.getByRole("button", { name: "Next photo" });
    fireEvent.click(nextBtn); // → B
    fireEvent.click(screen.getByRole("button", { name: "Previous photo" })); // → A
    expect(screen.getByAltText("Photo A")).toBeInTheDocument();
  });

  it("pauses auto-advance on hover", () => {
    mockMatchMedia(false); // enable auto-advance timer
    render(<CoachPhotoDeck photos={photos} />);

    fireEvent.mouseEnter(screen.getByTestId("coach-photo-deck"));

    act(() => {
      vi.advanceTimersByTime(7000);
    });

    expect(screen.getByAltText("Photo A")).toBeInTheDocument();
  });

  it("does not auto-advance under prefers-reduced-motion", () => {
    // matchMedia(true) already set in beforeEach
    render(<CoachPhotoDeck photos={photos} />);

    act(() => {
      vi.advanceTimersByTime(7000);
    });

    expect(screen.getByAltText("Photo A")).toBeInTheDocument();
  });
});
