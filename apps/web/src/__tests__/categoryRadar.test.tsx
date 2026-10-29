import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import CategoryRadar from "../content/SwimmerProgressContent/charts/CategoryRadar";

// Real category names from the skills catalog. Any wrapping/padding fix
// has to handle the longest ones ("Starts, Turns & Underwaters",
// "Body Position & Balance") without clipping.
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
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function readLabelBoxes(container: HTMLElement, fontSize: number): LabelBox[] {
  const charWidth = charWidthFor(fontSize);
  // Line height scales with font-size: the component uses 16 viewBox units
  // at the base and the step-ups are 1 and 2 units of font-size, so line
  // height effectively grows by a similar ratio when the text visually
  // enlarges. 18 is a safe bound for the desktop step.
  const lineHeight = 15 * (fontSize / 13);
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
    // Approximate ascender as 10 × (font/13) and descender as 3 × (font/13).
    const top = y - 10 * (fontSize / 13);
    const bottom = y + (tspans.length - 1) * lineHeight + 3 * (fontSize / 13);
    return { text: lines.join(" / "), left, right, top, bottom };
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
  // breakpoint's font-size step (phone 13, tablet 14, desktop 15) because
  // the font-size change is applied in viewBox units (via CSS media rules
  // on .category-radar-label), which can widen text in viewBox space.
  it.each([
    { label: "phone (320px)", fontSize: 13 },
    { label: "tablet 769px", fontSize: 14 },
    { label: "tablet 1024px", fontSize: 14 },
    { label: "desktop 1280px", fontSize: 15 },
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

  it("anchors labels by angle: start on the right, end on the left, middle at the top", () => {
    const { container } = render(<CategoryRadar categories={REAL_CATEGORIES} />);
    const svg = container.querySelector("svg")!;
    const vb = svg.getAttribute("viewBox")!.split(" ").map(Number);
    const cx = vb[0]! + vb[2]! / 2;
    const texts = Array.from(container.querySelectorAll("text[data-testid='category-radar-label']"));
    for (const textEl of texts) {
      const x = Number(textEl.getAttribute("x"));
      const anchor = textEl.getAttribute("text-anchor");
      if (x > cx + 10) expect(anchor).toBe("start");
      else if (x < cx - 10) expect(anchor).toBe("end");
      else expect(anchor).toBe("middle");
    }
  });
});
