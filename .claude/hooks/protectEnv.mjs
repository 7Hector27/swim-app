import { createInterface } from "readline";

const lines = [];
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => lines.push(line));
rl.on("close", () => {
  const input = JSON.parse(lines.join(""));
  const { tool_name, tool_input } = input;

  const isEnvFile = (p) => {
    if (!p) return false;
    const base = p.replace(/\\/g, "/").split("/").pop();
    return /^\.env(\..+)?$/.test(base) && base !== ".env.example";
  };

  let blocked = false;
  if (tool_name === "Bash") {
    const cmd = tool_input.command ?? "";
    blocked =
      /(?:^|\s|['"`;|&])\.env(?:\.[^\s'"`;|&]*)?(?=\s|$|['"`])/.test(cmd) &&
      !/\.env\.example/.test(cmd);
  } else {
    blocked = isEnvFile(tool_input.file_path);
  }

  if (blocked) {
    process.stderr.write(
      "Blocked: .env files are off-limits. Ask the user instead.\n"
    );
    process.exit(2);
  }
});
