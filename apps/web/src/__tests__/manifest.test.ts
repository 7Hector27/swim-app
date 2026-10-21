import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const publicDir = resolve(__dirname, "../../public");
const manifestPath = resolve(publicDir, "icons/site.webmanifest");

describe("site.webmanifest icon paths", () => {
  it("every icon src in the manifest exists under public/", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      icons?: { src: string }[];
    };
    const icons = manifest.icons ?? [];
    expect(icons.length).toBeGreaterThan(0);

    for (const icon of icons) {
      const filePath = resolve(publicDir, icon.src.replace(/^\//, ""));
      expect(existsSync(filePath), `missing icon: ${icon.src}`).toBe(true);
    }
  });
});
