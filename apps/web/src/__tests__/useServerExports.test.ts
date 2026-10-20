// @vitest-environment node
//
// Guards against the Next.js error:
//   'A "use server" file can only export async functions, found object'
//
// "use server" files may only export:
//   - export async function foo(...)  ← always allowed
//   - export type Foo = ...           ← erased by TypeScript, always allowed
//   - export interface Foo { ... }    ← erased by TypeScript, always allowed
//   - export type { Foo } from "..."  ← erased, always allowed
//
// Any `export const/let/var` that isn't assigned an async function is a violation.
//
// Fix: move non-function exports (Zod schemas, plain objects, constants) into a
// sibling file without "use server" (e.g. schemas.ts) and re-export the type from
// actions.ts using `export type { Foo } from "./schemas"`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const SRC = join(__dirname, "..");

function walkTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walkTs(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

function nonAsyncValueExports(content: string): string[] {
  const lines = content.split("\n");
  const violations: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const trimmed = line.trimStart();

    // `export const/let/var NAME` — the only pattern that produces a runtime value
    const constMatch = trimmed.match(/^export\s+(?:const|let|var)\s+(\w+)/);
    if (!constMatch) continue;

    // Look at this line plus the next two, stripping line comments, to allow
    // multi-line assignments like `export const foo =\n  async (...) => {`
    const window = lines
      .slice(index, index + 3)
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join(" ");

    if (!/=\s*async[\s(]/.test(window)) {
      violations.push(constMatch[1] ?? "unknown");
    }
  }
  return violations;
}

const allFiles = walkTs(SRC).filter((f) => !f.includes("__tests__"));
const serverFiles = allFiles.filter((f) => {
  const content = readFileSync(f, "utf8");
  return /^["']use server["']/.test(content.trimStart());
});

describe("use-server exports", () => {
  it("finds at least one use-server file (sanity check)", () => {
    expect(serverFiles.length).toBeGreaterThan(0);
  });

  for (const file of serverFiles) {
    const label = file.replace(SRC, "").replace(/\\/g, "/");
    it(`${label} exports only async functions`, () => {
      const content = readFileSync(file, "utf8");
      const violations = nonAsyncValueExports(content);
      expect(violations, `Non-async-function exports found in ${label}`).toEqual([]);
    });
  }
});
