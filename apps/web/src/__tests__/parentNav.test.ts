import { describe, it, expect } from "vitest";

import { isLinkActive, getVisibleLinks } from "../components/ParentNav/ParentNav";

describe("isLinkActive", () => {
  describe("Home (/dashboard)", () => {
    it("is active on exactly /dashboard", () => {
      expect(isLinkActive("/dashboard", "/dashboard")).toBe(true);
    });

    it("is not active on sub-paths", () => {
      expect(isLinkActive("/dashboard", "/dashboard/book")).toBe(false);
      expect(isLinkActive("/dashboard", "/dashboard/lessons")).toBe(false);
      expect(isLinkActive("/dashboard", "/dashboard/progress")).toBe(false);
    });
  });

  describe("Book (/dashboard/book)", () => {
    it("is active on /dashboard/book", () => {
      expect(isLinkActive("/dashboard/book", "/dashboard/book")).toBe(true);
    });

    it("is not active on other paths", () => {
      expect(isLinkActive("/dashboard/book", "/dashboard")).toBe(false);
      expect(isLinkActive("/dashboard/book", "/dashboard/lessons")).toBe(false);
    });
  });

  describe("Lessons (/dashboard/lessons)", () => {
    it("is active on /dashboard/lessons", () => {
      expect(isLinkActive("/dashboard/lessons", "/dashboard/lessons")).toBe(true);
    });

    it("is active on any lesson detail page", () => {
      expect(isLinkActive("/dashboard/lessons", "/dashboard/lessons/abc-123")).toBe(true);
    });

    it("is not active on other paths", () => {
      expect(isLinkActive("/dashboard/lessons", "/dashboard")).toBe(false);
      expect(isLinkActive("/dashboard/lessons", "/dashboard/book")).toBe(false);
    });
  });

  describe("Progress (/dashboard/progress)", () => {
    it("is active on /dashboard/progress", () => {
      expect(isLinkActive("/dashboard/progress", "/dashboard/progress")).toBe(true);
    });

    it("is active on any swimmer progress page", () => {
      expect(
        isLinkActive("/dashboard/progress", "/dashboard/swimmers/abc-123/progress"),
      ).toBe(true);
    });

    it("is not active on other paths", () => {
      expect(isLinkActive("/dashboard/progress", "/dashboard")).toBe(false);
      expect(isLinkActive("/dashboard/progress", "/dashboard/lessons")).toBe(false);
      expect(isLinkActive("/dashboard/progress", "/dashboard/book")).toBe(false);
    });
  });
});

describe("getVisibleLinks", () => {
  it("includes all four links for a non-viewer", () => {
    const links = getVisibleLinks(false);
    const labels = links.map((link) => link.label);
    expect(labels).toEqual(["Home", "Book", "Lessons", "Progress"]);
  });

  it("excludes Book for a viewer", () => {
    const links = getVisibleLinks(true);
    const labels = links.map((link) => link.label);
    expect(labels).toEqual(["Home", "Lessons", "Progress"]);
    expect(labels).not.toContain("Book");
  });
});
