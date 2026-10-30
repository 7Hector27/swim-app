import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import CollapsibleCategory from "@/components/CollapsibleCategory";

// Scrolling isn't implemented in jsdom; spy on it so the hash-match path
// (which calls scrollIntoView on the matched row) doesn't throw.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // Deterministic rAF so the scroll-into-view effect fires on the next tick
  // without timers in the test loop.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("CollapsibleCategory", () => {
  it("starts collapsed when the URL has no matching hash", () => {
    render(
      <CollapsibleCategory
        categorySlugs={["free-kick", "free-pull"]}
        summary={<span>Freestyle</span>}
      >
        <ul>
          <li id="skill-free-kick">Freestyle Kick</li>
        </ul>
      </CollapsibleCategory>,
    );
    const details = screen.getByText("Freestyle").closest("details");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(false);
  });

  it("auto-opens when the URL hash points at one of its slugs", () => {
    window.history.replaceState({}, "", "/progress#skill-free-kick");
    render(
      <CollapsibleCategory
        categorySlugs={["free-kick", "free-pull"]}
        summary={<span>Freestyle</span>}
      >
        <ul>
          <li id="skill-free-kick">Freestyle Kick</li>
        </ul>
      </CollapsibleCategory>,
    );
    const details = screen.getByText("Freestyle").closest("details");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(true);
    // The row the hash referred to is the one scrolled into view.
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("stays collapsed when the hash slug belongs to a different category", () => {
    window.history.replaceState({}, "", "/progress#skill-breast-kick");
    render(
      <CollapsibleCategory
        categorySlugs={["free-kick", "free-pull"]}
        summary={<span>Freestyle</span>}
      >
        <ul>
          <li id="skill-free-kick">Freestyle Kick</li>
        </ul>
      </CollapsibleCategory>,
    );
    const details = screen.getByText("Freestyle").closest("details");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(false);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("decodes a percent-encoded hash slug before matching", () => {
    // Reproduce the shape of an anchor link that was URL-encoded by the
    // href builder: `foo%20bar` must still match the raw slug `foo bar`.
    window.history.replaceState({}, "", "/progress#skill-free%2Dkick");
    render(
      <CollapsibleCategory
        categorySlugs={["free-kick"]}
        summary={<span>Freestyle</span>}
      >
        <ul>
          <li id="skill-free-kick">Freestyle Kick</li>
        </ul>
      </CollapsibleCategory>,
    );
    const details = screen.getByText("Freestyle").closest("details");
    expect(details!.hasAttribute("open")).toBe(true);
  });

  it("ignores non-skill hashes (e.g. #what-to-work-on)", () => {
    window.history.replaceState({}, "", "/progress#what-to-work-on");
    render(
      <CollapsibleCategory
        categorySlugs={["free-kick"]}
        summary={<span>Freestyle</span>}
      >
        <ul>
          <li id="skill-free-kick">Freestyle Kick</li>
        </ul>
      </CollapsibleCategory>,
    );
    const details = screen.getByText("Freestyle").closest("details");
    expect(details!.hasAttribute("open")).toBe(false);
  });
});
