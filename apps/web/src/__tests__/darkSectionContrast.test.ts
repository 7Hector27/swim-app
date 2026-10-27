// @vitest-environment node
//
// Two symmetric guards for surface/text token mismatches:
//
// 1. Dark-on-dark (original): any element that renders `bg-section` or
//    `bg-card` must also set an on-section text color on itself, so
//    descendants that don't declare their own color inherit something
//    readable in both themes. Without this guard, a form with `bg-card`
//    can appear fine while every nested heading, label, and button quietly
//    inherits page `text-text` (near-black in light mode) and becomes
//    unreadable, which is exactly what happened on /coach/meets.
//
// 2. Light-on-light (reverse): any element that renders `bg-background` or
//    `bg-surface-soft` must NOT also set an on-section text token on
//    itself. On-section tokens resolve to white in light mode, so pairing
//    them with a page surface renders white text on a near-white
//    background — exactly the cancel-lesson dialog bug.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const SRC = join(__dirname, "..");

const DARK_SECTION_BACKGROUNDS = new Set(["bg-section", "bg-card"]);
const LIGHT_SURFACE_BACKGROUNDS = new Set(["bg-background", "bg-surface-soft"]);

// A className that sets any of these tokens defines a text color safe for a
// dark surface in both themes. If none are present, descendants inherit the
// page `text-text` color, which is near-black in light mode.
const ON_SECTION_TEXT_TOKENS = new Set([
  "text-text-on-section",
  "text-text-secondary-on-section",
  "text-accent-on-section",
]);

// Elements whose own text content is already covered by an explicit tag-level
// color can opt out via one of these tokens (icon buttons that use the icon
// tokens, status chips with text-success / text-danger, etc). Keeping this
// list small keeps the guard honest.
const SELF_TEXT_OPT_OUTS = new Set([
  "text-success",
  "text-danger",
  "text-on-accent",
  "text-button-primary-text",
  "text-button-danger-text",
]);

type ViolationKind = "dark-missing-safe-color" | "light-with-on-section-text";

interface Violation {
  file: string;
  line: number;
  classString: string;
  kind: ViolationKind;
  tokens: string[];
}

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__") return [];
      return walkFiles(full);
    }
    return full.endsWith(".tsx") ? [full] : [];
  });
}

// Capture every quoted or template-literal string that follows `className=`,
// plus any string assigned to a `*Class`/`*ClassName` variable. Dynamic parts
// inside template literals (${...}) each resolve to their own quoted branches
// elsewhere in the file, so each branch still gets tokenized once.
function extractClassStrings(content: string): { raw: string; index: number }[] {
  const strings: { raw: string; index: number }[] = [];
  const classNameLiteral = /className=(?:(["'])([^]*?)\1|\{`([^`]*)`\})/g;
  let match: RegExpExecArray | null;
  while ((match = classNameLiteral.exec(content)) !== null) {
    strings.push({ raw: match[2] ?? match[3] ?? "", index: match.index });
  }
  const varClassName = /\b\w*(?:Class|Classes|ClassName)\b\s*=\s*(["'])([^]*?)\1/g;
  let varMatch: RegExpExecArray | null;
  while ((varMatch = varClassName.exec(content)) !== null) {
    strings.push({ raw: varMatch[2] ?? "", index: varMatch.index });
  }
  return strings;
}

function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < content.length; index++) {
    if (content[index] === "\n") line += 1;
  }
  return line;
}

function tokenize(classString: string): string[] {
  return classString.split(/\s+/).filter(Boolean);
}

function findViolations(file: string, content: string): Violation[] {
  const violations: Violation[] = [];
  for (const { raw, index } of extractClassStrings(content)) {
    const tokens = new Set(tokenize(raw));

    const darkBgs = [...tokens].filter((token) => DARK_SECTION_BACKGROUNDS.has(token));
    if (darkBgs.length > 0) {
      const hasSafeInherited = [...tokens].some((token) => ON_SECTION_TEXT_TOKENS.has(token));
      const hasSelfOnlyColor = [...tokens].some((token) => SELF_TEXT_OPT_OUTS.has(token));
      if (!hasSafeInherited && !hasSelfOnlyColor) {
        violations.push({
          file,
          line: lineAt(content, index),
          classString: raw.replace(/\s+/g, " ").trim(),
          kind: "dark-missing-safe-color",
          tokens: darkBgs,
        });
      }
    }

    const lightBgs = [...tokens].filter((token) => LIGHT_SURFACE_BACKGROUNDS.has(token));
    if (lightBgs.length > 0) {
      const onSectionText = [...tokens].filter((token) => ON_SECTION_TEXT_TOKENS.has(token));
      if (onSectionText.length > 0) {
        violations.push({
          file,
          line: lineAt(content, index),
          classString: raw.replace(/\s+/g, " ").trim(),
          kind: "light-with-on-section-text",
          tokens: [...lightBgs, ...onSectionText],
        });
      }
    }
  }
  return violations;
}

function describeViolation(violation: Violation): string {
  const prefix = `  line ${violation.line}: {${violation.tokens.join(", ")}}`;
  const suffix = violation.kind === "dark-missing-safe-color"
    ? "without an on-section text color"
    : "pairs a light surface with on-section text tokens";
  return `${prefix} ${suffix}\n    ${violation.classString}`;
}

const files = walkFiles(SRC);

describe("surface/text contrast guard", () => {
  it("finds .tsx files to scan (sanity check)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const label = file.replace(SRC, "").replace(/\\/g, "/");
    it(`${label} pairs surface tokens with the matching text palette`, () => {
      const content = readFileSync(file, "utf8");
      const violations = findViolations(file, content);
      const formatted = violations.map(describeViolation).join("\n");
      expect(
        violations,
        `Fix the token mismatches below.\n` +
          `  - dark-missing-safe-color: add text-text-on-section (or another *-on-section token) to the element with the dark background so descendants without explicit colors inherit a readable color.\n` +
          `  - light-with-on-section-text: on-section tokens are white in light mode; on a bg-background/bg-surface-soft surface they vanish. Swap to text-text, text-heading, text-text-secondary, or border-border.\n` +
          formatted,
      ).toEqual([]);
    });
  }
});
