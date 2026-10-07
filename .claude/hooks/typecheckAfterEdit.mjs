import { createInterface } from "readline";
import { execSync } from "child_process";

const lines = [];
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => lines.push(line));
rl.on("close", () => {
  const { tool_input } = JSON.parse(lines.join(""));

  const isTs = tool_input.file_path && /\.(ts|tsx)$/.test(tool_input.file_path);
  if (!isTs) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR;
  try {
    execSync("pnpm typecheck", { cwd: root, stdio: "pipe" });
  } catch (err) {
    const output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
    const allLines = output.split("\n");
    const tsErrors = allLines.filter((l) => l.includes("error TS"));
    const excerpt = (tsErrors.length > 0 ? tsErrors : allLines).slice(0, 30).join("\n");
    process.stderr.write(excerpt + "\n");
    process.exit(2);
  }
});
