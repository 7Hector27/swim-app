import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "../../../../");

const LEADERBOARD_FILES = [
  "apps/api/src/routes/leaderboard.ts",
  "apps/api/src/routes/coachLeaderboard.ts",
];

const GOLF_SCORE_SYMBOLS = [
  "GolfScore",
  "golf-score-trends",
  "golfScoreTrend",
  "GolfScoreTrend",
  "fetchGolfScoreTrends",
];

describe("leaderboard isolation — no golf score imports", () => {
  for (const relPath of LEADERBOARD_FILES) {
    it(`${relPath} does not import golf score code`, () => {
      const content = readFileSync(join(REPO_ROOT, relPath), "utf-8");
      for (const symbol of GOLF_SCORE_SYMBOLS) {
        expect(content, `Found "${symbol}" in ${relPath}`).not.toContain(symbol);
      }
    });
  }
});
