// @vitest-environment node
//
// Catches the dark-on-dark contrast bug directly: any element that renders
// `bg-section` or `bg-card` must also set an on-section text color on itself,
// so descendants that don't declare their own color inherit something readable
// in both themes. Without this guard, a form with `bg-card` can appear fine
// while every nested heading, label, and button quietly inherits page
// `text-text` (near-black in light mode) and becomes unreadable, which is
// exactly what happened on /coach/meets.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const SRC = join(__dirname, "..");

const DARK_SECTION_BACKGROUNDS = new Set(["bg-section", "bg-card"]);

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

interface Violation {
  file: string;
  line: number;
  classString: string;
  darkTokens: string[];
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
    const darkTokens = [...tokens].filter((token) => DARK_SECTION_BACKGROUNDS.has(token));
    if (darkTokens.length === 0) continue;
    const hasSafeInherited = [...tokens].some((token) => ON_SECTION_TEXT_TOKENS.has(token));
    const hasSelfOnlyColor = [...tokens].some((token) => SELF_TEXT_OPT_OUTS.has(token));
    if (hasSafeInherited || hasSelfOnlyColor) continue;
    violations.push({
      file,
      line: lineAt(content, index),
      classString: raw.replace(/\s+/g, " ").trim(),
      darkTokens,
    });
  }
  return violations;
}

const files = walkFiles(SRC);

describe("dark-section contrast guard", () => {
  it("finds .tsx files to scan (sanity check)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const label = file.replace(SRC, "").replace(/\\/g, "/");
    it(`${label} declares an on-section text color wherever it sets a dark background`, () => {
      const content = readFileSync(file, "utf8");
      const violations = findViolations(file, content);
      const formatted = violations
        .map(
          (violation) =>
            `  line ${violation.line}: {${violation.darkTokens.join(", ")}} without an on-section text color\n    ${violation.classString}`,
        )
        .join("\n");
      expect(
        violations,
        `Add text-text-on-section (or another *-on-section token) to the element with the dark background, so descendants without explicit colors inherit something readable in both themes:\n${formatted}`,
      ).toEqual([]);
    });
  }
});
