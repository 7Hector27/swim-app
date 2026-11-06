// Entrypoint for `pnpm test:integration`. Three steps, in order:
//   1. Preflight: TCP-connect to the test DB. If it's not reachable, print
//      the exact start command and exit non-zero. No Vitest or Drizzle noise.
//   2. Apply pending migrations to the test stack (idempotent).
//   3. Run Vitest with the integration config.
//
// A new migration never surfaces as a cryptic test failure, and a missing
// stack gives a clear message. See docs/decisions/035-test-database-isolation.md.

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { applyTestEnv } from "./applyTestEnv";

const START_COMMAND = "pnpm db:test:up";

function parseHostPort(databaseUrl: string): { host: string; port: number } {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;
  const port = Number(parsed.port) || 5432;
  if (!host) {
    throw new Error(`INTEGRATION_DATABASE_URL has no hostname: ${databaseUrl}`);
  }
  return { host, port };
}

async function assertReachable(host: string, port: number): Promise<void> {
  await new Promise<void>((resolveFn, rejectFn) => {
    const socket = createConnection({ host, port, timeout: 3000 });
    socket.once("connect", () => {
      socket.end();
      resolveFn();
    });
    socket.once("timeout", () => {
      socket.destroy();
      rejectFn(new Error(`timeout connecting to ${host}:${port}`));
    });
    socket.once("error", (error) => {
      socket.destroy();
      rejectFn(error);
    });
  });
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolveFn();
      } else {
        rejectFn(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "null"}`));
      }
    });
    child.on("error", (error) => {
      rejectFn(error);
    });
  });
}

async function main(): Promise<void> {
  applyTestEnv();

  const databaseUrl = process.env["INTEGRATION_DATABASE_URL"]!;
  const { host, port } = parseHostPort(databaseUrl);

  try {
    await assertReachable(host, port);
  } catch {
    process.stderr.write(
      `\nTest Supabase stack is not reachable at ${host}:${port}.\n` +
        `Start it with:   ${START_COMMAND}\n\n`,
    );
    process.exit(1);
  }

  await run("pnpm", ["exec", "tsx", resolve(__dirname, "..", "src/db/migrate.ts")]);
  await run("pnpm", ["exec", "vitest", "run", "--config", resolve(__dirname, "..", "vitest.integration.config.ts")]);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
