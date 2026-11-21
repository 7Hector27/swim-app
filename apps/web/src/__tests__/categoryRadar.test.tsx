import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import CategoryRadar, { __TEST__ } from "../content/SwimmerProgressContent/charts/CategoryRadar";

// Real category names from the skills catalog. Any wrapping/padding fix
// has to handle the longest ones ("Starts, Turns & Underwaters",
// "Body Position & Balance") without clipping or overlapping the chart.
const REAL_CATEGORIES = [
  "Body Position & Balance",
  "Breathing & Coordination",
  "Freestyle",
  "Backstroke",
  "Breaststroke",
  "Butterfly",
  "Starts, Turns & Underwaters",
  "Racing & Performance",
  "Water Confidence",
].map((name) => ({ name, average: 3, assessedCount: 2 }));

// Figtree is roughly 7.5 - 8.5px per character at the radar's font-sizes
// (lowercase averages smaller, uppercase/digits a touch larger). Char width
// scales linearly with font-size; the heuristic below picks the ratio and
// returns an upper-bound width so a passing assertion here means a real
// browser (which usually renders text slightly narrower than this heuristic)
// will also fit.
function charWidthFor(fontSize: number): number {
  return 7.5 * (fontSize / 13);
}

interface LabelBox {
  text: string;
  centerX: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function readLabelBoxes(container: HTMLElement, fontSize: number): LabelBox[] {
  const charWidth = charWidthFor(fontSize);
  // Line height scales with font-size: the component uses 17 viewBox units
  // at the base and the step-ups are 1 and 2 units of font-size, so line
  // height effectively grows by a similar ratio when the text visually
  // enlarges. 18 is a safe bound for the desktop step.
  const lineHeight = 17 * (fontSize / 14);
  const texts = Array.from(container.querySelectorAll<SVGTextElement>("text[data-testid='category-radar-label']"));
  return texts.map((textEl) => {
    const anchor = textEl.getAttribute("text-anchor") ?? "start";
    const tspans = Array.from(textEl.querySelectorAll("tspan"));
    const lines = tspans.map((tspan) => tspan.textContent ?? "");
    const maxLineChars = Math.max(...lines.map((line) => line.length));
    const width = maxLineChars * charWidth;
    const x = Number(textEl.getAttribute("x"));
    const y = Number(textEl.getAttribute("y"));
    const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
    const right = anchor === "start" ? x + width : anchor === "end" ? x : x + width / 2;
    // Approximate ascender as 10 × (font/14) and descender as 3 × (font/14).
    const top = y - 10 * (fontSize / 14);
    const bottom = y + (tspans.length - 1) * lineHeight + 3 * (fontSize / 14);
    return { text: lines.join(" / "), centerX: (left + right) / 2, left, right, top, bottom };
  });
}

function assertAllLabelsFit(container: HTMLElement, fontSize: number): void {
  const svg = container.querySelector("svg");
  expect(svg).not.toBeNull();
  const viewBox = svg!.getAttribute("viewBox")!.split(" ").map(Number);
  const [vbMinX, vbMinY, vbWidth, vbHeight] = viewBox as [number, number, number, number];
  const vbMaxX = vbMinX + vbWidth;
  const vbMaxY = vbMinY + vbHeight;
  const boxes = readLabelBoxes(container, fontSize);
  expect(boxes).toHaveLength(REAL_CATEGORIES.length);
  for (const box of boxes) {
    expect(box.left, `${box.text} left @${fontSize}px`).toBeGreaterThanOrEqual(vbMinX);
    expect(box.right, `${box.text} right @${fontSize}px`).toBeLessThanOrEqual(vbMaxX);
    expect(box.top, `${box.text} top @${fontSize}px`).toBeGreaterThanOrEqual(vbMinY);
    expect(box.bottom, `${box.text} bottom @${fontSize}px`).toBeLessThanOrEqual(vbMaxY);
  }
}

describe("CategoryRadar — label bounding boxes stay inside the viewBox", () => {
  // The invariant we check — label bbox fits inside the SVG viewBox — is
  // scale-invariant, so one render covers phone (320), tablet (769, 1024),
  // and desktop (1280) container widths. We re-run the invariant for each
  // breakpoint's font-size step because the font-size change is applied in
  // viewBox units (via CSS media rules on .category-radar-label), which
  // can widen text in viewBox space.
  it.each([
    { label: "phone (320px)", fontSize: 14 },
    { label: "tablet 769px", fontSize: 15 },
    { label: "tablet 1024px", fontSize: 15 },
    { label: "desktop 1280px", fontSize: 16 },
  ])("real category names fit inside the viewBox at $label", ({ fontSize }) => {
    const { container } = render(<CategoryRadar categories={REAL_CATEGORIES} />);
    assertAllLabelsFit(container, fontSize);
  });

  it("renders every category name in full (no shortening)", () => {
    const { container } = render(<CategoryRadar categories={REAL_CATEGORIES} />);
    const rendered = Array.from(container.querySelectorAll("text[data-testid='category-radar-label']"))
      .map((textEl) =>
        Array.from(textEl.querySelectorAll("tspan"))
          .map((tspan) => tspan.textContent)
          .join(" "),
      )
      .map((line) => line.replace(/\s+/g, " ").trim());

    for (const category of REAL_CATEGORIES) {
      expect(rendered).toContain(category.name);
    }
  });

  it("wraps long '&' names onto two lines", () => {
    const { container } = render(<CategoryRadar categories={REAL_CATEGORIES} />);
    const labels = Array.from(container.querySelectorAll("text[data-testid='category-radar-label']"));
    const twoLineCount = labels.filter((textEl) => textEl.querySelectorAll("tspan").length === 2).length;
    // Four names contain " & " in the catalog and must wrap.
    expect(twoLineCount).toBeGreaterThanOrEqual(4);
  });

  it("every label is centered: text-anchor is 'middle' on every label", () => {
    const { container } = render(<CategoryRadar categories={REAL_CATEGORIES} />);
    const texts = Array.from(container.querySelectorAll("text[data-testid='category-radar-label']"));
    expect(texts.length).toBeGreaterThan(0);
    for (const textEl of texts) {
      expect(textEl.getAttribute("text-anchor")).toBe("middle");
    }
  });

  it("both lines of a two-line label share one center x so the block centers on its axis", () => {
    const { container } = render(<CategoryRadar categories={REAL_CATEGORIES} />);
    const texts = Array.from(container.querySelectorAll("text[data-testid='category-radar-label']"));
    const twoLine = texts.filter((textEl) => textEl.querySelectorAll("tspan").length === 2);
    expect(twoLine.length).toBeGreaterThanOrEqual(4);
    for (const textEl of twoLine) {
      const parentX = textEl.getAttribute("x");
      const tspanXs = Array.from(textEl.querySelectorAll("tspan")).map((tspan) => tspan.getAttribute("x"));
      expect(tspanXs[0]).toBe(parentX);
      expect(tspanXs[1]).toBe(parentX);
    }
  });

  it("renders full labels only (no short-label variant) by default", () => {
    const { container } = render(<CategoryRadar categories={REAL_CATEGORIES} />);
    const shortVariants = container.querySelectorAll("text[data-variant='short']");
    expect(shortVariants).toHaveLength(0);
    const texts = Array.from(container.querySelectorAll("text[data-testid='category-radar-label']"));
    const labelTexts = texts
      .map((textEl) =>
        Array.from(textEl.querySelectorAll("tspan"))
          .map((tspan) => tspan.textContent ?? "")
          .join(" "),
      )
      .map((line) => line.replace(/\s+/g, " ").trim());
    for (const category of REAL_CATEGORIES) {
      expect(labelTexts).toContain(category.name);
    }
  });

  it("no label's bounding box intersects the outer ring at any font size", () => {
    const { CX: cx, CY: cy, SHAPE_RADIUS: ringRadius } = __TEST__;
    for (const fontSize of [14, 15, 16]) {
      const { container, unmount } = renderOnce();
      const boxes = readLabelBoxes(container, fontSize);
      for (const box of boxes) {
        // Nearest point of an axis-aligned rect to (cx, cy):
        const nearestX = Math.max(box.left, Math.min(cx, box.right));
        const nearestY = Math.max(box.top, Math.min(cy, box.bottom));
        const dx = nearestX - cx;
        const dy = nearestY - cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        expect(distance, `${box.text} intersects the outer ring at ${fontSize}px (distance ${distance.toFixed(2)} ≤ ${ringRadius})`).toBeGreaterThan(ringRadius);
      }
      unmount();
    }
  });

  it("no pair of label boxes overlaps at any font size", () => {
    for (const fontSize of [14, 15, 16]) {
      const { container, unmount } = renderOnce();
      const boxes = readLabelBoxes(container, fontSize);
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const overlapsX = a.left < b.right && b.left < a.right;
          const overlapsY = a.top < b.bottom && b.top < a.bottom;
          const overlaps = overlapsX && overlapsY;
          expect(overlaps, `labels overlap at ${fontSize}px: "${a.text}" and "${b.text}"`).toBe(false);
        }
      }
      unmount();
    }
  });

  it("renders both the current and the first-evaluation shapes when the overlay is passed", () => {
    const first = REAL_CATEGORIES.map(() => ({ average: 1.5, assessedCount: 1 }));
    const { container } = render(
      <CategoryRadar categories={REAL_CATEGORIES} firstEvaluation={first} />,
    );
    // Current shape is the filled accent polygon; first evaluation is a
    // dashed outline marked with data-testid="category-radar-first-evaluation".
    const polygons = container.querySelectorAll("polygon");
    // Rings (5) + current shape + first-evaluation overlay = 7 polygons.
    expect(polygons.length).toBeGreaterThanOrEqual(7);
    expect(container.querySelector('[data-testid="category-radar-first-evaluation"]')).not.toBeNull();
  });

  it("omits the first-evaluation overlay when no overlay is passed", () => {
    const { container } = render(<CategoryRadar categories={REAL_CATEGORIES} />);
    expect(container.querySelector('[data-testid="category-radar-first-evaluation"]')).toBeNull();
  });
});

function renderOnce(): { container: HTMLElement; unmount: () => void } {
  const { container, unmount } = render(<CategoryRadar categories={REAL_CATEGORIES} />);
  return { container, unmount };
}
